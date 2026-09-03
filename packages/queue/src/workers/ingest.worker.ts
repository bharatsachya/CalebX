/**
 * `bun run --cwd packages/queue worker:ingest`
 *
 * Extraction, embedding, and persona writes — everything the reply path no
 * longer waits for.
 */
import { Worker } from "bullmq";
import {
  extractionCall,
  parseExtraction,
  extractionPromptFor,
} from "@calebx/agent";
import { userPrincipal } from "@calebx/authz";
import { initTracing, withTrace } from "@calebx/trace";
import { buildAgentDeps } from "../deps.ts";
import { runIngest } from "../ingest.ts";
import { CONCURRENCY, QUEUE_NAMES, parseIngestJob } from "../payloads.ts";
import { getConnection } from "../queues.ts";

initTracing("ingest-worker");

const deps = await buildAgentDeps();

const worker = new Worker(
  QUEUE_NAMES.ingest,
  async (job) => {
    const payload = parseIngestJob(job.data);
    return withTrace(
      "job.ingest",
      { userId: payload.userId, jobId: job.id, traceId: payload.traceId },
      { kind: "queue", attributes: { mode: payload.mode } },
      () =>
        runIngest(
          {
            extract: extractionCall,
            promptFor: extractionPromptFor,
            parse: (raw) => {
              const extraction = parseExtraction(raw);
              return {
                locationHint: extraction.locationHint,
                chunks: extraction.chunks,
              };
            },
            embed: deps.embed,
            graph: deps.graph,
            principalFor: (userId, mode) =>
              userPrincipal(userId, mode, [mode], [deps.hashUserId(userId)]),
          },
          payload,
        ),
    );
  },
  { connection: getConnection(), concurrency: CONCURRENCY[QUEUE_NAMES.ingest] },
);

// Ingest failures are invisible to the user by design, so they must be loud in
// the log — a silently empty persona graph is very hard to notice.
worker.on("failed", (job, error) => {
  process.stderr.write(
    `[ingest-worker] job ${job?.id} failed: ${String(error)}\n`,
  );
});

process.stdout.write("[ingest-worker] listening\n");
