/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { ForbiddenError } from "@calebx/errors";
import {
  CYPHER_BULK_MARKER,
  SQL_BULK_MARKER,
  SQL_DISCOVERABLE_MARKER,
  assertBulkAllowed,
  assertCypherScoped,
  assertSqlScoped,
  ownerPredicate,
  scopedCypher,
  scopedSql,
} from "./scope.ts";
import { adminPrincipal, systemPrincipal, userPrincipal } from "./principal.ts";

const alice = userPrincipal("tg:1001", "matchmaker");
const job = systemPrincipal("cohort-clustering");

describe("assertSqlScoped", () => {
  it("accepts a straightforward owner predicate", () => {
    expect(() =>
      assertSqlScoped("SELECT * FROM candidates WHERE user_id = $1"),
    ).not.toThrow();
  });

  it("accepts a qualified column", () => {
    expect(() =>
      assertSqlScoped("SELECT c.* FROM candidates c WHERE c.user_id = $1"),
    ).not.toThrow();
  });

  it("accepts IN and ANY forms", () => {
    expect(() =>
      assertSqlScoped("SELECT * FROM matches WHERE user_id IN ($1, $2)"),
    ).not.toThrow();
    expect(() =>
      assertSqlScoped("SELECT * FROM matches WHERE user_id = ANY($1)"),
    ).not.toThrow();
  });

  it("accepts the other owner column names", () => {
    for (const column of ["owner_id", "owner_user_id", "user_id_hash"]) {
      expect(() =>
        assertSqlScoped(`SELECT * FROM t WHERE ${column} = $1`),
      ).not.toThrow();
    }
  });

  it("rejects a query with no owner predicate", () => {
    // This is the actual leak: a forgotten WHERE clause returns every row.
    expect(() => assertSqlScoped("SELECT * FROM candidates")).toThrow(
      ForbiddenError,
    );
  });

  it("rejects a query scoped on something that is not an owner", () => {
    expect(() =>
      assertSqlScoped("SELECT * FROM candidates WHERE city = $1"),
    ).toThrow(/unscoped SQL/);
  });

  it("rejects an owner column compared to a literal", () => {
    expect(() =>
      assertSqlScoped("SELECT * FROM candidates WHERE user_id = 'tg:1001'"),
    ).toThrow(/bind it as a parameter/);
  });

  it("rejects a literal even when a parameterised predicate is also present", () => {
    // One bound predicate does not excuse a second, baked-in one.
    expect(() =>
      assertSqlScoped(
        "SELECT * FROM candidates WHERE user_id = $1 OR user_id = 'tg:2002'",
      ),
    ).toThrow(/bind it as a parameter/);
  });

  it("accepts an unscoped query that carries the bulk marker", () => {
    expect(() =>
      assertSqlScoped(`${SQL_BULK_MARKER} SELECT user_id FROM candidates`),
    ).not.toThrow();
  });

  it("is not fooled by the column name appearing inside another word", () => {
    expect(() =>
      assertSqlScoped("SELECT * FROM t WHERE other_user_idx = $1"),
    ).toThrow(/unscoped SQL/);
  });
});

describe("assertCypherScoped", () => {
  it("accepts a query binding $ownerId", () => {
    expect(() =>
      assertCypherScoped(
        "MATCH (u:User {userId: $ownerId})-[:HAS_CHUNK]->(c) RETURN c",
      ),
    ).not.toThrow();
  });

  it("rejects a query with no owner binding", () => {
    expect(() => assertCypherScoped("MATCH (c:PersonaChunk) RETURN c")).toThrow(
      /unscoped Cypher/,
    );
  });

  it("rejects a hard-coded userId", () => {
    expect(() =>
      assertCypherScoped('MATCH (u:User {userId: "tg:1001"}) RETURN u'),
    ).toThrow(/bind it as \$ownerId/);
  });

  it("accepts an unscoped query that carries the bulk marker", () => {
    expect(() =>
      assertCypherScoped(
        `${CYPHER_BULK_MARKER}\nMATCH (a:User)-[:KNOWS]->(b) RETURN a, b`,
      ),
    ).not.toThrow();
  });
});

