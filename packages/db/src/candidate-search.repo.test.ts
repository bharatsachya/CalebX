/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { ForbiddenError, ValidationError } from "@calebx/errors";
import { systemPrincipal, userPrincipal } from "@calebx/authz";
import { EMBEDDING_DIMENSIONS, HashEmbedder } from "@calebx/embed";
import { CandidateSearchRepository } from "./candidate-search.repo.ts";
import { FakeSqlExecutor } from "./executor.ts";

const alice = userPrincipal("tg:1001", "matchmaker");
const embedder = new HashEmbedder();

let sql: FakeSqlExecutor;
let repo: CandidateSearchRepository;

function row(overrides: Record<string, unknown> = {}) {
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
    similarity: 0.82,
    full_name: "Priya R",
    wa_phone: "+919876543210",
    ...overrides,
  };
}

beforeEach(() => {
  sql = new FakeSqlExecutor();
  repo = new CandidateSearchRepository(sql);
});

describe("hard filters", () => {
  it("always constrains discoverable, active state, and consent", async () => {
    await repo.search(alice, { selfCandidateId: "c1" });
    const statement = sql.lastSql();
    expect(statement).toContain("discoverable = true");
    expect(statement).toContain("state = 'active'");
    expect(statement).toContain("consent_granted = true");
  });

  it("excludes the seeker's own row", async () => {
    await repo.search(alice, { selfCandidateId: "c1" });
    expect(sql.lastSql()).toContain("id <> $1");
    expect(sql.calls[0].params[0]).toBe("c1");
  });

  it("binds age bounds rather than interpolating them", async () => {
    await repo.search(alice, { selfCandidateId: "c1", minAge: 27, maxAge: 33 });
    const { sql: statement, params } = sql.calls[0];
    expect(statement).toContain("age(dob)) >= $2");
    expect(statement).toContain("age(dob)) <= $3");
    expect(params).toEqual(["c1", 27, 33, 10]);
  });

  it("filters city as a set, so multiple acceptable cities work", async () => {
    await repo.search(alice, {
      selfCandidateId: "c1",
      cities: ["Bengaluru", "Pune"],
    });
    expect(sql.lastSql()).toContain("city = ANY($2)");
    expect(sql.calls[0].params[1]).toEqual(["Bengaluru", "Pune"]);
  });

  it("casts marital status to its enum type", async () => {
    await repo.search(alice, {
      selfCandidateId: "c1",
      maritalStatuses: ["never_married"],
    });
    expect(sql.lastSql()).toContain(
      "marital_status = ANY($2::marital_status[])",
    );
  });

  it("omits filters that were not asked for", async () => {
    await repo.search(alice, { selfCandidateId: "c1" });
    const statement = sql.lastSql();
    for (const absent of ["city =", "gender =", "community =", "diet ="]) {
      expect(statement).not.toContain(absent);
    }
  });

  it("keeps every structured criterion out of the vector comparison", async () => {
    // The point of the split: "must be in Bengaluru" is a constraint, not a
    // hint for cosine to weigh.
    const [embedding] = await embedder.embed(["easygoing, likes travelling"]);
    await repo.search(alice, {
      selfCandidateId: "c1",
      embedding,
      cities: ["Bengaluru"],
      minAge: 27,
    });
    const statement = sql.lastSql();
    expect(statement).toContain("city = ANY(");
    expect(statement).toContain("age(dob)) >= ");
    expect(statement).toContain("<=>");
  });
});

describe("vector ordering", () => {
  it("orders by cosine distance and reports similarity when given a vector", async () => {
    const [embedding] = await embedder.embed(["quiet, bookish, likes hills"]);
    await repo.search(alice, { selfCandidateId: "c1", embedding });
    const statement = sql.lastSql();
    expect(statement).toContain("1 - (interest_embedding <=>");
    expect(statement).toContain("ORDER BY interest_embedding <=>");
    expect(statement).toContain("::vector ASC");
  });

  it("binds the vector as a pgvector literal string", async () => {
    const [embedding] = await embedder.embed(["hi"]);
    await repo.search(alice, { selfCandidateId: "c1", embedding });
    const bound = sql.calls[0].params.find(
      (p) => typeof p === "string" && p.startsWith("["),
    );
    expect(bound).toBeDefined();
    expect(String(bound).split(",")).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("falls back to recency when no vector is supplied", async () => {
    // Filters alone are a valid search — a user who has told us nothing soft
    // should still get results.
    await repo.search(alice, { selfCandidateId: "c1", cities: ["Pune"] });
    expect(sql.lastSql()).toContain("ORDER BY last_active_at DESC NULLS LAST");
    expect(sql.lastSql()).toContain("NULL AS similarity");
  });

  it("rejects an embedding of the wrong dimension", async () => {
    await expect(
      repo.search(alice, { selfCandidateId: "c1", embedding: [0.1, 0.2] }),
    ).rejects.toThrow(ValidationError);
    expect(sql.calls).toHaveLength(0);
  });

  it("applies the limit, defaulting to 10", async () => {
    await repo.search(alice, { selfCandidateId: "c1", limit: 3 });
    expect(sql.calls[0].params.at(-1)).toBe(3);
  });
});

describe("projection", () => {
  it("strips name and phone from every result", async () => {
    sql.enqueue([row()]);
    const [match] = await repo.search(alice, { selfCandidateId: "c1" });
    const serialized = JSON.stringify(match);
    expect(serialized).not.toContain("Priya");
    expect(serialized).not.toContain("9876543210");
  });

  it("keeps the fields a suggestion is actually made of", async () => {
    sql.enqueue([row()]);
    const [match] = await repo.search(alice, { selfCandidateId: "c1" });
    expect(match).toEqual({
      id: "c2",
      userId: null,
      city: "Bengaluru",
      age: 29,
      community: "Marwari",
      occupation: "Product designer",
      highestEducation: "B.Des",
      diet: "vegetarian",
      interestText: "trekking and filter coffee",
      similarity: 0.82,
    });
  });

  it("drops a row that came back non-discoverable despite the filter", async () => {
    // Defence in depth: if a future edit widens the query, the authorization
    // pass still refuses the row.
    sql.enqueue([row({ discoverable: false })]);
    expect(await repo.search(alice, { selfCandidateId: "c1" })).toEqual([]);
  });

  it("returns an empty list when nothing matched", async () => {
    expect(await repo.search(alice, { selfCandidateId: "c1" })).toEqual([]);
  });
});

describe("principals", () => {
  it("refuses a community-mode principal instead of returning nothing", async () => {
    // Matchmaking candidates are matchmaker-mode data. An empty list would
    // read as "no matches" rather than "wrong mode".
    const community = userPrincipal("tg:1001", "community_connector");
    sql.enqueue([row()]);
    await expect(
      repo.search(community, { selfCandidateId: "c1" }),
    ).rejects.toThrow(/cross-mode/);
    expect(sql.calls).toHaveLength(0);
  });

  it("refuses a system principal outright", async () => {
    await expect(
      repo.search(systemPrincipal("cohort"), { selfCandidateId: "c1" }),
    ).rejects.toThrow(ForbiddenError);
  });
});
