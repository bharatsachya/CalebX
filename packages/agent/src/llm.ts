import OpenAI from "openai";
import { config } from "@calebx/config";
import { LLMError } from "@calebx/errors";

/**
 * OpenRouter-backed OpenAI client. Drop-in for the OpenAI SDK — same interface,
 * different baseURL. Uses a free-tier model by default (config.OPENROUTER_MODEL).
 */
const client = new OpenAI({
  apiKey: config.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/calebx/calebx",
    "X-Title": "CALEBX",
  },
});

async function chat(
  systemPrompt: string,
  userContent: string,
  temperature: number,
): Promise<string> {
  try {
    const response = await client.chat.completions.create({
      model: config.OPENROUTER_MODEL,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });
    return response.choices[0]?.message?.content ?? "";
  } catch (error) {
    throw new LLMError(
      error instanceof Error ? error.message : "LLM request failed",
      error,
    );
  }
}

/** Warm conversational reply (higher temperature for personality). */
export function responseCall(
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  return chat(systemPrompt, userContent, 0.7);
}

/** Structured summarization (low temperature for stable JSON). */
export function summarizeCall(
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  return chat(systemPrompt, userContent, 0.2);
}