describe("assertBulkAllowed", () => {
  it("lets a system principal run a bulk query", () => {
    expect(() =>
      assertBulkAllowed(job, `${SQL_BULK_MARKER} SELECT 1`),
    ).not.toThrow();
  });

  it("refuses a bulk query for a user principal", () => {
    expect(() =>
      assertBulkAllowed(alice, `${SQL_BULK_MARKER} SELECT 1`),
    ).toThrow(/requires a system principal/);
  });

  it("refuses a bulk query for an admin too", () => {
    expect(() =>
      assertBulkAllowed(
        adminPrincipal("c1"),
        `${CYPHER_BULK_MARKER}\nMATCH (n) RETURN n`,
      ),
    ).toThrow(/requires a system principal/);
  });

  it("ignores non-bulk statements entirely", () => {
    expect(() =>
      assertBulkAllowed(alice, "SELECT * FROM t WHERE user_id = $1"),
    ).not.toThrow();
  });
});

describe("scopedSql", () => {
  function recordingExecutor() {
    const calls: { sql: string; params?: unknown[] }[] = [];
    return {
      calls,
      async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
        calls.push({ sql, params });
        return [] as T[];
      },
    };
  }

  it("passes a scoped query through to the inner executor", async () => {
    const inner = recordingExecutor();
    await scopedSql(inner, alice).query("SELECT 1 FROM t WHERE user_id = $1", [
      "tg:1001",
    ]);
    expect(inner.calls).toHaveLength(1);
  });

  it("makes an unscoped query impossible to run", async () => {
    const inner = recordingExecutor();
    await expect(
      scopedSql(inner, alice).query("SELECT * FROM candidates"),
    ).rejects.toThrow(ForbiddenError);
    expect(inner.calls).toHaveLength(0);
  });

  it("blocks a user from running a bulk-marked query", async () => {
    const inner = recordingExecutor();
    await expect(
      scopedSql(inner, alice).query(
        `${SQL_BULK_MARKER} SELECT * FROM candidates`,
      ),
    ).rejects.toThrow(/system principal/);
    expect(inner.calls).toHaveLength(0);
  });

  it("lets a system principal run the same bulk query", async () => {
    const inner = recordingExecutor();
    await scopedSql(inner, job).query(
      `${SQL_BULK_MARKER} SELECT * FROM candidates`,
    );
    expect(inner.calls).toHaveLength(1);
  });
});

describe("scopedCypher", () => {
  function recordingExecutor() {
    const calls: { cypher: string; params?: Record<string, unknown> }[] = [];
    return {
      calls,
      async run<T>(
        cypher: string,
        params?: Record<string, unknown>,
      ): Promise<T[]> {
        calls.push({ cypher, params });
        return [] as T[];
      },
    };
  }

  it("passes a scoped query with an ownerId parameter", async () => {
    const inner = recordingExecutor();
    await scopedCypher(inner, alice).run(
      "MATCH (u:User {userId: $ownerId}) RETURN u",
      {
        ownerId: "tg:1001",
      },
    );
    expect(inner.calls).toHaveLength(1);
  });

  it("rejects a scoped query whose ownerId parameter was never bound", async () => {
    // The query text mentions $ownerId but nobody supplied it — Neo4j would
    // throw at runtime; better to fail here with a reason.
    const inner = recordingExecutor();
    await expect(
      scopedCypher(inner, alice).run(
        "MATCH (u:User {userId: $ownerId}) RETURN u",
        {},
      ),
    ).rejects.toThrow(/requires an ownerId parameter/);
    expect(inner.calls).toHaveLength(0);
  });

  it("rejects an unscoped query", async () => {
    const inner = recordingExecutor();
    await expect(
      scopedCypher(inner, alice).run("MATCH (c:PersonaChunk) RETURN c"),
    ).rejects.toThrow(/unscoped Cypher/);
  });

  it("does not require ownerId for a bulk query by a system principal", async () => {
    const inner = recordingExecutor();
    await scopedCypher(inner, job).run(
      `${CYPHER_BULK_MARKER}\nMATCH (a:User)-[:KNOWS]->(b:User) RETURN a, b`,
    );
    expect(inner.calls).toHaveLength(1);
  });
});

