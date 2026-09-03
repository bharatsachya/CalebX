import {
  extractionCall,
  extractionPromptFor,
  parseExtraction,
  type AgentDeps,
} from "@calebx/agent";
import { userPrincipal } from "@calebx/authz";
import { env } from "@calebx/config";
import { runIngest } from "./ingest.ts";
import type { AgentJob } from "./payloads.ts";
import { handleAgentJob, type Outbound } from "./pipeline.ts";
import { enqueueAgentTurn } from "./queues.ts";

/**
 * How a bot gets a turn executed.
 *
 * Two runners, one behaviour. `inline` runs everything in the bot process and
 * is the default, because a checkout with Postgres and Neo4j reachable should
 * reply to a message without anyone standing up Redis and three workers first.
 * `queue` hands the turn to the `agent-execution` worker.
 *
 * Both call the same `handleAgentJob`, so the inline mode is a deployment
 * choice rather than a second implementation that can drift.
 */

export interface TurnRunner {
  /** Messages to send now. Empty in queued mode — the dispatch worker sends. */
  run(job: AgentJob): Promise<Outbound[]>;
}

export type ExecutionMode = "inline" | "queue";

export function executionMode(): ExecutionMode {
  return env("queue").optional("AGENT_EXECUTION", "inline") === "queue"
    ? "queue"
    : "inline";
}

export function createQueuedRunner(): TurnRunner {
  return {
    async run(job) {
      await enqueueAgentTurn(job);
      return [];
    },
  };
}

export function createInlineRunner(deps: AgentDeps): TurnRunner {
  return {
    async run(job) {
      const result = await handleAgentJob(deps, job);

      // Ingestion is deliberately not awaited: the reply is already decided and
      // the user should not wait on an extraction call plus an embedding pass.
      if (result.ingest) {
        const ingestJob = result.ingest;
        void runIngest(
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
          ingestJob,
          // Persona writes are best effort; a failure must never surface as a
          // failed turn the user already got a reply for.
        ).catch(() => undefined);
      }

      return result.outbound;
    },
  };
}

export function createRunner(deps: AgentDeps): TurnRunner {
  return executionMode() === "queue"
    ? createQueuedRunner()
    : createInlineRunner(deps);
}
