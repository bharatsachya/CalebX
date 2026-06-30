import { z } from "zod";

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

  // HelixDB
  HELIX_URL: z.string().url().default("http://localhost:6969"),

  // Redis / BullMQ
  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  // Ollama
  OLLAMA_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_CHAT_MODEL: z.string().default("llama3"),
  OLLAMA_EMBED_MODEL: z.string().default("nomic-embed-text"),

  // Tuning Parameters
  PERSONA_CHUNK_THRESHOLD: z.coerce.number().default(0.75),
  MAX_SESSION_TURNS: z.coerce.number().default(20),
  DISPATCH_JITTER_MAX_MS: z.coerce.number().default(15),
});

export type Config = z.infer<typeof ConfigSchema>;

// Validate immediately upon module load (fail fast at boot)
let parsedConfig: Config;

try {
  parsedConfig = ConfigSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error("❌ Invalid environment configuration:");
    for (const err of error.errors) {
      console.error(`   - ${err.path.join(".")}: ${err.message}`);
    }
  } else {
    console.error("❌ Configuration parse error:", error);
  }
  process.exit(1);
}

export const config = parsedConfig;
export default config;
