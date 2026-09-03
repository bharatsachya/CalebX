/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { ForbiddenError, ValidationError } from "@calebx/errors";
import { adminPrincipal, userPrincipal } from "@calebx/authz";
import {
  MatchmakingRepository,
  isContactUnlocked,
  isMutual,
  orderPair,
  type MatchRecord,
} from "./matchmaking.repo.ts";
import { FakeSqlExecutor } from "./executor.ts";

const HASH_A = "hash-alice";
const alice = userPrincipal(HASH_A, "matchmaker");
const admin = adminPrincipal("coordinator-1");

function prefsRow(overrides: Record<string, unknown> = {}) {
  return {
    candidate_id: "c1",
    age_min: 27,
    age_max: 33,
    community_pref: "Marwari",
    income_min: null,
    education_pref: null,
    diet_pref: "vegetarian",
    looking_for: "someone easygoing who travels",
    pref_tags: ["travel", "books"],
    ...overrides,
  };
}

function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    candidate_a: "c1",
    candidate_b: "c2",
    stage: "suggested",
    status_a: "pending",
    status_b: "pending",
    reason: null,
    score: null,
    ...overrides,
  };
}

let sql: FakeSqlExecutor;
let repo: MatchmakingRepository;

beforeEach(() => {
  sql = new FakeSqlExecutor();
  repo = new MatchmakingRepository(sql);
});

describe("orderPair", () => {
  it("orders canonically so the pair-uniqueness constraint holds", () => {
    expect(orderPair("c2", "c1")).toEqual(["c1", "c2"]);
    expect(orderPair("c1", "c2")).toEqual(["c1", "c2"]);
  });
});

describe("getPrefs", () => {
  it("returns null when the user has stated no preferences yet", async () => {
    expect(await repo.getPrefs(alice, HASH_A)).toBeNull();
  });

  it("maps a row, defaulting missing tags to an empty list", async () => {
    sql.enqueue([prefsRow({ pref_tags: null })]);
    const prefs = await repo.getPrefs(alice, HASH_A);
    expect(prefs?.prefTags).toEqual([]);
    expect(prefs?.ageMin).toBe(27);
    expect(prefs?.lookingFor).toBe("someone easygoing who travels");
  });

  it("scopes the lookup to the owner's hash", async () => {
    await repo.getPrefs(alice, HASH_A);
    expect(sql.lastSql()).toContain("WHERE c.user_id_hash = $1");
    expect(sql.calls[0].params).toEqual([HASH_A]);
  });

  it("refuses another user's preferences", async () => {
    await expect(repo.getPrefs(alice, "hash-bob")).rejects.toThrow(
      ForbiddenError,
    );
    expect(sql.calls).toHaveLength(0);
  });
});

