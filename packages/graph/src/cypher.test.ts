/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import {
  CYPHER_BULK_MARKER,
  assertCypherScoped,
  isCypherScoped,
} from "@calebx/authz";
import { EMBEDDING_DIMENSIONS } from "@calebx/embed";
import * as Q from "./cypher.ts";
import { CHUNK_VECTOR_INDEX, SCHEMA_STATEMENTS } from "./schema.ts";

describe("every Cypher statement is scoped or explicitly bulk", () => {
  // This is the mechanical guarantee behind "a user can never read another
  // user's data": a statement that neither binds $ownerId nor declares itself
  // bulk cannot exist in this file without failing here.
  for (const [name, statement] of Object.entries(Q.ALL_STATEMENTS)) {
    it(name, () => {
      expect(() => assertCypherScoped(statement)).not.toThrow();
    });
  }

  it("covers every exported statement, so nothing escapes the check", () => {
    const exported = Object.entries(Q)
      .filter(
        ([name, value]) =>
          typeof value === "string" && name !== "ALL_STATEMENTS",
      )
      .map(([name]) => name);
    expect(Object.keys(Q.ALL_STATEMENTS).sort()).toEqual(exported.sort());
  });
});

describe("bulk statements are marked, user statements are not", () => {
  const BULK = [
    "UPSERT_GROUP",
    "GROUPS_BY_COHORT",
    "ALL_KNOWS_EDGES",
    "ALL_USER_INTERESTS",
    "SET_COMMUNITY_ID",
  ];

  it("marks exactly the cross-user statements", () => {
    const marked = Object.entries(Q.ALL_STATEMENTS)
      .filter(([, statement]) => statement.includes(CYPHER_BULK_MARKER))
      .map(([name]) => name);
    expect(marked.sort()).toEqual(BULK.sort());
  });

  it("binds $ownerId in every non-bulk statement", () => {
    for (const [name, statement] of Object.entries(Q.ALL_STATEMENTS)) {
      if (BULK.includes(name)) continue;
      expect(isCypherScoped(statement)).toBe(true);
    }
  });
});

describe("traversal shape", () => {
  it("excludes the requester and existing friends from second-degree results", () => {
    expect(Q.SECOND_DEGREE).toContain("peer.userId <> $ownerId");
    expect(Q.SECOND_DEGREE).toContain("NOT (me)-[:KNOWS]-(peer)");
  });

  it("returns discoverability rather than filtering on it in Cypher", () => {
    // The visibility decision belongs to the authorization layer, in one place.
    expect(Q.SECOND_DEGREE).toContain("discoverable");
    expect(Q.SECOND_DEGREE).not.toContain("WHERE peer.discoverable = true");
  });

  it("constrains the vector search to the owner after probing the index", () => {
    expect(Q.SEARCH_OWN_CHUNKS).toContain(CHUNK_VECTOR_INDEX);
    const matchIndex = Q.SEARCH_OWN_CHUNKS.indexOf(
      "MATCH (u:User {userId: $ownerId})",
    );
    const callIndex = Q.SEARCH_OWN_CHUNKS.indexOf("CALL db.index.vector");
    expect(callIndex).toBeGreaterThanOrEqual(0);
    expect(matchIndex).toBeGreaterThan(callIndex);
  });

  it("deletes chunks along with the user, so /forget leaves nothing behind", () => {
    expect(Q.DELETE_USER).toContain("DETACH DELETE c, u");
  });

  it("never updates a chunk in place", () => {
    // Chunks are immutable; a contradiction writes a new one.
    for (const [name, statement] of Object.entries(Q.ALL_STATEMENTS)) {
      if (name === "ADD_CHUNK") continue;
      expect(statement).not.toMatch(/SET\s+c\.(text|embedding|category)/);
    }
  });
});

describe("schema statements", () => {
  it("uses the shared embedding dimension", () => {
    const vectorIndex = SCHEMA_STATEMENTS.find((s) =>
      s.includes("VECTOR INDEX"),
    )!;
    expect(vectorIndex).toContain(
      `\`vector.dimensions\`: ${EMBEDDING_DIMENSIONS}`,
    );
    expect(vectorIndex).toContain("'cosine'");
  });

  it("is idempotent — every statement is IF NOT EXISTS", () => {
    for (const statement of SCHEMA_STATEMENTS) {
      expect(statement).toContain("IF NOT EXISTS");
    }
  });

  it("declares uniqueness on every identifier we merge on", () => {
    const constraints = SCHEMA_STATEMENTS.filter((s) =>
      s.includes("CONSTRAINT"),
    ).join("\n");
    for (const field of ["u.userId", "g.groupId", "p.placeId", "c.chunkId"]) {
      expect(constraints).toContain(`${field} IS UNIQUE`);
    }
  });
});
