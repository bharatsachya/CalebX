import neo4j, { type Driver } from "neo4j-driver";
import { Neo4jError } from "@calebx/errors";
import type { CypherExecutor } from "@calebx/authz";
import { getGraphConfig, type GraphConfig } from "./config.ts";

/**
 * Driver lifecycle and the raw executor.
 *
 * Separated from the store so the store is nothing but authorization plus
 * Cypher: connection handling, integer unwrapping and error translation are one
 * concern, and mixing them into a file about traversals is what makes both
 * harder to read.
 *
 * The raw executor is deliberately *not* exported from the package. Everything
 * outside this file gets it already wrapped by `scopedCypher`, which refuses a
 * statement that neither binds `$ownerId` nor declares itself bulk.
 */
export class Neo4jConnection {
  private driver: Driver | null = null;

  constructor(readonly config: GraphConfig = getGraphConfig()) {}

  private getDriver(): Driver {
    if (!this.driver) {
      this.driver = neo4j.driver(
        this.config.uri,
        neo4j.auth.basic(this.config.user, this.config.password),
        // Timestamps and counts come back as plain numbers instead of the
        // driver's Integer wrapper; every numeric field in this schema is well
        // inside the safe range, and unwrapping at each call site is noise.
        { disableLosslessIntegers: true },
      );
    }
    return this.driver;
  }

  /** Unscoped. Only `Neo4jGraphStore` may hold this, and only wrapped. */
  raw(): CypherExecutor {
    return {
      run: async <T>(cypher: string, params?: Record<string, unknown>) => {
        try {
          const result = await this.getDriver().executeQuery(
            cypher,
            params ?? {},
            {
              database: this.config.database,
            },
          );
          return result.records.map((record) => record.toObject() as T);
        } catch (error) {
          throw new Neo4jError("Cypher execution failed", error);
        }
      },
    };
  }

  async close(): Promise<void> {
    await this.driver?.close();
    this.driver = null;
  }
}
