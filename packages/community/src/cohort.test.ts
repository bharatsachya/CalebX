/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import type { KnowsEdge } from "@calebx/graph";
import {
  buildTagCohorts,
  categoriseInterest,
  cohortKey,
  louvainCommunities,
  type CohortInput,
} from "./cohort.ts";

describe("cohortKey", () => {
  it("is lowercase and slugged", () => {
    expect(cohortKey("Cafe", "New Delhi")).toBe("cafe:new-delhi");
  });

  it("collapses punctuation and trims", () => {
    expect(cohortKey(" co-working ", "Bengaluru (South)")).toBe(
      "co-working:bengaluru-south",
    );
  });

  it("is stable for equivalent spellings", () => {
    expect(cohortKey("cafe", "new delhi")).toBe(
      cohortKey("CAFE", "New  Delhi"),
    );
  });
});

describe("categoriseInterest", () => {
  it("maps free text onto a controlled category", () => {
    expect(categoriseInterest("loves filter coffee")).toBe("cafe");
    expect(categoriseInterest("goes trekking in the ghats")).toBe("outdoors");
    expect(categoriseInterest("indie hacker building AI tools")).toBe("tech");
  });

  it("returns null for text that fits no category", () => {
    // A cohort becomes a real group with a real name, so unmatched text must
    // not invent a category.
    expect(categoriseInterest("feeling tired lately")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(categoriseInterest("GYM every morning")).toBe("fitness");
  });
});

describe("buildTagCohorts", () => {
  const users: CohortInput[] = [
    {
      userId: "tg:1",
      city: "Delhi",
      interests: ["loves filter coffee", "reads poetry"],
    },
    { userId: "tg:2", city: "Delhi", interests: ["works from cafes"] },
    { userId: "tg:3", city: "Delhi", interests: ["espresso hunting"] },
    { userId: "tg:4", city: "Pune", interests: ["cafe hopping"] },
  ];

  it("groups users by category and city", () => {
    const cohorts = buildTagCohorts(users);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].cohortKey).toBe("cafe:delhi");
    expect(cohorts[0].members.sort()).toEqual(["tg:1", "tg:2", "tg:3"]);
  });

  it("does not pool different cities into one cohort", () => {
    // A "cafe likers" group spanning two cities is not one anybody wants.
    const cohorts = buildTagCohorts(users, 1);
    const keys = cohorts.map((c) => c.cohortKey);
    expect(keys).toContain("cafe:delhi");
    expect(keys).toContain("cafe:pune");
  });

  it("drops cohorts below the minimum size", () => {
    expect(buildTagCohorts(users, 4)).toEqual([]);
  });

  it("skips users with no city", () => {
    const cohorts = buildTagCohorts(
      [
        { userId: "tg:1", city: null, interests: ["cafe"] },
        { userId: "tg:2", city: null, interests: ["cafe"] },
        { userId: "tg:3", city: null, interests: ["cafe"] },
      ],
      1,
    );
    expect(cohorts).toEqual([]);
  });

  it("counts a user once per category even with several matching interests", () => {
    const cohorts = buildTagCohorts(
      [
        {
          userId: "tg:1",
          city: "Delhi",
          interests: ["cafe", "coffee", "espresso"],
        },
        { userId: "tg:2", city: "Delhi", interests: ["cafe"] },
      ],
      1,
    );
    expect(cohorts[0].members).toEqual(["tg:1", "tg:2"]);
  });

  it("puts a multi-interest user in several cohorts", () => {
    const cohorts = buildTagCohorts(
      [{ userId: "tg:1", city: "Delhi", interests: ["cafe", "trekking"] }],
      1,
    );
    expect(cohorts.map((c) => c.category).sort()).toEqual(["cafe", "outdoors"]);
  });

  it("sorts biggest cohort first", () => {
    const cohorts = buildTagCohorts(
      [
        { userId: "tg:1", city: "Delhi", interests: ["cafe", "gym"] },
        { userId: "tg:2", city: "Delhi", interests: ["cafe"] },
        { userId: "tg:3", city: "Delhi", interests: ["cafe"] },
      ],
      1,
    );
    expect(cohorts[0].category).toBe("cafe");
  });

  it("handles no users", () => {
    expect(buildTagCohorts([])).toEqual([]);
  });

  it("ignores interests that match no category", () => {
    expect(
      buildTagCohorts(
        [{ userId: "tg:1", city: "Delhi", interests: ["feeling tired"] }],
        1,
      ),
    ).toEqual([]);
  });
});

describe("louvainCommunities", () => {
  /** Two dense triangles joined by a single bridge edge. */
  const twoClusters: KnowsEdge[] = [
    { from: "a1", to: "a2", strength: 1 },
    { from: "a2", to: "a3", strength: 1 },
    { from: "a3", to: "a1", strength: 1 },
    { from: "b1", to: "b2", strength: 1 },
    { from: "b2", to: "b3", strength: 1 },
    { from: "b3", to: "b1", strength: 1 },
    { from: "a1", to: "b1", strength: 0.1 },
  ];

  it("separates two dense clusters joined by a weak bridge", () => {
    const communities = louvainCommunities(twoClusters);
    const aSide = new Set(["a1", "a2", "a3"].map((id) => communities.get(id)));
    const bSide = new Set(["b1", "b2", "b3"].map((id) => communities.get(id)));
    expect(aSide.size).toBe(1);
    expect(bSide.size).toBe(1);
    expect([...aSide][0]).not.toBe([...bSide][0]);
  });

  it("returns an empty map for no edges", () => {
    // "Could not cluster" and "everyone is one community" must not look alike.
    expect(louvainCommunities([]).size).toBe(0);
  });

  it("leaves a pair unassigned at the default minimum size", () => {
    const communities = louvainCommunities([
      { from: "x", to: "y", strength: 1 },
    ]);
    expect(communities.size).toBe(0);
  });

  it("assigns a triangle at the default minimum size", () => {
    const communities = louvainCommunities([
      { from: "x", to: "y", strength: 1 },
      { from: "y", to: "z", strength: 1 },
      { from: "z", to: "x", strength: 1 },
    ]);
    expect(communities.size).toBe(3);
  });

  it("honours a custom minimum component size", () => {
    const communities = louvainCommunities(twoClusters, {
      minComponentSize: 10,
    });
    expect(communities.size).toBe(0);
  });

  it("ignores self-loops", () => {
    const communities = louvainCommunities([
      { from: "x", to: "x", strength: 1 },
    ]);
    expect(communities.size).toBe(0);
  });

  it("tolerates duplicate edges in both directions", () => {
    // The graph store writes KNOWS both ways; the same pair must not become
    // two edges with different weights.
    const communities = louvainCommunities([
      { from: "x", to: "y", strength: 1 },
      { from: "y", to: "x", strength: 1 },
      { from: "y", to: "z", strength: 1 },
      { from: "z", to: "x", strength: 1 },
    ]);
    expect(communities.size).toBe(3);
  });

  it("tolerates a non-finite strength", () => {
    const communities = louvainCommunities([
      { from: "x", to: "y", strength: Number.NaN },
      { from: "y", to: "z", strength: 1 },
      { from: "z", to: "x", strength: 1 },
    ]);
    expect(communities.size).toBe(3);
  });
});
