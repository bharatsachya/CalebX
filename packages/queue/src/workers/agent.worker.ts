/**
 * `bun run --cwd packages/queue worker:agent`
 *
 * Consumes `agent-execution`, runs the turn, and enqueues the reply and the
 * ingest job. It performs no I/O of its own beyond the queues — the turn logic
 * is the same `handleAgentJob` the inline path uses.
 */
import { Worker } from "bullmq";
import { initTracing, withTrace } from "@calebx/trace";
import { copy } from "@calebx/channel";
import { buildAgentDeps } from "../deps.ts";
import {
  CONCURRENCY,
  QUEUE_NAMES,
  parseAgentJob,
  type AgentJob,
} from "../payloads.ts";
import { handleAgentJob, toDispatchJobs } from "../pipeline.ts";
import { enqueueDispatch, enqueueIngest, getConnection } from "../queues.ts";

initTracing("agent-worker");

const deps = await buildAgentDeps();

const worker = new Worker(
  QUEUE_NAMES.agent,
  async (job) => {
    const payload: AgentJob = parseAgentJob(job.data);
    const channel = payload.userId.startsWith("wa:") ? "wa" : "tg";

    return withTrace(
      "job.agent",
      { userId: payload.userId, jobId: job.id, traceId: payload.traceId },
      { kind: "queue", attributes: { attempt: job.attemptsMade + 1 } },
      async () => {
        const result = await handleAgentJob(deps, payload);
        for (const dispatch of toDispatchJobs(
          payload,
          result.outbound,
          channel,
        )) {
          await enqueueDispatch(dispatch);
        }
        if (result.ingest) await enqueueIngest(result.ingest);
        return { outcome: result.outcome.kind };
      },
    );
  },
  { connection: getConnection(), concurrency: CONCURRENCY[QUEUE_NAMES.agent] },
);

/**
 * A failed turn still owes the user a reply. On the final attempt the worker
 * queues the fallback itself — silence is indistinguishable from a dead bot.
 */
worker.on("failed", async (job, error) => {
  if (!job) return;
  const attemptsLeft = (job.opts.attempts ?? 1) - job.attemptsMade;
  if (attemptsLeft > 0) return;
  try {
    const payload = parseAgentJob(job.data);
    await enqueueDispatch({
      chatId: payload.chatId,
      text: copy.AGENT_UNAVAILABLE,
      channel: payload.userId.startsWith("wa:") ? "wa" : "tg",
      isGroup: payload.isGroup,
      traceId: payload.traceId,
      fallback: true,
    });
  } catch {
    // The payload itself was unusable; there is no chat to apologise to.
  }
  process.stderr.write(
    `[agent-worker] job ${job.id} failed: ${String(error)}\n`,
  );
});

process.stdout.write("[agent-worker] listening\n");
