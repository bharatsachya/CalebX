import type { Principal } from "@calebx/authz";
import type { AgentMode } from "@calebx/core";
import type { EmbeddingProvider } from "@calebx/embed";
import type { GraphStore, NewChunk } from "@calebx/graph";
import { withSpan } from "@calebx/trace";
import type { IngestJob } from "./payloads.ts";

/**
 * Persona ingestion, after the reply has already gone out.
 *
 * This is the job that finally consumes Stage 1's extraction — the structured
 * output the original pipeline computed every turn and discarded. Running it
 * here rather than inline is the whole reason a turn no longer waits on an
 * extraction call plus an embedding pass.
 */

export interface IngestDeps {
  /** Stage 1: mode-specific prompt, low temperature. */
  extract(systemPrompt: string, text: string): Promise<string>;
  promptFor(mode: AgentMode): string;
  parse(raw: string): {
    locationHint: string | null;
    chunks: { text: string; category: NewChunk["category"] }[];
  };
  embed: EmbeddingProvider;
  graph: GraphStore;
  principalFor(userId: string, mode: AgentMode): Principal;
}

export interface IngestReport {
  chunksWritten: number;
  skipped: boolean;
  reason?: string;
}

/**
 * Matchmaker mode writes nothing here on purpose.
 *
 * Partner preferences are only ever saved through the tool that makes the user
 * confirm them first. A background job quietly writing "prefers vegetarian"
 * because the model inferred it from one sentence is exactly the silent profile
 * rewrite that rule exists to prevent. Candidate interest text comes from the
 * biodata import, not from conversation.
 */
export async function runIngest(
  deps: IngestDeps,
  job: IngestJob,
): Promise<IngestReport> {
  return withSpan(
    "ingest.run",
    { kind: "queue", attributes: { mode: job.mode } },
    async (span) => {
      if (job.mode === "matchmaker") {
        span.setAttributes({ skipped: true });
        return {
          chunksWritten: 0,
          skipped: true,
          reason: "preferences are written only through the confirmed tool",
        };
      }

      const raw = await deps.extract(deps.promptFor(job.mode), job.text);
      const extraction = deps.parse(raw);

      const chunks: { text: string; category: NewChunk["category"] }[] = [
        ...extraction.chunks,
      ];
      // A location hint is a durable fact worth its own chunk, and it is what
      // later decides which city's cohorts and places to offer.
      if (
        extraction.locationHint &&
        !chunks.some((chunk) => chunk.category === "location")
      ) {
        chunks.push({
          text: `is around ${extraction.locationHint}`,
          category: "location",
        });
      }

      if (chunks.length === 0) {
        span.setAttributes({ chunkCount: 0 });
        return { chunksWritten: 0, skipped: false };
      }

      const embeddings = await deps.embed.embed(
        chunks.map((chunk) => chunk.text),
      );
      const principal = deps.principalFor(job.userId, job.mode);
      const written = await deps.graph.addChunks(
        principal,
        job.userId,
        chunks.map((chunk, index) => ({
          text: chunk.text,
          category: chunk.category,
          embedding: embeddings[index],
        })),
      );

      span.setAttributes({ chunkCount: written.length });
      return { chunksWritten: written.length, skipped: false };
    },
  );
}
