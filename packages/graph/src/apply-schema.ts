/**
 * `bun run --cwd packages/graph schema`
 *
 * Applies constraints and indexes to the configured Neo4j database. Every
 * statement is `IF NOT EXISTS`, so running it twice is a no-op and running it
 * against a live database is safe.
 */
import neo4j from "neo4j-driver";
import { getGraphConfig } from "./config.ts";
import { SCHEMA_STATEMENTS } from "./schema.ts";

const config = getGraphConfig();
const driver = neo4j.driver(
  config.uri,
  neo4j.auth.basic(config.user, config.password),
);

try {
  for (const statement of SCHEMA_STATEMENTS) {
    const label = statement.trim().split("\n")[0];
    await driver.executeQuery(statement, {}, { database: config.database });
    process.stdout.write(`[graph] applied ${label}\n`);
  }
  process.stdout.write(`[graph] schema up to date (${config.uri})\n`);
} catch (error) {
  process.stderr.write(`[graph] schema failed: ${String(error)}\n`);
  process.exitCode = 1;
} finally {
  await driver.close();
}
