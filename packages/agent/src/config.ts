import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env lives at the monorepo root — three levels up from packages/agent/src
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "" || value === `YOUR_${name}_HERE`) {
    console.error(
      `[agent] Missing required environment variable: ${name}.\n` +
        `Add it to the root .env file.`,
    );
    process.exit(1);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

export const agentConfig = {
  openrouterApiKey: required("OPENROUTER_API_KEY"),
  mem0ApiKey: required("MEM0_API_KEY"),
  // Default: a free model on OpenRouter. Override via OPENROUTER_MODEL in .env.
  // Examples: "anthropic/claude-3-haiku", "openai/gpt-4o-mini", "google/gemma-3-27b-it:free"
  openrouterModel: optional(
    "OPENROUTER_MODEL",
    "meta-llama/llama-3.1-8b-instruct:free",
  ),
} as const;
