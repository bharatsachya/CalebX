import { TelegramApiError } from "@calebx/errors";
import { withSpan } from "@calebx/trace";
import { isRateLimited, retryAfterMs, type SendPacer } from "./limiter.ts";
import type { DispatchJob } from "./payloads.ts";

/**
 * Sending one outbound message.
 *
 * Everything that makes this safe is here rather than in the BullMQ wiring, so
 * it can be tested without Redis: the pacing, the jitter, the 429 handling, and
 * the rule that a rate-limited message is **re-queued, never retried inline**.
 * Retrying in place holds the single dispatch worker hostage for the whole
 * retry_after window, during which nobody else gets a reply either.
 */

export interface Sender {
  send(job: DispatchJob): Promise<void>;
}

export interface DispatchDeps {
  senders: Record<DispatchJob["channel"], Sender>;
  pacer: SendPacer;
  /** Injectable so tests do not actually wait. */
  sleep(ms: number): Promise<void>;
  /** Re-queues a job that hit a 429, after the delay Telegram asked for. */
  requeue(job: DispatchJob, delayMs: number): Promise<void>;
}

export type DispatchResult =
  | { kind: "sent"; waitedMs: number }
  | { kind: "requeued"; retryAfterMs: number }
  | { kind: "failed"; error: unknown };

export async function dispatchOnce(
  deps: DispatchDeps,
  job: DispatchJob,
): Promise<DispatchResult> {
  return withSpan(
    "dispatch.send",
    {
      kind: "dispatch",
      attributes: {
        channel: job.channel,
        "text.length": job.text.length,
        fallback: job.fallback ?? false,
      },
    },
    async (span) => {
      const sender = deps.senders[job.channel];
      if (!sender) {
        // Not retryable: no amount of waiting produces a sender for a channel
        // this process does not serve.
        return {
          kind: "failed",
          error: new Error(`no sender for ${job.channel}`),
        };
      }

      // WhatsApp has its own per-number limits and no shared 30/s budget with
      // Telegram, so only Telegram sends draw from the pacer.
      const waitedMs =
        job.channel === "tg" ? deps.pacer.reserve(job.chatId, job.isGroup) : 0;
      if (waitedMs > 0) await deps.sleep(waitedMs);

      try {
        await sender.send(job);
        span.setAttributes({ waitedMs });
        return { kind: "sent", waitedMs };
      } catch (error) {
        if (isRateLimited(error)) {
          const delay = retryAfterMs(error);
          span.recordError(new TelegramApiError("rate limited", delay / 1_000));
          await deps.requeue(job, delay);
          return { kind: "requeued", retryAfterMs: delay };
        }
        span.recordError(error);
        return { kind: "failed", error };
      }
    },
  );
}

/**
 * The graceful message a dead-lettered job owes the user.
 *
 * A failed turn still owes a reply — silence is indistinguishable from a dead
 * bot — and this is the job that provides it. It is marked `fallback` so it can
 * never itself dead-letter into another fallback.
 */
export function fallbackJob(
  job: DispatchJob,
  text: string,
): DispatchJob | null {
  if (job.fallback) return null;
  return {
    chatId: job.chatId,
    channel: job.channel,
    isGroup: job.isGroup,
    traceId: job.traceId,
    text,
    fallback: true,
  };
}
