import { z } from "zod";

/**
 * Environment schema. Validated against the Cloudflare Worker `env` binding at the
 * first request (Workers deliver secrets per-request, not via a file), or against
 * `process.env` for local Bun scripts (Bun auto-loads `.env`). There is no dotenv
 * here and no `process.exit` — `loadConfig` throws a clear error instead, which the
 * Worker turns into a 500 and a script turns into a non-zero exit.
 */
export const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // Telegram
  TELEGRAM_BOT_TOKEN: z
    .string({ required_error: "TELEGRAM_BOT_TOKEN is required" })
    .min(20, "TELEGRAM_BOT_TOKEN must be at least 20 characters long"),
  // Shared secret Telegram echoes back in the X-Telegram-Bot-Api-Secret-Token
  // header on every webhook call; the webhook handler rejects mismatches.
  TELEGRAM_WEBHOOK_SECRET: z
    .string({ required_error: "TELEGRAM_WEBHOOK_SECRET is required" })
    .min(1, "TELEGRAM_WEBHOOK_SECRET is required"),

  // Neo4j Aura — HTTP Query API (Bolt/TCP is unavailable on Workers).
  // e.g. https://<dbid>.databases.neo4j.io/db/neo4j/query/v2
  NEO4J_HTTP_URL: z
    .string()
    .url(
      "NEO4J_HTTP_URL must be the Query API URL, e.g. https://<host>/db/neo4j/query/v2",
    ),
  NEO4J_USERNAME: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().min(1, "NEO4J_PASSWORD is required"),

  // LLM — Google AI Studio (Gemini API).
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),

  // Tuning
  MAX_DAILY_MESSAGES: z.coerce.number().default(20),
  MIN_MATCH_SCORE: z.coerce.number().default(3),
  SUMMARIZE_MIN_TURNS: z.coerce.number().default(4),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | null = null;

/**
 * Validates and caches config from a source of env values (the Worker `env`
 * binding or `process.env`). Idempotent: the first successful call wins for the
 * lifetime of the isolate/process; later calls return the cached value. Unknown
 * keys on the source (e.g. the KV binding object) are ignored by the schema.
 *
 * @throws Error with a human-readable list of the invalid/missing keys.
 */
export function loadConfig(env: Record<string, unknown>): Config {
  if (cached) return cached;
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    const lines = result.error.errors.map(
      (e) => `   - ${e.path.join(".")}: ${e.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  cached = result.data;
  return cached;
}

/**
 * Returns the config loaded by `loadConfig`. Downstream packages (db, agent) call
 * this from inside request handlers, after the Worker entry has called loadConfig(env).
 *
 * @throws Error if `loadConfig` has not run yet.
 */
export function getConfig(): Config {
  if (!cached) {
    throw new Error(
      "Config not loaded. Call loadConfig(env) at the Worker entry before getConfig().",
    );
  }
  return cached;
}
