import dotenv from "dotenv";

// Load standard .env if present.
dotenv.config();

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
