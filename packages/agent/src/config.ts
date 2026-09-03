import { env } from "@calebx/config";

const e = env("agent");

/**
 * Read lazily, never at module load.
 *
 * Importing this package must not require credentials or take a process down:
 * the queue workers, the test suite, and the tooling all import it, and only
 * some of them ever talk to a model. A missing key should fail the call that
 * needed it, with a message naming the variable — not the import.
 */
export const agentConfig = {
  get openrouterApiKey(): string {
    return e.required("OPENROUTER_API_KEY");
  },
  get mem0ApiKey(): string {
    return e.required("MEM0_API_KEY");
  },
  /**
   * Default: a free model on OpenRouter. Override via OPENROUTER_MODEL in .env.
   * Examples: "anthropic/claude-3-haiku", "openai/gpt-4o-mini".
   */
  get openrouterModel(): string {
    return e.optional(
      "OPENROUTER_MODEL",
      "meta-llama/llama-3.1-8b-instruct:free",
    );
  },
} as const;
