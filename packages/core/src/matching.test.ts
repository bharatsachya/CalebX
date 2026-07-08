import { describe, expect, test } from "bun:test";
import type { MatchableUser } from "@calebx/types";
import {
  pairKey,
  pickRecommendations,
  scorePair,
  sharedInterests,
} from "./matching.ts";

function user(
  over: Partial<MatchableUser> & { telegramId: number },
): MatchableUser {
  return {
    username: "u",
    name: "N",
    city: "London",
    age: "25-34",
    purpose: "meet people",
    interests: [],
    ...over,
  };
}

describe("scorePair", () => {
  test("same city adds 3", () => {
    const a = user({
      telegramId: 1,
      city: "London",
      age: "18-24",
      purpose: "x",
    });
    const b = user({ telegramId: 2, city: "london", age: "45+", purpose: "y" });
    expect(scorePair(a, b)).toBe(3);
  });

  test("empty city does not count as a match", () => {
    const a = user({ telegramId: 1, city: "", age: "18-24", purpose: "x" });
    const b = user({ telegramId: 2, city: "", age: "45+", purpose: "y" });
    expect(scorePair(a, b)).toBe(0);
  });

  test("purpose overlap adds 2 once", () => {
    const a = user({
      telegramId: 1,
      city: "A",
      purpose: "meet people, discover places",
      age: "18-24",
    });
    const b = user({
      telegramId: 2,
      city: "B",
      purpose: "discover places",
      age: "45+",
    });
    expect(scorePair(a, b)).toBe(2);
  });

  test("same age bucket +1, adjacent +0.5, far apart +0", () => {
    // distinct cities + non-overlapping purposes so only age contributes
    const a = (age: string) =>
      user({ telegramId: 1, age, city: "A", purpose: "x" });
    const b = (age: string) =>
      user({ telegramId: 2, age, city: "B", purpose: "y" });
    expect(scorePair(a("25-34"), b("25-34"))).toBe(1);
    expect(scorePair(a("25-34"), b("35-44"))).toBe(0.5);
    expect(scorePair(a("18-24"), b("45+"))).toBe(0);
  });

  test("interest Jaccard is weighted x5", () => {
    const a = user({
      telegramId: 1,
      city: "A",
      purpose: "x",
      age: "18-24",
      interests: ["hiking", "coffee"],
    });
    const b = user({
      telegramId: 2,
      city: "B",
      purpose: "y",
      age: "45+",
      interests: ["hiking", "coffee"],
    });
    // identical sets → jaccard 1 → 5
    expect(scorePair(a, b)).toBe(5);
  });

  test("interest matching is case-insensitive and partial", () => {
    const a = user({
      telegramId: 1,
      city: "A",
      purpose: "x",
      age: "18-24",
      interests: ["Hiking", "Coffee"],
    });
    const b = user({
      telegramId: 2,
      city: "B",
      purpose: "y",
      age: "45+",
      interests: ["hiking", "tennis"],
    });
    // intersection {hiking}=1, union {hiking,coffee,tennis}=3 → 5*(1/3)
    expect(scorePair(a, b)).toBeCloseTo(5 / 3);
  });
});

describe("sharedInterests", () => {
  test("returns lowercased intersection without duplicates", () => {
    const a = user({
      telegramId: 1,
      interests: ["Hiking", "Coffee", "hiking"],
    });
    const b = user({
      telegramId: 2,
      interests: ["hiking", "coffee", "tennis"],
    });
    expect(sharedInterests(a, b).sort()).toEqual(["coffee", "hiking"]);
  });
});

describe("pairKey", () => {
  test("is order-independent", () => {
    expect(pairKey(1, 2)).toBe(pairKey(2, 1));
  });
});

describe("pickRecommendations", () => {
  const opts = { minScore: 3, existingPairs: new Set<string>(), maxPerUser: 1 };

  test("never pairs a user with themself and respects min score", () => {
    const users = [
      user({ telegramId: 1, city: "London", interests: ["a"] }),
      user({
        telegramId: 2,
        city: "Paris",
        interests: ["b"],
        purpose: "z",
        age: "45+",
      }),
    ];
    // different city, no purpose overlap, far age, no shared interest → below min
    expect(pickRecommendations(users, opts)).toEqual([]);
  });

  test("picks highest-scoring pair first and caps one per user", () => {
    const users = [
      user({ telegramId: 1, city: "London", interests: ["hiking", "coffee"] }),
      user({ telegramId: 2, city: "London", interests: ["hiking", "coffee"] }),
      user({ telegramId: 3, city: "London", interests: ["hiking"] }),
    ];
    const picked = pickRecommendations(users, opts);
    // 1-2 is the strongest; with maxPerUser 1, user 3 cannot also pair with 1 or 2
    expect(picked).toHaveLength(1);
    expect(pairKey(picked[0]!.aTelegramId, picked[0]!.bTelegramId)).toBe(
      pairKey(1, 2),
    );
    expect(picked[0]!.shared.sort()).toEqual(["coffee", "hiking"]);
  });

  test("skips pairs already recommended", () => {
    const users = [
      user({ telegramId: 1, city: "London", interests: ["hiking"] }),
      user({ telegramId: 2, city: "London", interests: ["hiking"] }),
    ];
    const existing = new Set<string>([pairKey(1, 2)]);
    expect(
      pickRecommendations(users, { ...opts, existingPairs: existing }),
    ).toEqual([]);
  });

  test("allows more per user when maxPerUser is raised", () => {
    const users = [
      user({ telegramId: 1, city: "London", interests: ["hiking", "coffee"] }),
      user({ telegramId: 2, city: "London", interests: ["hiking", "coffee"] }),
      user({ telegramId: 3, city: "London", interests: ["hiking", "coffee"] }),
    ];
    const picked = pickRecommendations(users, { ...opts, maxPerUser: 2 });
    // triangle: all three pairs qualify, each user appears at most twice
    expect(picked.length).toBe(3);
  });
});
