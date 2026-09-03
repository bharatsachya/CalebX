import type { Embedding } from "./types.ts";

/**
 * Cosine similarity. Assumes both vectors are unit length (every provider in
 * this package normalises), so this is a dot product — but the length check is
 * kept because a dimension mismatch is otherwise a silently wrong number rather
 * than an error.
 */
export function cosine(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dimension mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Clamp: floating-point error can put an identical pair a hair above 1.
  return Math.max(-1, Math.min(1, dot));
}

/** Scales a vector to unit length. A zero vector is returned unchanged. */
export function normalize(vector: Embedding): Embedding {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const magnitude = Math.sqrt(sum);
  if (magnitude === 0) return [...vector];
  return vector.map((value) => value / magnitude);
}

export interface Scored<T> {
  item: T;
  score: number;
}

/**
 * Top-k by cosine against a query vector.
 *
 * Ties break on the original order, so a caller that pre-sorted by recency keeps
 * that ordering among equally-similar items instead of getting an arbitrary
 * permutation between runs.
 */
export function topK<T>(
  query: Embedding,
  items: T[],
  toEmbedding: (item: T) => Embedding,
  k: number,
): Scored<T>[] {
  if (k <= 0) return [];
  return items
    .map((item, index) => ({
      item,
      score: cosine(query, toEmbedding(item)),
      index,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, k)
    .map(({ item, score }) => ({ item, score }));
}
