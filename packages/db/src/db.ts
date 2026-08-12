import { Pool, type QueryResultRow } from "pg";
import { getDbConfig } from "./config.ts";

/**
 * One pool for the whole process. Postgres is the only datastore this
 * product uses — no per-repository connections, no second database.
 */
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const config = getDbConfig();
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
