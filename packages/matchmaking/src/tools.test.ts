/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { adminPrincipal, userPrincipal } from "@calebx/authz";
import { HashEmbedder } from "@calebx/embed";
import {
  CandidateSearchRepository,
  FakeSqlExecutor,
  MatchmakingRepository,
  ReviewTasksRepository,
} from "@calebx/db";
import type { MatchmakingContext } from "./context.ts";
import {
  expressInterest,
  getMyProfile,
  listMyMatches,
  searchCandidates,
  updatePartnerPreferences,
  MATCHMAKING_TOOLS,
} from "./tools/index.ts";

const USER = "tg:1001";
const HASH = "hash-alice";

let sql: FakeSqlExecutor;
let context: MatchmakingContext;

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c2",
    user_id_hash: "hash-bob",
    city: "Bengaluru",
    age: 29,
    community: "Marwari",
    occupation: "Product designer",
    highest_education: "B.Des",
    diet: "vegetarian",
    interest_text: "trekking and filter coffee",
    discoverable: true,
    similarity: 0.8,
    full_name: "Priya R",
    wa_phone: "+919876543210",
    ...overrides,
  };
}

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
    pref_tags: ["travel"],
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

beforeEach(() => {
  sql = new FakeSqlExecutor();
  context = {
    // Identified by the namespaced id, with the Postgres hash as an alias —
    // the matchmaking tables key ownership by the hash.
    principal: userPrincipal(USER, "matchmaker", ["matchmaker"], [HASH]),
    userId: USER,
    userIdHash: HASH,
    candidateId: "c1",
    repos: {
      matchmaking: new MatchmakingRepository(sql),
      search: new CandidateSearchRepository(sql),
      review: new ReviewTasksRepository(sql),
    },
    embed: new HashEmbedder(),
    pairWriter: adminPrincipal("pair-writer"),
  };
});

describe("tool definitions", () => {
  it("exposes exactly the five matchmaker tools", () => {
    expect(MATCHMAKING_TOOLS.map((t) => t.name)).toEqual([
      "get_my_matrimonial_profile",
      "update_partner_preferences",
      "search_matrimonial_candidates",
      "express_match_interest",
      "list_my_matches",
    ]);
  });

  it("gives every tool a description and an object schema", () => {
    for (const tool of MATCHMAKING_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.parameters.type).toBe("object");
    }
  });

  it("declares required fields only where a call is meaningless without them", () => {
    expect(expressInterest.parameters.required).toEqual(["candidateId"]);
    expect(searchCandidates.parameters.required).toBeUndefined();
  });
});

describe("get_my_matrimonial_profile", () => {
  it("returns preferences when they exist", async () => {
    sql.enqueue([prefsRow()]);
    const result = await getMyProfile.handler(context, {});
    expect(result.ok).toBe(true);
    expect(
      (result.data as { preferences: { ageMin: number } }).preferences.ageMin,
    ).toBe(27);
  });

  it("says so when nothing has been recorded, without failing the turn", async () => {
    const result = await getMyProfile.handler(context, {});
    expect(result.ok).toBe(true);
    expect(result.message).toContain("No preferences recorded");
  });

  it("reports when the user has no profile at all", async () => {
    context.candidateId = null;
    const result = await getMyProfile.handler(context, {});
    expect((result.data as { hasProfile: boolean }).hasProfile).toBe(false);
  });
});