describe("updatePrefs", () => {
  it("writes only the supplied fields and keeps the rest", async () => {
    // A turn that establishes one fact must not blank the other nine.
    sql.enqueue([prefsRow()]);
    await repo.updatePrefs(alice, HASH_A, "c1", { dietPref: "vegetarian" });
    const statement = sql.lastSql();
    expect(statement).toContain(
      "diet_pref = coalesce(EXCLUDED.diet_pref, partner_prefs.diet_pref)",
    );
    expect(sql.calls[0].params).toEqual([
      "c1",
      null,
      null,
      null,
      null,
      null,
      "vegetarian",
      null,
      null,
    ]);
  });

  it("serialises tags as jsonb", async () => {
    sql.enqueue([prefsRow()]);
    await repo.updatePrefs(alice, HASH_A, "c1", { prefTags: ["travel"] });
    expect(sql.calls[0].params.at(-1)).toBe('["travel"]');
  });

  it("rejects an inverted age range instead of storing it", async () => {
    // Stored inverted, this silently matches nobody and looks like "no results".
    await expect(
      repo.updatePrefs(alice, HASH_A, "c1", { ageMin: 40, ageMax: 30 }),
    ).rejects.toThrow(/age range is inverted/);
    expect(sql.calls).toHaveLength(0);
  });

  it("allows a single-ended range", async () => {
    sql.enqueue([prefsRow()]);
    await expect(
      repo.updatePrefs(alice, HASH_A, "c1", { ageMin: 30 }),
    ).resolves.toBeDefined();
  });

  it("throws when the upsert returns nothing", async () => {
    await expect(
      repo.updatePrefs(alice, HASH_A, "c1", { ageMin: 30 }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses to write another user's preferences", async () => {
    await expect(
      repo.updatePrefs(alice, "hash-bob", "c2", { ageMin: 30 }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("listMatches", () => {
  it("returns matches on either side of the pair", async () => {
    sql.enqueue([
      matchRow(),
      matchRow({ id: "m2", candidate_a: "c0", candidate_b: "c1" }),
    ]);
    const matches = await repo.listMatches(alice, HASH_A);
    expect(matches.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(sql.lastSql()).toContain("c.id IN (m.candidate_a, m.candidate_b)");
  });

  it("scopes to the owner and applies a limit", async () => {
    await repo.listMatches(alice, HASH_A, 5);
    expect(sql.calls[0].params).toEqual([HASH_A, 5]);
  });

  it("refuses another user's matches", async () => {
    await expect(repo.listMatches(alice, "hash-bob")).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("recordSuggestion", () => {
  it("orders the pair before inserting", async () => {
    sql.enqueue([matchRow()]);
    await repo.recordSuggestion(admin, "c2", "c1", "shared interests", 80);
    expect(sql.calls[0].params.slice(0, 2)).toEqual(["c1", "c2"]);
  });

  it("does not clobber an existing reason with null", async () => {
    sql.enqueue([matchRow()]);
    await repo.recordSuggestion(admin, "c1", "c2", null, null);
    expect(sql.lastSql()).toContain(
      "reason = coalesce(EXCLUDED.reason, matches.reason)",
    );
  });

  it("refuses a user — a match is not something one side creates", async () => {
    await expect(
      repo.recordSuggestion(alice, "c1", "c2", null, null),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("setStatus", () => {
  const match: MatchRecord = {
    id: "m1",
    candidateA: "c1",
    candidateB: "c2",
    stage: "suggested",
    statusA: "pending",
    statusB: "pending",
    reason: null,
    score: null,
  };

  it("writes side A's column when the actor is candidate A", async () => {
    sql.enqueue([matchRow({ status_a: "interested" })]);
    await repo.setStatus(admin, match, "c1", "interested");
    expect(sql.lastSql()).toContain("SET status_a = $2");
  });

  it("writes side B's column when the actor is candidate B", async () => {
    // Getting this backwards records the wrong person's answer.
    sql.enqueue([matchRow({ status_b: "declined" })]);
    await repo.setStatus(admin, match, "c2", "declined");
    expect(sql.lastSql()).toContain("SET status_b = $2");
  });

  it("refuses an actor who is not in the match", async () => {
    await expect(
      repo.setStatus(admin, match, "c9", "interested"),
    ).rejects.toThrow(/not part of this match/);
    expect(sql.calls).toHaveLength(0);
  });
});

describe("isMutual", () => {
  const base: MatchRecord = {
    id: "m1",
    candidateA: "c1",
    candidateB: "c2",
    stage: "suggested",
    statusA: "pending",
    statusB: "pending",
    reason: null,
    score: null,
  };

  it("is true only when both sides said yes", () => {
    expect(
      isMutual({ ...base, statusA: "interested", statusB: "interested" }),
    ).toBe(true);
  });

  it("is false when only one side has answered", () => {
    expect(isMutual({ ...base, statusA: "interested" })).toBe(false);
    expect(isMutual({ ...base, statusB: "interested" })).toBe(false);
  });

  it("is false when either side declined", () => {
    expect(
      isMutual({ ...base, statusA: "interested", statusB: "declined" }),
    ).toBe(false);
  });
});

describe("isContactUnlocked", () => {
  const base: MatchRecord = {
    id: "m1",
    candidateA: "c1",
    candidateB: "c2",
    stage: "suggested",
    statusA: "interested",
    statusB: "interested",
    reason: null,
    score: null,
  };

  it("stays locked at mutual interest — a coordinator has not acted yet", () => {
    // Mutual interest is the trigger for review, not the reveal itself.
    expect(isContactUnlocked({ ...base, stage: "mutual_interest" })).toBe(
      false,
    );
    expect(isContactUnlocked({ ...base, stage: "suggested" })).toBe(false);
  });

  it("unlocks from contact_shared onward", () => {
    for (const stage of ["contact_shared", "meeting", "progressing"] as const) {
      expect(isContactUnlocked({ ...base, stage })).toBe(true);
    }
  });

  it("stays locked once closed", () => {
    expect(isContactUnlocked({ ...base, stage: "closed" })).toBe(false);
  });
});
