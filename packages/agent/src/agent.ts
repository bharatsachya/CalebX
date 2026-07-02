import { searchMemories, addMemory } from "./memory.ts";
import { extractionCall, responseCall } from "./llm.ts";
import { buildResponsePrompt, EXTRACTION_PROMPT } from "./system-prompt.ts";

interface ExtractionResult {
  intents: string[];
  entities: string[];
  sentiment: "positive" | "negative" | "neutral";
  location_hint: string | null;
}

function parseExtraction(raw: string): ExtractionResult {
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "intents" in parsed &&
      "entities" in parsed &&
      "sentiment" in parsed &&
      "location_hint" in parsed
    ) {
      return parsed as ExtractionResult;
    }
  } catch {
    // Fall through to safe default
  }
  return {
    intents: [],
    entities: [],
    sentiment: "neutral",
    location_hint: null,
  };
}

/**
 * Runs the two-stage agent pipeline for a single user turn.
 *
 * Stage 1 (temp 0.1): extract structured facts from the message.
 * Stage 2 (temp 0.7): generate a warm conversational reply using memories.
 *
 * Memory search happens before Stage 1 so context is available to both.
 * Memory storage happens after Stage 2 so the full turn is recorded.
 */
export async function runAgent(
  userId: number,
  message: string,
): Promise<string> {
  const memories = await searchMemories(userId, message);

  const rawExtraction = await extractionCall(EXTRACTION_PROMPT, message);
  // Parsed and kept for Phase 2 persona ingestion — not yet acted upon.
  const _extraction = parseExtraction(rawExtraction);

  const reply = await responseCall(buildResponsePrompt(memories), message);

  await addMemory(userId, message, reply);

  return reply || "I'm here — what's on your mind?";
}
