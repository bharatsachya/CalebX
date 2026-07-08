import neo4j, { type Driver, type QueryResult } from "neo4j-driver";
import { config } from "@calebx/config";
import { Neo4jError } from "@calebx/errors";

let driver: Driver | null = null;

/** Lazily-created shared driver. Neo4j drivers are connection pools — one per process. */
export function getDriver(): Driver {
  if (driver === null) {
    driver = neo4j.driver(
      config.NEO4J_URI,
      neo4j.auth.basic(config.NEO4J_USERNAME, config.NEO4J_PASSWORD),
    );
  }
  return driver;
}

/** Runs a Cypher statement in an auto-commit session, mapping failures to Neo4jError. */
export async function run(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<QueryResult> {
  const session = getDriver().session();
  try {
    return await session.run(cypher, params);
  } catch (error) {
    throw new Neo4jError(
      error instanceof Error ? error.message : "Neo4j query failed",
      error,
    );
  } finally {
    await session.close();
  }
}

/** Closes the shared driver. Call at process shutdown or end of a one-off script. */
export async function closeDriver(): Promise<void> {
  if (driver !== null) {
    await driver.close();
    driver = null;
  }
}

/**
 * Neo4j returns 64-bit ints as {low, high} Integer objects (or bigint in newer
 * drivers). Coerce to a JS number for our small telegram-id / timestamp values.
 */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (neo4j.isInt(value)) return value.toNumber();
  return Number(value);
}
