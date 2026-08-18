import { env } from "@calebx/config";

const e = env("db");

export interface DbConfig {
  databaseUrl: string;
}

let cachedConfig: DbConfig | null = null;

export function getDbConfig(): DbConfig {
  if (cachedConfig) return cachedConfig;

  // Throws rather than exiting: this is a library call inside a running process,
  // not a boot-time read in an entry point.
  cachedConfig = { databaseUrl: e.required("DATABASE_URL") };
  return cachedConfig;
}
