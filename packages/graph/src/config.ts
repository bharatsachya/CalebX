import { env } from "@calebx/config";

const e = env("graph");

export interface GraphConfig {
  uri: string;
  user: string;
  password: string;
  database: string;
}

let cached: GraphConfig | null = null;

/**
 * Throws rather than exiting: this is read inside a running worker, not at boot
 * in an entry point, and a worker should fail its job rather than take the
 * process down.
 */
export function getGraphConfig(): GraphConfig {
  if (cached) return cached;
  cached = {
    uri: e.required("NEO4J_URI"),
    user: e.optional("NEO4J_USER", "neo4j"),
    password: e.required("NEO4J_PASSWORD"),
    database: e.optional("NEO4J_DATABASE", "neo4j"),
  };
  return cached;
}
