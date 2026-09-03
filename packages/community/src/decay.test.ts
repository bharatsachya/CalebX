/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { cosine, HashEmbedder } from "@calebx/embed";
import type { PersonaChunk, ScoredChunk } from "@calebx/graph";
import {
  DEFAULT_HALF_LIFE_DAYS,
  decayWeight,
  peerAffinity,
  rankChunks,
} from "./decay.ts";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function chunk(
  text: string,
  ageDays: number,
  embedding: number[] = [1, 0],
): PersonaChunk {
  return {
    chunkId: text,
    userId: "tg:1001",
    text,
    category: "interest",
    embedding,
    createdAt: NOW - ageDays * DAY,
  };
}

describe("decayWeight", () => {
  it("is 1 for a chunk written now", () => {
    expect(decayWeight(NOW, NOW)).toBe(1);
  });

  it("is 0.5 after one half-life", () => {
    expect(decayWeight(NOW - DEFAULT_HALF_LIFE_DAYS * DAY, NOW)).toBeCloseTo(
      0.5,
      10,
    );
  });

  it("is 0.25 after two half-lives", () => {
    expect(
      decayWeight(NOW - 2 * DEFAULT_HALF_LIFE_DAYS * DAY, NOW),
    ).toBeCloseTo(0.25, 10);
  });

  it("never exceeds 1 for a future timestamp", () => {
    // Clock skew between workers must not become a ranking advantage.
    expect(decayWeight(NOW + 10 * DAY, NOW)).toBe(1);
  });

  it("honours a custom half-life", () => {
    expect(decayWeight(NOW - 7 * DAY, NOW, 7)).toBeCloseTo(0.5, 10);
  });

  it("disables decay for a non-positive half-life", () => {
    expect(decayWeight(NOW - 1000 * DAY, NOW, 0)).toBe(1);
  });

  it("stays positive for very old chunks rather than hitting zero", () => {
    // History thins out but is never erased — that is the point of keeping
    // contradicting chunks instead of deleting them.
    const weight = decayWeight(NOW - 3650 * DAY, NOW);
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeLessThan(0.001);
  });
});

describe("rankChunks", () => {
  it("prefers a recent chunk over an equally similar old one", () => {
    const scored: ScoredChunk[] = [
      { chunk: chunk("old cafes", 180), similarity: 0.8 },
      { chunk: chunk("new cafes", 1), similarity: 0.8 },
    ];
    expect(rankChunks(scored, NOW)[0].chunk.text).toBe("new cafes");
  });

  it("still prefers a much more similar old chunk over a weak fresh one", () => {
    const scored: ScoredChunk[] = [
      { chunk: chunk("old strong", 90), similarity: 0.9 },
      { chunk: chunk("new weak", 0), similarity: 0.3 },
    ];
    expect(rankChunks(scored, NOW)[0].chunk.text).toBe("old strong");
  });

  it("reports similarity, decay, and the combined score", () => {
    const [ranked] = rankChunks(
      [{ chunk: chunk("x", DEFAULT_HALF_LIFE_DAYS), similarity: 0.6 }],
      NOW,
    );
    expect(ranked.similarity).toBe(0.6);
    expect(ranked.decay).toBeCloseTo(0.5, 10);
    expect(ranked.score).toBeCloseTo(0.3, 10);
  });

  it("does not let decay promote a negative similarity", () => {
    // Multiplying a negative score by a decay below 1 would make an old
    // contradictory chunk rank above a fresh one.
    const scored: ScoredChunk[] = [
      { chunk: chunk("old opposite", 365), similarity: -0.9 },
      { chunk: chunk("fresh weak", 0), similarity: 0.1 },
    ];
    const ranked = rankChunks(scored, NOW);
    expect(ranked[0].chunk.text).toBe("fresh weak");
    expect(ranked[1].score).toBeLessThan(0);
  });

  it("handles an empty list", () => {
    expect(rankChunks([], NOW)).toEqual([]);
  });
});

describe("peerAffinity", () => {
  const embedder = new HashEmbedder();

  it("is 0 when either side has no chunks", () => {
    expect(peerAffinity([], [chunk("x", 0)], cosine)).toBe(0);
    expect(
      peerAffinity(
        rankChunks([{ chunk: chunk("x", 0), similarity: 1 }], NOW),
        [],
        cosine,
      ),
    ).toBe(0);
  });

  it("scores two people who share interests above two who do not", async () => {
    const [cafe, coffee, welding] = await embedder.embed([
      "prefers quiet cafes for work",
      "loves filter coffee in cafes",
      "restores vintage motorcycles",
    ]);
    const mine = rankChunks(
      [{ chunk: chunk("cafes", 0, cafe), similarity: 1 }],
      NOW,
    );
    const similar = peerAffinity(mine, [chunk("coffee", 0, coffee)], cosine);
    const unrelated = peerAffinity(mine, [chunk("bikes", 0, welding)], cosine);
    expect(similar).toBeGreaterThan(unrelated);
  });

  it("weights an old chunk of mine less", async () => {
    const [cafe] = await embedder.embed(["prefers quiet cafes for work"]);
    const fresh = rankChunks(
      [{ chunk: chunk("a", 0, cafe), similarity: 1 }],
      NOW,
    );
    const stale = rankChunks(
      [{ chunk: chunk("a", 365, cafe), similarity: 1 }],
      NOW,
    );
    expect(peerAffinity(fresh, [chunk("b", 0, cafe)], cosine)).toBeGreaterThan(
      peerAffinity(stale, [chunk("b", 0, cafe)], cosine),
    );
  });

  it("does not let one shared interest carry an otherwise unrelated pair", async () => {
    // Mean-of-best, not best-of-best.
    const [cafe, bikes, cooking] = await embedder.embed([
      "prefers quiet cafes for work",
      "restores vintage motorcycles",
      "cooks elaborate sunday lunches",
    ]);
    const mine = rankChunks(
      [
        { chunk: chunk("a", 0, cafe), similarity: 1 },
        { chunk: chunk("b", 0, bikes), similarity: 1 },
        { chunk: chunk("c", 0, cooking), similarity: 1 },
      ],
      NOW,
    );
    const oneOverlap = peerAffinity(mine, [chunk("d", 0, cafe)], cosine);
    expect(oneOverlap).toBeLessThan(0.5);
  });

  it("clamps a negative best match to zero rather than subtracting", () => {
    const mine = rankChunks(
      [{ chunk: chunk("a", 0, [1, 0]), similarity: 1 }],
      NOW,
    );
    expect(peerAffinity(mine, [chunk("b", 0, [-1, 0])], cosine)).toBe(0);
  });
});
