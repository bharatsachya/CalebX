import { getConfig } from "@calebx/config";
import { Neo4jError } from "@calebx/errors";

/**
 * Neo4j transport over the Aura **HTTP Query API** (POST /db/neo4j/query/v2).
 * Cloudflare Workers cannot open raw TCP, so the Bolt driver is unavailable — the
 * Query API is the officially-supported HTTPS alternative and works from any
 * `fetch` runtime (Workers, Bun, Node). Cypher is unchanged; only the transport moved.
 */

/** One result row, keyed by RETURN alias — mirrors the Bolt driver's Record.get(). */
export interface Neo4jRow {
  get(field: string): unknown;
}

export interface RunResult {
  records: Neo4jRow[];
}

interface QueryApiResponse {
  data?: { fields: string[]; values: unknown[][] };
  errors?: { code?: string; error?: string; message?: string }[];
}

/** Runs a Cypher statement via the Query API, mapping failures to Neo4jError. */
export async function run(
  cypher: string,
  params: Record<string, unknown> = {},
): Promise<RunResult> {
  const config = getConfig();
  const auth = btoa(`${config.NEO4J_USERNAME}:${config.NEO4J_PASSWORD}`);

  let response: Response;
  try {
    response = await fetch(config.NEO4J_HTTP_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ statement: cypher, parameters: params }),
    });
  } catch (error) {
    throw new Neo4jError(
      error instanceof Error ? error.message : "Neo4j request failed",
      error,
    );
  }

  let body: QueryApiResponse;
  try {
    body = (await response.json()) as QueryApiResponse;
  } catch {
    throw new Neo4jError(
      `Neo4j returned a non-JSON response (HTTP ${response.status})`,
    );
  }

  if (!response.ok || (body.errors && body.errors.length > 0)) {
    const first = body.errors?.[0];
    const message =
      first?.message ??
      first?.error ??
      `Neo4j query failed (HTTP ${response.status})`;
    throw new Neo4jError(message, body.errors);
  }

  const fields = body.data?.fields ?? [];
  const values = body.data?.values ?? [];
  const indexOf = new Map(fields.map((field, i) => [field, i]));

  const records: Neo4jRow[] = values.map((row) => ({
    get(field: string): unknown {
      const i = indexOf.get(field);
      return i === undefined ? undefined : row[i];
    },
  }));

  return { records };
}

/**
 * No-op retained so one-off scripts (migrate) keep the same shutdown call. The HTTP
 * transport is stateless — there is no connection pool to drain.
 */
export async function closeDriver(): Promise<void> {}

/**
 * The Query API returns integers as plain JSON numbers (or strings for values beyond
 * JS's safe range) — no more Bolt {low, high} Integer objects. Coerce to a number.
 */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return Number(value);
}
