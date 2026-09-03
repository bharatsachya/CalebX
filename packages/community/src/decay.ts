import type { PersonaChunk, ScoredChunk } from "@calebx/graph";

/**
 * Recency weighting for persona chunks.
 *
 * Chunks are immutable — a contradiction writes a new one rather than editing
 * the old — so the only thing that makes recent facts win is this weight. It is
 * computed at read time from `createdAt` rather than stored, which means there
 * is no decay cron to run, no write amplification on every chunk, and no window
 * where the stored weight disagrees with the clock (assumptions.md A6).
 */

/**
 * Ninety days. Chosen so a season-old interest still counts for about half of a
 * fresh one: someone who talked about hiking in January and cafes in April is
 * both, and a shorter half-life erases the January person entirely.
 */
export const DEFAULT_HALF_LIFE_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 * Exponential decay in [0, 1]. A chunk written now weighs 1; one written a
 * half-life ago weighs 0.5.
 *
 * A chunk with a future timestamp (clock skew between workers) weighs 1 rather
 * than more than 1 — otherwise skew becomes a ranking advantage.
 */
export function decayWeight(
  createdAt: number,
  now: number,
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
): number {
  if (halfLifeDays <= 0) return 1;
  const ageDays = (now - createdAt) / DAY_MS;
  if (ageDays <= 0) return 1;
  return 2 ** (-ageDays / halfLifeDays);
}

export interface RankedChunk {
  chunk: PersonaChunk;
  similarity: number;
  decay: number;
  /** `similarity * decay` — what ordering actually uses. */
  score: number;
}

/**
 * Applies decay to similarity scores and re-sorts.
 *
 * Negative similarities are kept rather than clamped, and decay is applied to
 * the magnitude — multiplying a negative score by a decay below 1 would make an
 * old contradictory chunk look *better* than a fresh one.
 */
export function rankChunks(
  scored: ScoredChunk[],
  now: number,
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
): RankedChunk[] {
  return scored
    .map(({ chunk, similarity }) => {
      const decay = decayWeight(chunk.createdAt, now, halfLifeDays);
      const magnitude = Math.abs(similarity) * decay;
      return {
        chunk,
        similarity,
        decay,
        score: similarity < 0 ? -magnitude : magnitude,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Similarity between two people, as the mean of the best match each of A's
 * chunks finds among B's.
 *
 * Mean-of-best rather than best-of-best: one shared interest should not make two
 * people a match, and averaging every pair would drown a real overlap in noise
 * from unrelated chunks.
 */
export function peerAffinity(
  mine: RankedChunk[],
  theirs: PersonaChunk[],
  cosine: (a: number[], b: number[]) => number,
): number {
  if (mine.length === 0 || theirs.length === 0) return 0;
  let total = 0;
  for (const { chunk, decay } of mine) {
    let best = -1;
    for (const other of theirs) {
      const score = cosine(chunk.embedding, other.embedding);
      if (score > best) best = score;
    }
    total += Math.max(0, best) * decay;
  }
  return total / mine.length;
}
