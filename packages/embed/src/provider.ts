import { env } from "@calebx/config";
import { EmbeddingError } from "@calebx/errors";
import { EMBEDDING_DIMENSIONS } from "./dimensions.ts";
import { HashEmbedder } from "./hash.embedder.ts";
import { HttpEmbedder } from "./http.client.ts";
import type { EmbeddingProvider } from "./types.ts";

const e = env("embed");

export type ProviderKind = "http" | "hash" | "fastembed";

/**
 * Optional dependency loading.
 *
 * The specifier is a variable so the module is not resolved at type-check time —
 * `fastembed` pulls in onnxruntime and a ~130MB model download, and requiring it
 * to be installed just so `tsc --noEmit` passes would make the whole monorepo
 * expensive to check out.
 */
async function loadOptional(name: string): Promise<unknown> {
  const specifier = name;
  return import(specifier);
}

interface FastEmbedModule {
  FlagEmbedding: {
    init(options: Record<string, unknown>): Promise<{
      embed(texts: string[], batchSize?: number): AsyncGenerator<number[][]>;
    }>;
  };
}

/**
 * In-process FastEmbed. Only worth using for a single-worker local run — see
 * `HttpEmbedder` for why the shared service is the deployed shape.
 */
export async function createFastEmbedProvider(): Promise<EmbeddingProvider> {
  let loaded: unknown;
  try {
    loaded = await loadOptional("fastembed");
  } catch (error) {
    throw new EmbeddingError(
      "EMBED_PROVIDER=fastembed but the `fastembed` package is not installed",
      error,
    );
  }
  const module = loaded as FastEmbedModule;
  const model = await module.FlagEmbedding.init({});

  return {
    name: "fastembed",
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts: string[]) {
      if (texts.length === 0) return [];
      const out: number[][] = [];
      for await (const batch of model.embed(texts)) out.push(...batch);
      if (out.length !== texts.length) {
        throw new EmbeddingError(
          `fastembed returned ${out.length} embeddings for ${texts.length} texts`,
        );
      }
      return out;
    },
  };
}

/**
 * Builds the provider named by `EMBED_PROVIDER`, defaulting to the HTTP service.
 *
 * `hash` has to be asked for explicitly. Defaulting to it would mean a
 * misconfigured deployment silently writing lexical-only vectors into the same
 * index as real ones — which produces plausible-looking, quietly wrong
 * recommendations, the worst possible failure mode.
 */
export async function createEmbeddingProvider(
  kind: ProviderKind = e.optional("EMBED_PROVIDER", "http") as ProviderKind,
): Promise<EmbeddingProvider> {
  switch (kind) {
    case "hash":
      return new HashEmbedder();
    case "fastembed":
      return createFastEmbedProvider();
    case "http":
      return new HttpEmbedder({ baseUrl: e.required("EMBED_SERVICE_URL") });
    default:
      throw new EmbeddingError(`unknown EMBED_PROVIDER: ${String(kind)}`);
  }
}