describe("ownerPredicate", () => {
  it("builds the clause and the value to bind", () => {
    expect(ownerPredicate(alice)).toEqual({
      clause: "user_id = $1",
      value: "tg:1001",
    });
  });

  it("accepts a column name and parameter index", () => {
    expect(ownerPredicate(alice, "owner_id", 3).clause).toBe("owner_id = $3");
  });

  it("refuses to build one for a non-user principal", () => {
    expect(() => ownerPredicate(job)).toThrow(/has no owner predicate/);
    expect(() => ownerPredicate(adminPrincipal("c1"))).toThrow(
      /has no owner predicate/,
    );
  });
});

describe("discoverable-scoped SQL", () => {
  it("accepts a cross-user search that constrains discoverable", () => {
    // Matchmaking search is a legitimate cross-user read on a user's behalf.
    // What makes it safe is that it can only see people who opted in.
    expect(() =>
      assertSqlScoped(
        `${SQL_DISCOVERABLE_MARKER} SELECT id FROM candidates WHERE discoverable = true`,
      ),
    ).not.toThrow();
  });

  it("accepts the IS TRUE spelling", () => {
    expect(() =>
      assertSqlScoped(
        `${SQL_DISCOVERABLE_MARKER} SELECT id FROM candidates WHERE c.discoverable IS TRUE`,
      ),
    ).not.toThrow();
  });

  it("rejects the marker without the predicate", () => {
    // The marker is a claim; the predicate is the proof. Without the predicate
    // this would be an unrestricted read of every candidate.
    expect(() =>
      assertSqlScoped(`${SQL_DISCOVERABLE_MARKER} SELECT id FROM candidates`),
    ).toThrow(/requires a "discoverable = true" predicate/);
  });

  it("rejects a discoverable = false predicate", () => {
    expect(() =>
      assertSqlScoped(
        `${SQL_DISCOVERABLE_MARKER} SELECT id FROM candidates WHERE discoverable = false`,
      ),
    ).toThrow(/requires a "discoverable = true" predicate/);
  });

  it("does not need a system principal, unlike a bulk query", async () => {
    const calls: string[] = [];
    const inner = {
      async query<T>(sql: string): Promise<T[]> {
        calls.push(sql);
        return [] as T[];
      },
    };
    await scopedSql(inner, alice).query(
      `${SQL_DISCOVERABLE_MARKER} SELECT id FROM candidates WHERE discoverable = true`,
    );
    expect(calls).toHaveLength(1);
  });
});

describe("INSERT statements", () => {
  it("accepts an insert that names the owner column", () => {
    // An insert has no WHERE to scope; naming the column is what scopes it.
    expect(() =>
      assertSqlScoped("INSERT INTO agent_users (user_id) VALUES ($1)"),
    ).not.toThrow();
  });

  it("accepts an upsert with ON CONFLICT", () => {
    expect(() =>
      assertSqlScoped(
        "INSERT INTO mode_consent (user_id, mode) VALUES ($1, $2) ON CONFLICT (user_id, mode) DO NOTHING",
      ),
    ).not.toThrow();
  });

  it("rejects an insert into an owned table that omits the owner column", () => {
    expect(() =>
      assertSqlScoped("INSERT INTO candidates (city) VALUES ($1)"),
    ).toThrow(/unscoped SQL/);
  });

  it("still rejects a literal owner value in a WHERE clause of an upsert", () => {
    expect(() =>
      assertSqlScoped(
        "INSERT INTO t (user_id) VALUES ($1) ON CONFLICT DO UPDATE SET x = 1 WHERE t.user_id = 'tg:1'",
      ),
    ).toThrow(/bind it as a parameter/);
  });
});
