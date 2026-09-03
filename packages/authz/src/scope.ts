import { ForbiddenError } from "@calebx/errors";
import type { Principal } from "./principal.ts";

/**
 * Query-level enforcement.
 *
 * The policy in `policy.ts` guards code paths. This guards the *queries* — because
 * the failure mode that actually leaks data is not a missing `assertAuthorized`,
 * it is a `SELECT` that forgot its `WHERE user_id = $1` and cheerfully returned
 * every row. A policy check cannot see that; a query check can.
 *
 * Every SQL statement and Cypher query that runs through a scoped executor must
 * either constrain an owner column to a bound parameter, or carry an explicit
 * bulk marker. There is no third option and no default-allow.
 */

/** Columns that identify the row's owner. */
const OWNER_COLUMNS = [
  "user_id",
  "owner_id",
  "owner_user_id",
  "user_id_hash",
] as const;

/** Opt out, deliberately and visibly. Reserved for system-principal jobs. */
export const SQL_BULK_MARKER = "/* authz:bulk */";
export const CYPHER_BULK_MARKER = "// authz:bulk";

/**
 * The third kind of legitimate query: a user searching *other* users.
 *
 * Matchmaking and people discovery genuinely cross users on a user's behalf, so
 * neither an owner predicate nor a system principal fits. What makes it safe is
 * that the query may only see people who opted in — so a statement carrying
 * this marker must also constrain `discoverable`, and that is checked here
 * rather than trusted.
 */
export const SQL_DISCOVERABLE_MARKER = "/* authz:discoverable */";

const ownerColumnGroup = OWNER_COLUMNS.join("|");

/** `user_id = $1`, `c.user_id=$2`, `user_id IN ($1, $2)`, `user_id = ANY($1)`. */
const SCOPED_SQL = new RegExp(
  `(?:^|[\\s.(,])(?:${ownerColumnGroup})\\s*(?:=\\s*(?:any\\s*\\()?|in\\s*\\()\\s*\\$\\d+`,
  "i",
);

/**
 * `INSERT INTO agent_users (user_id, …) VALUES ($1, …)`.
 *
 * An insert has no WHERE clause to scope, so naming the owner column in the
 * column list is what makes it scoped — the value has to come from somewhere,
 * and the policy layer has already checked that the caller owns it.
 */
const SCOPED_INSERT = new RegExp(
  `insert\\s+into\\s+[\\w".]+\\s*\\([^)]*\\b(?:${ownerColumnGroup})\\b[^)]*\\)`,
  "i",
);

/** An owner column compared to a literal — parameterisation bypassed. */
const LITERAL_OWNER_SQL = new RegExp(
  `(?:^|[\\s.(,])(?:${ownerColumnGroup})\\s*(?:=|in\\s*\\()\\s*'`,
  "i",
);

/** `{userId: $ownerId}`, `u.userId = $ownerId`. */
/** `discoverable = true`, `c.discoverable IS TRUE`. */
const DISCOVERABLE_PREDICATE = /discoverable\s*(?:=\s*true|is\s+true)\b/i;

const SCOPED_CYPHER = /\$ownerId\b/;

const LITERAL_OWNER_CYPHER = /userId\s*(?::|=)\s*['"]/i;

export function isSqlScoped(sql: string): boolean {
  return SCOPED_SQL.test(sql) || SCOPED_INSERT.test(sql);
}

export function isCypherScoped(cypher: string): boolean {
  return SCOPED_CYPHER.test(cypher);
}

/**
 * Throws unless the statement is owner-scoped or explicitly marked bulk.
 *
 * A literal owner id fails even when the statement *looks* scoped: baking
 * `user_id = 'tg:123'` into a query string is how one user's id ends up in a
 * cached plan and, eventually, in another user's request.
 */
export function assertSqlScoped(sql: string): void {
  if (LITERAL_OWNER_SQL.test(sql)) {
    throw new ForbiddenError(
      "owner column compared to a literal; bind it as a parameter",
      "sql:scope",
    );
  }
  if (sql.includes(SQL_BULK_MARKER)) return;
  if (sql.includes(SQL_DISCOVERABLE_MARKER)) {
    if (!DISCOVERABLE_PREDICATE.test(sql)) {
      throw new ForbiddenError(
        `${SQL_DISCOVERABLE_MARKER} requires a "discoverable = true" predicate`,
        "sql:scope",
      );
    }
    return;
  }
  if (!isSqlScoped(sql)) {
    throw new ForbiddenError(
      `unscoped SQL: no owner predicate, and no ${SQL_BULK_MARKER} or ${SQL_DISCOVERABLE_MARKER} marker`,
      "sql:scope",
    );
  }
}

export function assertCypherScoped(cypher: string): void {
  if (LITERAL_OWNER_CYPHER.test(cypher)) {
    throw new ForbiddenError(
      "userId compared to a literal; bind it as $ownerId",
      "cypher:scope",
    );
  }
  if (cypher.includes(CYPHER_BULK_MARKER)) return;
  if (!isCypherScoped(cypher)) {
    throw new ForbiddenError(
      `unscoped Cypher: no $ownerId binding and no "${CYPHER_BULK_MARKER}" marker`,
      "cypher:scope",
    );
  }
}

/**
 * A bulk query is only legitimate for a system principal. This is the pair to
 * the marker: the marker says the query intends to cross users, and this says
 * the caller is allowed to intend that.
 */
export function assertBulkAllowed(
  principal: Principal,
  statement: string,
): void {
  const isBulk =
    statement.includes(SQL_BULK_MARKER) ||
    statement.includes(CYPHER_BULK_MARKER);
  if (isBulk && principal.kind !== "system") {
    throw new ForbiddenError(
      "bulk query requires a system principal",
      "scope:bulk",
    );
  }
}

export interface SqlExecutor {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface CypherExecutor {
  run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
}

/**
 * Wraps an executor so that an unscoped query cannot physically be run through
 * it. Repositories take the wrapped executor, never the raw pool — which makes
 * "I forgot the WHERE clause" a thrown error in a unit test instead of a data
 * leak in production.
 */
export function scopedSql(
  inner: SqlExecutor,
  principal: Principal,
): SqlExecutor {
  return {
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      assertSqlScoped(sql);
      assertBulkAllowed(principal, sql);
      return inner.query<T>(sql, params);
    },
  };
}

export function scopedCypher(
  inner: CypherExecutor,
  principal: Principal,
): CypherExecutor {
  return {
    async run<T>(
      cypher: string,
      params?: Record<string, unknown>,
    ): Promise<T[]> {
      assertCypherScoped(cypher);
      assertBulkAllowed(principal, cypher);
      if (
        !cypher.includes(CYPHER_BULK_MARKER) &&
        params?.ownerId === undefined
      ) {
        throw new ForbiddenError(
          "scoped Cypher requires an ownerId parameter",
          "cypher:scope",
        );
      }
      return inner.run<T>(cypher, params);
    },
  };
}

/**
 * The owner predicate itself, so repositories do not hand-write it (and cannot
 * hand-write it wrong). Returns the clause and the value to bind.
 */
export function ownerPredicate(
  principal: Principal,
  column = "user_id",
  paramIndex = 1,
): { clause: string; value: string } {
  if (principal.kind !== "user") {
    throw new ForbiddenError(
      `${principal.kind} principal has no owner predicate`,
      "scope:owner",
    );
  }
  return { clause: `${column} = $${paramIndex}`, value: principal.userId };
}
