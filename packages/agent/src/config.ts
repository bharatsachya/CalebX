import { env } from "@calebx/config";

const e = env("agent");

export const agentConfig = {
  openrouterApiKey: e.requiredOrExit("OPENROUTER_API_KEY"),
  mem0ApiKey: e.requiredOrExit("MEM0_API_KEY"),
  // Default: a free model on OpenRouter. Override via OPENROUTER_MODEL in .env.
  // Examples: "anthropic/claude-3-haiku", "openai/gpt-4o-mini", "google/gemma-3-27b-it:free"
  openrouterModel: e.optional(
    "OPENROUTER_MODEL",
    "meta-llama/llama-3.1-8b-instruct:free",
  ),
} as const;
