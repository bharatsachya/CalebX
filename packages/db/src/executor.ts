import type { QueryResultRow } from "pg";
import { query as poolQuery } from "./db.ts";

/**
 * The narrow slice of a database that a repository needs.
 *
 * Repositories take this rather than reaching for the module-level pool, for two
 * reasons: `@calebx/authz`'s `scopedSql` wraps it to make unscoped queries
 * unrunnable, and a test can supply a fake that records the SQL — which is how
 * "did this query carry its owner predicate?" becomes a unit test instead of a
 * code-review habit.
 */
export interface SqlExecutor {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** The real one, backed by the shared pool. */
export const poolExecutor: SqlExecutor = {
  query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return poolQuery<T & QueryResultRow>(sql, params) as Promise<T[]>;
  },
};

/**
 * Records every statement and returns queued rows. Exported from the package on
 * purpose so other packages' tests can drive a repository without a database.
 */
export class FakeSqlExecutor implements SqlExecutor {
  readonly calls: { sql: string; params: unknown[] }[] = [];
  private readonly queued: unknown[][] = [];

  /** Rows returned by the next call, in order. Missing entries return []. */
  enqueue(rows: unknown[]): this {
    this.queued.push(rows);
    return this;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params });
    return (this.queued.shift() ?? []) as T[];
  }

  /** The most recent statement, with whitespace collapsed for easy matching. */
  lastSql(): string {
    return (this.calls.at(-1)?.sql ?? "").replace(/\s+/g, " ").trim();
  }
}
