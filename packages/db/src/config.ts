import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env lives at the monorepo root (three levels up from packages/db/src).
// Resolving it explicitly matters: `bun --cwd packages/db` makes the package the
// cwd, so a bare dotenv.config() looks in the wrong directory.
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

export interface DbConfig {
  databaseUrl: string;
}

let cachedConfig: DbConfig | null = null;

export function getDbConfig(): DbConfig {
  if (cachedConfig) return cachedConfig;

  const value = process.env.DATABASE_URL;
  if (!value || value.trim() === "" || value === "YOUR_DATABASE_URL_HERE") {
    throw new Error(
      "[db] Missing required environment variable: DATABASE_URL.\n" +
        "Set DATABASE_URL in your environment or .env file.",
    );
  }

  cachedConfig = { databaseUrl: value.trim() };
  return cachedConfig;
}
