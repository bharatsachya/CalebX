/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { cosine, normalize, topK } from "./similarity.ts";

describe("normalize", () => {
  it("scales to unit length", () => {
    const out = normalize([3, 4]);
    expect(out).toEqual([0.6, 0.8]);
  });

  it("leaves an already-unit vector alone", () => {
    expect(normalize([1, 0, 0])).toEqual([1, 0, 0]);
  });

  it("returns a zero vector unchanged instead of dividing by zero", () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("does not mutate the input", () => {
    const input = [3, 4];
    normalize(input);
    expect(input).toEqual([3, 4]);
  });

  it("handles negative components", () => {
    expect(normalize([-3, 4])).toEqual([-0.6, 0.8]);
  });
});

describe("cosine", () => {
  it("is 1 for identical unit vectors", () => {
    expect(cosine([1, 0], [1, 0])).toBe(1);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it("is -1 for opposite vectors", () => {
    expect(cosine([1, 0], [-1, 0])).toBe(-1);
  });

  it("clamps floating-point overshoot to 1", () => {
    // A normalised vector dotted with itself can land a hair above 1.
    const v = normalize([0.1, 0.2, 0.3, 0.4]);
    expect(cosine(v, v)).toBeLessThanOrEqual(1);
    expect(cosine(v, v)).toBeGreaterThan(0.999999);
  });

  it("throws on a dimension mismatch rather than returning a wrong number", () => {
    expect(() => cosine([1, 0], [1, 0, 0])).toThrow(/dimension mismatch/);
  });

  it("is 0 against a zero vector", () => {
    expect(cosine([1, 0], [0, 0])).toBe(0);
  });
});

describe("topK", () => {
  const items = [
    { id: "a", v: [1, 0] },
    { id: "b", v: [0.7071, 0.7071] },
    { id: "c", v: [0, 1] },
  ];
  const toEmbedding = (item: { v: number[] }) => item.v;

  it("returns the k closest, most similar first", () => {
    const out = topK([1, 0], items, toEmbedding, 2);
    expect(out.map((s) => s.item.id)).toEqual(["a", "b"]);
    expect(out[0].score).toBe(1);
  });

  it("returns everything when k exceeds the item count", () => {
    expect(topK([1, 0], items, toEmbedding, 99)).toHaveLength(3);
  });

  it("returns nothing for k of zero or less", () => {
    expect(topK([1, 0], items, toEmbedding, 0)).toEqual([]);
    expect(topK([1, 0], items, toEmbedding, -1)).toEqual([]);
  });

  it("handles an empty item list", () => {
    expect(topK([1, 0], [], toEmbedding, 3)).toEqual([]);
  });

  it("breaks ties on input order, so a recency pre-sort survives", () => {
    const tied = [
      { id: "newer", v: [1, 0] },
      { id: "older", v: [1, 0] },
    ];
    expect(topK([1, 0], tied, toEmbedding, 2).map((s) => s.item.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("keeps negative scores rather than filtering them", () => {
    // Filtering is the caller's decision; a threshold belongs in the ranker.
    const out = topK([1, 0], [{ id: "opposite", v: [-1, 0] }], toEmbedding, 1);
    expect(out[0].score).toBe(-1);
  });
});
