/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { HashEmbedder, tokenize } from "./hash.embedder.ts";
import { EMBEDDING_DIMENSIONS } from "./dimensions.ts";
import { cosine } from "./similarity.ts";

const embedder = new HashEmbedder();

describe("tokenize", () => {
  it("lowercases and splits on punctuation", () => {
    expect(tokenize("Filter coffee, please!")).toEqual([
      "filter",
      "coffee",
      "please",
    ]);
  });

  it("keeps digits, which matter in matchmaking text", () => {
    expect(tokenize("age 29, Bengaluru")).toEqual(["age", "29", "bengaluru"]);
  });

  it("drops single characters as noise", () => {
    expect(tokenize("a b cafe")).toEqual(["cafe"]);
  });

  it("returns nothing for empty or symbol-only input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("!!! ???")).toEqual([]);
  });
});

describe("HashEmbedder", () => {
  it("returns one vector per input, in order", async () => {
    const out = await embedder.embed(["first", "second", "third"]);
    expect(out).toHaveLength(3);
    expect(out[0]).not.toEqual(out[1]);
  });

  it("returns vectors of the configured dimension", async () => {
    const [vector] = await embedder.embed(["cafes in koramangala"]);
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("returns unit-length vectors", async () => {
    const [vector] = await embedder.embed(["indie hacker building ai tools"]);
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 10);
  });

  it("is deterministic across calls", async () => {
    const [a] = await embedder.embed(["prefers cafes for work"]);
    const [b] = await embedder.embed(["prefers cafes for work"]);
    expect(a).toEqual(b);
  });

  it("is insensitive to case and punctuation", async () => {
    const [a] = await embedder.embed(["Prefers cafes for work."]);
    const [b] = await embedder.embed(["prefers cafes for work"]);
    expect(cosine(a, b)).toBeCloseTo(1, 10);
  });

  it("ranks lexically overlapping text closer than unrelated text", async () => {
    // This is the property tests rely on: a cafe query must beat a hiking chunk.
    const [query, cafe, hiking] = await embedder.embed([
      "quiet cafe to work from",
      "prefers quiet cafes for work",
      "goes trekking in the western ghats",
    ]);
    expect(cosine(query, cafe)).toBeGreaterThan(cosine(query, hiking));
  });

  it("returns an all-zero vector for text with no usable tokens", async () => {
    const [vector] = await embedder.embed(["!!!"]);
    expect(vector.every((value) => value === 0)).toBe(true);
  });

  it("handles an empty batch", async () => {
    expect(await embedder.embed([])).toEqual([]);
  });

  it("honours a custom dimension", async () => {
    const small = new HashEmbedder(8);
    const [vector] = await small.embed(["cafe"]);
    expect(vector).toHaveLength(8);
    expect(small.dimensions).toBe(8);
  });

  it("identifies itself as the hash provider", () => {
    expect(embedder.name).toBe("hash");
  });
});
