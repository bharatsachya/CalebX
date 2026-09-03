import { z } from "zod";
import "./env.ts";

export const ConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // Telegram
  TELEGRAM_BOT_TOKEN: z
    .string({
      required_error: "TELEGRAM_BOT_TOKEN environment variable is required",
    })
    .min(20, "TELEGRAM_BOT_TOKEN must be at least 20 characters long"),

  // Redis / BullMQ. Every queue and the mode cache share this instance.
  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  // Dispatch tuning. The jitter floor is not configurable — see
  // packages/queue/src/limiter.ts for why perfectly uniform sends are a problem.
  DISPATCH_JITTER_MAX_MS: z.coerce.number().default(15),
  MAX_SESSION_TURNS: z.coerce.number().default(20),
});

/**
 * Removed on 2026-09-03 with the agent-engine build: `HELIX_URL`,
 * `OLLAMA_URL`, `OLLAMA_CHAT_MODEL`, `OLLAMA_EMBED_MODEL`,
 * `PERSONA_CHUNK_THRESHOLD`. None was read by any file — HelixDB was never run
 * and inference went to OpenRouter instead. Anything a package needs now is
 * declared by that package through `env("<scope>")`, so a variable cannot be
 * required by a process that has no use for it.
 */

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | null = null;

/**
 * Validate the full environment and fail fast at boot.
 *
 * This is deliberately a function, not a module-load side effect: this schema
 * requires TELEGRAM_BOT_TOKEN, and a module-load `process.exit(1)` would kill any
 * process that merely imports something from `@calebx/config` — the WhatsApp bot,
 * the sheets CLI, the importer. Only entry points that actually want the whole
 * schema call this.
 */
export function loadConfig(): Config {
  if (cached) return cached;

  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment configuration:");
    for (const issue of result.error.errors) {
      console.error(`   - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  cached = result.data;
  return cached;
}
