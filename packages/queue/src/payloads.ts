import type { AgentMode } from "@calebx/core";
import { ValidationError } from "@calebx/errors";

/**
 * Job payloads, and the parsers that guard them.
 *
 * Jobs outlive the code that enqueued them: a payload sitting in Redis during a
 * deploy is read back by the *new* worker. So every payload is validated on the
 * way out of the queue, not trusted because it was valid on the way in.
 */

export const QUEUE_NAMES = {
  agent: "agent-execution",
  ingest: "ingest",
  dispatch: "dispatch",
  cohort: "cohort",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface AgentJob {
  userId: string;
  chatId: string;
  text: string;
  channel: string;
  isGroup?: boolean;
  /** Propagated so a job's spans join the turn that enqueued it. */
  traceId?: string;
  command?: { name: string; argument?: string };
}

export interface IngestJob {
  userId: string;
  mode: AgentMode;
  text: string;
  reply: string;
  traceId?: string;
}

export interface DispatchJob {
  chatId: string;
  text: string;
  isGroup?: boolean;
  parseMode?: "HTML" | "Markdown";
  /** Which bot sends it — one dispatch queue serves both channels. */
  channel: "tg" | "wa";
  traceId?: string;
  /** Set on the graceful message a dead-lettered job produces. */
  fallback?: boolean;
}

function requireString(
  value: unknown,
  field: string,
  { max = 4_096 }: { max?: number } = {},
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${field} is required`);
  }
  if (value.length > max) {
    throw new ValidationError(`${field} exceeds ${max} characters`);
  }
  return value;
}

function optionalTraceId(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{1,32}$/i.test(value)
    ? value
    : undefined;
}

export function parseAgentJob(raw: unknown): AgentJob {
  const job = (raw ?? {}) as Record<string, unknown>;
  const command = job.command as
    { name?: unknown; argument?: unknown } | undefined;
  return {
    userId: requireString(job.userId, "userId", { max: 128 }),
    chatId: requireString(job.chatId, "chatId", { max: 128 }),
    text: requireString(job.text, "text"),
    channel: requireString(job.channel, "channel", { max: 32 }),
    isGroup: job.isGroup === true,
    traceId: optionalTraceId(job.traceId),
    command:
      command && typeof command.name === "string"
        ? {
            name: command.name,
            argument:
              typeof command.argument === "string"
                ? command.argument
                : undefined,
          }
        : undefined,
  };
}

export function parseIngestJob(raw: unknown): IngestJob {
  const job = (raw ?? {}) as Record<string, unknown>;
  const mode = job.mode;
  if (mode !== "matchmaker" && mode !== "community_connector") {
    throw new ValidationError(
      `mode must be a known agent mode, got ${String(mode)}`,
    );
  }
  return {
    userId: requireString(job.userId, "userId", { max: 128 }),
    mode,
    text: requireString(job.text, "text"),
    // A reply can legitimately be empty if the turn fell back; the ingest job
    // still has a user message worth extracting from.
    reply: typeof job.reply === "string" ? job.reply : "",
    traceId: optionalTraceId(job.traceId),
  };
}

export function parseDispatchJob(raw: unknown): DispatchJob {
  const job = (raw ?? {}) as Record<string, unknown>;
  const channel = job.channel;
  if (channel !== "tg" && channel !== "wa") {
    throw new ValidationError(
      `channel must be "tg" or "wa", got ${String(channel)}`,
    );
  }
  const parseMode = job.parseMode;
  return {
    chatId: requireString(job.chatId, "chatId", { max: 128 }),
    text: requireString(job.text, "text"),
    channel,
    isGroup: job.isGroup === true,
    parseMode:
      parseMode === "HTML" || parseMode === "Markdown" ? parseMode : undefined,
    traceId: optionalTraceId(job.traceId),
    fallback: job.fallback === true,
  };
}

/**
 * Per-queue retry policy.
 *
 * Dispatch retries hardest because a lost outbound message is a user staring at
 * silence; ingest retries because it is invisible and cheap to repeat; the agent
 * queue retries least because a third LLM attempt on the same turn is usually
 * three times the same failure.
 */
export const RETRY_POLICY: Readonly<
  Record<QueueName, { attempts: number; backoffMs: number }>
> = {
  "agent-execution": { attempts: 3, backoffMs: 2_000 },
  ingest: { attempts: 3, backoffMs: 5_000 },
  dispatch: { attempts: 5, backoffMs: 1_000 },
  cohort: { attempts: 1, backoffMs: 0 },
};

export const CONCURRENCY: Readonly<Record<QueueName, number>> = {
  "agent-execution": 5,
  ingest: 5,
  // One, because the Telegram rate limit is global and a second worker would
  // have its own pacer with no knowledge of the first one's sends.
  dispatch: 1,
  cohort: 1,
};
