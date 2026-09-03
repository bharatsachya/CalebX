/**
 * Outbound pacing for Telegram.
 *
 * Three limits apply at once, and the tightest one wins:
 *
 * - 30 messages/second across every chat
 * - 1 message/second to any one chat
 * - 20 messages/minute into any one group
 *
 * Plus jitter on every send. The jitter is not politeness — perfectly uniform
 * intervals are a machine signature, and Telegram's timing heuristics feed the
 * bot's Contributor Quality Score. A bot that sends at exactly 35.000ms
 * intervals looks like exactly what it is.
 *
 * The pacer is pure: it says how long to wait, and something else does the
 * waiting. That makes every limit testable without a clock or a network.
 */

export interface PacerOptions {
  globalPerSecond?: number;
  perChatPerSecond?: number;
  groupPerMinute?: number;
  jitterMinMs?: number;
  jitterMaxMs?: number;
  now?: () => number;
  random?: () => number;
}

const SECOND = 1_000;
const MINUTE = 60_000;

export class SendPacer {
  private readonly globalPerSecond: number;
  private readonly perChatIntervalMs: number;
  private readonly groupPerMinute: number;
  private readonly jitterMinMs: number;
  private readonly jitterMaxMs: number;
  private readonly now: () => number;
  private readonly random: () => number;

  /** Timestamps of sends in the last second, oldest first. */
  private globalSends: number[] = [];
  private readonly chatNextAllowed = new Map<string, number>();
  private readonly groupSends = new Map<string, number[]>();

  constructor(options: PacerOptions = {}) {
    this.globalPerSecond = options.globalPerSecond ?? 30;
    this.perChatIntervalMs = SECOND / (options.perChatPerSecond ?? 1);
    this.groupPerMinute = options.groupPerMinute ?? 20;
    this.jitterMinMs = options.jitterMinMs ?? 35;
    this.jitterMaxMs = options.jitterMaxMs ?? 50;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
  }

  /**
   * Reserves a slot and returns how many milliseconds to wait first.
   *
   * Reserving and waiting are separate so that concurrent callers cannot both
   * be told "0ms" — the slot is taken the moment this returns.
   */
  reserve(chatId: string, isGroup = false): number {
    const now = this.now();
    const jitter = this.jitter();

    const earliest = Math.max(
      now,
      this.chatNextAllowed.get(chatId) ?? 0,
      this.globalEarliest(now),
      isGroup ? this.groupEarliest(chatId, now) : 0,
    );

    const sendAt = earliest + jitter;
    this.record(chatId, isGroup, sendAt);
    return sendAt - now;
  }

  /** Uniform in [jitterMinMs, jitterMaxMs). Mandatory on every send. */
  private jitter(): number {
    return (
      this.jitterMinMs + this.random() * (this.jitterMaxMs - this.jitterMinMs)
    );
  }

  private globalEarliest(now: number): number {
    this.globalSends = this.globalSends.filter((at) => at > now - SECOND);
    if (this.globalSends.length < this.globalPerSecond) return 0;
    // The oldest send in the window has to age out before another may go.
    const oldest =
      this.globalSends[this.globalSends.length - this.globalPerSecond];
    return oldest + SECOND;
  }

  private groupEarliest(chatId: string, now: number): number {
    const sends = (this.groupSends.get(chatId) ?? []).filter(
      (at) => at > now - MINUTE,
    );
    this.groupSends.set(chatId, sends);
    if (sends.length < this.groupPerMinute) return 0;
    return sends[sends.length - this.groupPerMinute] + MINUTE;
  }

  private record(chatId: string, isGroup: boolean, sendAt: number): void {
    this.globalSends.push(sendAt);
    this.globalSends.sort((a, b) => a - b);
    this.chatNextAllowed.set(chatId, sendAt + this.perChatIntervalMs);
    if (isGroup) {
      const sends = this.groupSends.get(chatId) ?? [];
      sends.push(sendAt);
      sends.sort((a, b) => a - b);
      this.groupSends.set(chatId, sends);
    }
  }

  /** Forgets state for a chat. Used when a chat is blocked or deleted. */
  forget(chatId: string): void {
    this.chatNextAllowed.delete(chatId);
    this.groupSends.delete(chatId);
  }
}

/**
 * Telegram's own back-pressure signal.
 *
 * A 429 carries `parameters.retry_after` in seconds. Honouring it exactly is
 * the difference between a brief pause and an escalating ban, so an unparseable
 * error falls back to a deliberately generous 30 seconds rather than retrying
 * straight away.
 */
export function retryAfterMs(error: unknown, fallbackSeconds = 30): number {
  const candidate = error as {
    status?: number;
    parameters?: { retry_after?: number };
    response?: { parameters?: { retry_after?: number } };
  };
  const seconds =
    candidate?.parameters?.retry_after ??
    candidate?.response?.parameters?.retry_after;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * SECOND);
  }
  return fallbackSeconds * SECOND;
}

export function isRateLimited(error: unknown): boolean {
  const status =
    (error as { status?: number; statusCode?: number })?.status ??
    (error as { statusCode?: number })?.statusCode;
  return status === 429;
}
