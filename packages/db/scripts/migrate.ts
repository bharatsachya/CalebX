#!/usr/bin/env bun
/**
 * Idempotent Neo4j schema setup. Run against your instance before first boot:
 *   bun run db:migrate
 */
import { run, closeDriver } from "../src/index.ts";

const STATEMENTS = [
  "CREATE CONSTRAINT user_telegram_id IF NOT EXISTS FOR (u:User) REQUIRE u.telegram_id IS UNIQUE",
  "CREATE CONSTRAINT summary_id IF NOT EXISTS FOR (s:Summary) REQUIRE s.id IS UNIQUE",
];

async function main(): Promise<void> {
  for (const statement of STATEMENTS) {
    await run(statement);
    console.log(`✓ ${statement.split(" IF NOT EXISTS")[0]}`);
  }
  console.log("✓ Neo4j schema ready.");
}

try {
  await main();
} catch (error) {
  console.error("✗ Migration failed:", error);
  process.exitCode = 1;
} finally {
  await closeDriver();
}