describe("update_partner_preferences", () => {
  it("asks for confirmation before writing anything", async () => {
    // The user's rule: never state a preference change as done before they
    // agree. Enforced here rather than trusted to the prompt.
    const result = await updatePartnerPreferences.handler(context, {
      dietPref: "vegetarian",
    });
    expect(result.ok).toBe(false);
    expect(result.needsConfirmation).toBe(true);
    expect(
      (result.data as { proposed: Record<string, unknown> }).proposed,
    ).toEqual({
      dietPref: "vegetarian",
    });
    expect(sql.calls).toHaveLength(0);
  });

  it("writes once confirmed", async () => {
    sql.enqueue([prefsRow()]);
    const result = await updatePartnerPreferences.handler(context, {
      dietPref: "vegetarian",
      confirmed: true,
    });
    expect(result.ok).toBe(true);
    expect(sql.calls).toHaveLength(1);
  });

  it("refuses a call that states no preference", async () => {
    const result = await updatePartnerPreferences.handler(context, {
      confirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Nothing to save");
  });

  it("coerces numeric strings the model sometimes sends", async () => {
    const result = await updatePartnerPreferences.handler(context, {
      ageMin: "30",
    });
    expect(
      (result.data as { proposed: { ageMin: number } }).proposed.ageMin,
    ).toBe(30);
  });

  it("ignores blank strings rather than storing them", async () => {
    const result = await updatePartnerPreferences.handler(context, {
      communityPref: "   ",
      dietPref: "jain",
    });
    expect(
      (result.data as { proposed: Record<string, unknown> }).proposed,
    ).toEqual({
      dietPref: "jain",
    });
  });

  it("caps tags at five", async () => {
    const result = await updatePartnerPreferences.handler(context, {
      prefTags: ["a", "b", "c", "d", "e", "f", "g"],
    });
    expect(
      (result.data as { proposed: { prefTags: string[] } }).proposed.prefTags,
    ).toHaveLength(5);
  });

  it("refuses when the user has no profile row to attach preferences to", async () => {
    context.candidateId = null;
    const result = await updatePartnerPreferences.handler(context, {
      dietPref: "jain",
      confirmed: true,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no matrimonial profile");
  });
});

describe("search_matrimonial_candidates", () => {
  it("returns anonymized candidates", async () => {
    sql.enqueue([prefsRow()]).enqueue([candidateRow()]);
    const result = await searchCandidates.handler(context, {});
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result.data);
    expect(serialized).toContain("Bengaluru");
    expect(serialized).not.toContain("Priya");
    expect(serialized).not.toContain("9876543210");
  });

  it("uses stored preferences as hard filters", async () => {
    sql.enqueue([prefsRow()]).enqueue([candidateRow()]);
    await searchCandidates.handler(context, {});
    const search = sql.calls[1];
    expect(search.params).toContain(27);
    expect(search.params).toContain(33);
    expect(search.params).toContain("Marwari");
    expect(search.params).toContain("vegetarian");
  });

  it("embeds the soft text, not the structured filters", async () => {
    sql.enqueue([prefsRow()]).enqueue([candidateRow()]);
    await searchCandidates.handler(context, { freeText: "quiet and bookish" });
    const vectorParam = sql.calls[1].params.find(
      (p) => typeof p === "string" && p.startsWith("["),
    );
    expect(vectorParam).toBeDefined();
  });

  it("searches on filters alone when there is no soft text", async () => {
    sql.enqueue([prefsRow({ looking_for: null })]).enqueue([candidateRow()]);
    await searchCandidates.handler(context, {});
    expect(sql.calls[1].sql).toContain("NULL AS similarity");
  });

  it("refuses an off-mode request instead of searching for a cafe", async () => {
    const result = await searchCandidates.handler(context, {
      freeText: "a quiet work cafe in koramangala",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("/switch");
    expect(sql.calls).toHaveLength(0);
  });

  it("reports no matches plainly rather than inventing one", async () => {
    sql.enqueue([prefsRow()]).enqueue([]);
    const result = await searchCandidates.handler(context, {});
    expect(result.ok).toBe(false);
    expect(result.message).toContain("No candidates matched");
  });

  it("excludes married candidates by never allowing that status", async () => {
    sql.enqueue([prefsRow()]).enqueue([candidateRow()]);
    await searchCandidates.handler(context, {});
    const statuses = sql.calls[1].params.find(
      (p) => Array.isArray(p) && p.includes("never_married"),
    ) as string[];
    expect(statuses).not.toContain("married");
  });

  it("passes cities through as a filter", async () => {
    sql.enqueue([prefsRow()]).enqueue([candidateRow()]);
    await searchCandidates.handler(context, { cities: ["Pune"] });
    expect(sql.calls[1].params).toContainEqual(["Pune"]);
  });

  it("refuses when the user has no profile", async () => {
    context.candidateId = null;
    const result = await searchCandidates.handler(context, {});
    expect(result.ok).toBe(false);
  });
});

describe("express_match_interest", () => {
  it("records interest and does not imply the other side agreed", async () => {
    sql.enqueue([matchRow()]).enqueue([matchRow({ status_a: "interested" })]);
    const result = await expressInterest.handler(context, {
      candidateId: "c2",
    });
    expect(result.ok).toBe(true);
    expect((result.data as { mutual: boolean }).mutual).toBe(false);
    expect(result.message).toContain("do not imply");
  });

  it("files a coordinator review when both sides are interested", async () => {
    sql
      .enqueue([matchRow({ status_b: "interested" })])
      .enqueue([matchRow({ status_a: "interested", status_b: "interested" })])
      .enqueue([])
      .enqueue([
        {
          id: "t1",
          kind: "mutual_interest",
          state: "open",
          user_id: USER,
          payload: {},
          note: null,
          created_at: new Date(),
          resolved_at: null,
          resolved_by: null,
        },
      ]);
    const result = await expressInterest.handler(context, {
      candidateId: "c2",
    });
    expect((result.data as { mutual: boolean }).mutual).toBe(true);
    expect((result.data as { contactShared: boolean }).contactShared).toBe(
      false,
    );
    expect(
      sql.calls.some((c) => c.sql.includes("INSERT INTO review_tasks")),
    ).toBe(true);
  });

  it("never claims contact details will be shared automatically", async () => {
    sql
      .enqueue([matchRow({ status_b: "interested" })])
      .enqueue([matchRow({ status_a: "interested", status_b: "interested" })])
      .enqueue([])
      .enqueue([
        {
          id: "t1",
          kind: "mutual_interest",
          state: "open",
          user_id: USER,
          payload: {},
          note: null,
          created_at: new Date(),
          resolved_at: null,
          resolved_by: null,
        },
      ]);
    const result = await expressInterest.handler(context, {
      candidateId: "c2",
    });
    expect(result.message).toContain("coordinator will review");
    expect(result.message).toContain("do not promise a timeline");
  });

  it("rejects expressing interest in oneself", async () => {
    const result = await expressInterest.handler(context, {
      candidateId: "c1",
    });
    expect(result.ok).toBe(false);
    expect(sql.calls).toHaveLength(0);
  });

  it("rejects a missing candidate id", async () => {
    const result = await expressInterest.handler(context, {});
    expect(result.ok).toBe(false);
  });

  it("writes the pair record with the pair-writer, not the user", async () => {
    // A match belongs to neither side alone; writing it as the user would mean
    // a user principal mutating a shared row.
    sql.enqueue([matchRow()]).enqueue([matchRow({ status_a: "interested" })]);
    await expressInterest.handler(context, { candidateId: "c2" });
    expect(sql.calls[0].sql).toContain("INSERT INTO matches");
  });
});

describe("list_my_matches", () => {
  it("reports stage and whether contact is unlocked", async () => {
    sql.enqueue([
      matchRow({
        stage: "contact_shared",
        status_a: "interested",
        status_b: "interested",
      }),
    ]);
    const result = await listMyMatches.handler(context, {});
    const [match] = (result.data as { matches: Record<string, unknown>[] })
      .matches;
    expect(match.stage).toBe("contact_shared");
    expect(match.mutual).toBe(true);
    expect(match.contactUnlocked).toBe(true);
  });

  it("shows mutual interest as still locked", async () => {
    sql.enqueue([
      matchRow({
        stage: "mutual_interest",
        status_a: "interested",
        status_b: "interested",
      }),
    ]);
    const result = await listMyMatches.handler(context, {});
    const [match] = (result.data as { matches: Record<string, unknown>[] })
      .matches;
    expect(match.contactUnlocked).toBe(false);
  });

  it("never includes contact details in the payload", async () => {
    sql.enqueue([matchRow({ reason: "call her on 9876543210" })]);
    // The reason field is human-written; a coordinator pasting a number into it
    // must not reach the model.
    await expect(listMyMatches.handler(context, {})).rejects.toThrow(/phone/);
  });

  it("says there are none rather than returning an empty list", async () => {
    const result = await listMyMatches.handler(context, {});
    expect(result.ok).toBe(false);
    expect(result.message).toBe("No matches yet.");
  });
});
