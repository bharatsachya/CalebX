import { EmbeddingError } from "@calebx/errors";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "./dimensions.ts";
import { normalize } from "./similarity.ts";
import type { Embedding, EmbeddingProvider } from "./types.ts";

/**
 * Client for a shared embedding service.
 *
 * One service rather than an in-process model per worker: FastEmbed loads an
 * ONNX model into memory, and five queue workers each holding their own copy is
 * five times the RAM for the same throughput. It is also the only place a model
 * upgrade has to be rolled out. See assumptions.md A4.
 */
export interface HttpEmbedderOptions {
  baseUrl: string;
  dimensions?: number;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface EmbedResponse {
  embeddings?: number[][];
}

export class HttpEmbedder implements EmbeddingProvider {
  readonly name = "http";
  readonly dimensions: number;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpEmbedderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(texts: string[]): Promise<Embedding[]> {
    // An empty batch is a no-op, not a request. Worth short-circuiting: the
    // ingest worker calls this with whatever extraction produced, which is
    // legitimately nothing on a "hi" turn.
    if (texts.length === 0) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: EMBEDDING_MODEL, texts }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new EmbeddingError(
          `embedding service returned ${response.status}`,
          { status: response.status },
        );
      }

      const body = (await response.json()) as EmbedResponse;
      const embeddings = body.embeddings;
      if (!Array.isArray(embeddings)) {
        throw new EmbeddingError("embedding service returned no embeddings");
      }
      if (embeddings.length !== texts.length) {
        // Callers zip inputs to outputs by index; a length mismatch would
        // attach the wrong vector to the wrong chunk.
        throw new EmbeddingError(
          `embedding count mismatch: asked for ${texts.length}, got ${embeddings.length}`,
        );
      }
      for (const embedding of embeddings) {
        if (embedding.length !== this.dimensions) {
          throw new EmbeddingError(
            `embedding dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`,
          );
        }
      }
      return embeddings.map(normalize);
    } catch (error) {
      if (error instanceof EmbeddingError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new EmbeddingError(
          `embedding service timed out after ${this.timeoutMs}ms`,
        );
      }
      throw new EmbeddingError("embedding service unreachable", error);
    } finally {
      clearTimeout(timer);
    }
  }
}
