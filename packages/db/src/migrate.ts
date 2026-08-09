import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "./db.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "migrations");

/**
 * Deliberately not an ORM migration framework — one Postgres database, plain
 * numbered .sql files, applied once each in filename order. Anything fancier
 * is unjustified complexity for a handful of tables.
 */
async function migrate(): Promise<void> {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const applied = new Set(
    (
      await pool.query<{ name: string }>("SELECT name FROM schema_migrations")
    ).rows.map((row) => row.name),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] skip  ${file} (already applied)`);
      continue;
    }

    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
        file,
      ]);
      await client.query("COMMIT");
      console.log(`[migrate] apply ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`[migrate] FAILED ${file}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  console.log("[migrate] up to date");
}

await migrate()
  .catch((error: unknown) => {
    console.error("[migrate] aborted:", error);
    process.exitCode = 1;
  })
  .finally(closePool);
