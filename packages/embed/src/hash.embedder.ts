import { EMBEDDING_DIMENSIONS } from "./dimensions.ts";
import { normalize } from "./similarity.ts";
import type { Embedding, EmbeddingProvider } from "./types.ts";

/**
 * A deterministic, dependency-free embedder using the hashing trick.
 *
 * This exists because the alternative — every test and every offline dev session
 * needing a running model server — makes the whole retrieval path untestable.
 * It is not a semantic model: it captures *lexical* overlap only. Two lines that
 * share words land close together; two lines that mean the same thing in
 * different words do not.
 *
 * That is enough for what tests actually need to assert: that a query about
 * cafes ranks the cafe chunk above the hiking chunk, that dimensions match, that
 * ordering is stable. It must never be the provider in production — the factory
 * in `provider.ts` only selects it when explicitly asked.
 */
export class HashEmbedder implements EmbeddingProvider {
  readonly name = "hash";

  constructor(readonly dimensions: number = EMBEDDING_DIMENSIONS) {}

  async embed(texts: string[]): Promise<Embedding[]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): Embedding {
    const vector = new Array<number>(this.dimensions).fill(0);
    for (const token of tokenize(text)) {
      const hashed = fnv1a(token);
      const index = hashed % this.dimensions;
      // A second, independent bit decides the sign. Without it, every token
      // pushes in the same direction and unrelated texts all look similar.
      const sign = (hashed >>> 16) % 2 === 0 ? 1 : -1;
      vector[index] += sign;
    }
    return normalize(vector);
  }
}

/**
 * Lowercase word tokens. Punctuation splits, digits are kept (ages and years
 * matter in matchmaking text), and single characters are dropped as noise.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
