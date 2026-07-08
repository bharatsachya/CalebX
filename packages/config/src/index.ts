import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load the root .env before parsing. ESM evaluates this module (and its
// process.env read) before any consumer's own dotenv.config() runs, so the
// config package must load its own environment to be import-order-safe.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

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

  // Neo4j (user provides their own instance — e.g. Aura free tier)
  NEO4J_URI: z.string().min(1, "NEO4J_URI is required"),
  NEO4J_USERNAME: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().min(1, "NEO4J_PASSWORD is required"),

  // LLM (OpenRouter free tier)
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z.string().default("meta-llama/llama-3.1-8b-instruct:free"),

  // Tuning
  MAX_DAILY_MESSAGES: z.coerce.number().default(20),
  MIN_MATCH_SCORE: z.coerce.number().default(3),
  SUMMARIZE_MIN_TURNS: z.coerce.number().default(4),
});

export type Config = z.infer<typeof ConfigSchema>;

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
