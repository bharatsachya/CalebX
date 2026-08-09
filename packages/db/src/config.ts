import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env lives at the monorepo root (two levels up from packages/db/src).
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "" || value === `YOUR_${name}_HERE`) {
    console.error(
      `[db] Missing required environment variable: ${name}.\n` +
        `Copy .env.example to .env and fill it in.`,
    );
    process.exit(1);
  }
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
} as const;

export type DbConfig = typeof config;
