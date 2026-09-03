import type { SendPacer } from "./limiter.ts";

/**
 * The typing indicator bus.
 *
 * Telegram's `sendChatAction` expires after about five seconds, so showing
 * "typing…" for a turn that takes twelve means re-sending it. The worker doing
 * the actual work is busy — often blocked on an LLM call — so a separate
 * subscriber owns the repeat.
 *
 * Two things this must not do: outlive the work (a stuck loop shows a bot
 * typing forever), and bypass the rate limiter. Chat actions **count against**
 * Telegram's limits, so they draw from the same budget as replies.
 *
 * WhatsApp Cloud API has no typing action, so this bus is Telegram-only.
 */

export const TYPING_CHANNEL = "calebx:typing";

export interface TypingEvent {
  chatId: string;
  action: "start" | "stop";
  isGroup?: boolean;
}

/**
 * Only the publish half is a port.
 *
 * Subscribing is done by the dispatch worker against ioredis directly — its
 * overloaded `subscribe` signature does not fit a narrow interface, and forcing
 * one would mean casting at the only call site that uses it. Publishing is the
 * side every bot needs, so that is what gets an interface.
 */
export interface PubSub {
  publish(channel: string, message: string): Promise<unknown>;
}

export function encodeTypingEvent(event: TypingEvent): string {
  return JSON.stringify(event);
}

export function decodeTypingEvent(message: string): TypingEvent | null {
  try {
    const parsed = JSON.parse(message) as Record<string, unknown>;
    if (typeof parsed.chatId !== "string" || parsed.chatId === "") return null;
    if (parsed.action !== "start" && parsed.action !== "stop") return null;
    return {
      chatId: parsed.chatId,
      action: parsed.action,
      isGroup: parsed.isGroup === true,
    };
  } catch {
    return null;
  }
}

export async function publishTyping(
  bus: PubSub,
  event: TypingEvent,
): Promise<void> {
  await bus.publish(TYPING_CHANNEL, encodeTypingEvent(event));
}

export interface TypingLoopOptions {
  /** Re-send interval. Below Telegram's ~5s expiry, with room to spare. */
  intervalMs?: number;
  /** Hard stop, so a lost "stop" cannot leave a chat typing forever. */
  maxDurationMs?: number;
  pacer?: SendPacer;
  now?: () => number;
}

/**
 * Decides when the next chat action is due.
 *
 * Pure and clock-injected: "does a lost stop event eventually give up?" is a
 * question worth answering in a unit test rather than by watching a bot.
 */
export class TypingLoop {
  private readonly intervalMs: number;
  private readonly maxDurationMs: number;
  private readonly now: () => number;
  private readonly pacer?: SendPacer;
  private readonly active = new Map<
    string,
    { startedAt: number; nextAt: number; isGroup: boolean }
  >();

  constructor(options: TypingLoopOptions = {}) {
    this.intervalMs = options.intervalMs ?? 4_000;
    this.maxDurationMs = options.maxDurationMs ?? 120_000;
    this.now = options.now ?? (() => Date.now());
    this.pacer = options.pacer;
  }

  apply(event: TypingEvent): void {
    if (event.action === "stop") {
      this.active.delete(event.chatId);
      return;
    }
    const now = this.now();
    const existing = this.active.get(event.chatId);
    this.active.set(event.chatId, {
      startedAt: existing?.startedAt ?? now,
      // A fresh start sends immediately; a repeat start does not reset the
      // deadline, or a chatty user could keep the indicator alive forever.
      nextAt: existing?.nextAt ?? now,
      isGroup: event.isGroup === true,
    });
  }

  isActive(chatId: string): boolean {
    return this.active.has(chatId);
  }

  /**
   * Chats whose indicator is due now. Each returned chat has its next tick
   * scheduled and, when a pacer is present, a slot reserved against the shared
   * send budget.
   */
  due(): { chatId: string; delayMs: number }[] {
    const now = this.now();
    const out: { chatId: string; delayMs: number }[] = [];

    for (const [chatId, state] of [...this.active]) {
      if (now - state.startedAt >= this.maxDurationMs) {
        this.active.delete(chatId);
        continue;
      }
      if (now < state.nextAt) continue;

      const delayMs = this.pacer?.reserve(chatId, state.isGroup) ?? 0;
      out.push({ chatId, delayMs });
      this.active.set(chatId, { ...state, nextAt: now + this.intervalMs });
    }
    return out;
  }

  /** Chats currently showing an indicator. */
  activeChats(): string[] {
    return [...this.active.keys()];
  }
}
