import OpenAI from "openai";
import { agentConfig } from "./config.ts";

/**
 * OpenRouter-backed OpenAI client.
 * Drop-in for the OpenAI SDK — same interface, different baseURL.
 */
const openRouterClient = new OpenAI({
  apiKey: agentConfig.openrouterApiKey,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/calebx/calebx",
    "X-Title": "CALEBX",
  },
});

/**
 * Stage 1 — extraction call. Low temperature for deterministic JSON output.
 */
export async function extractionCall(
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  const response = await openRouterClient.chat.completions.create({
    model: agentConfig.openrouterModel,
    temperature: 0.1,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}

/**
 * Stage 2 — response call. Higher temperature for a warm, natural reply.
 */
export async function responseCall(
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  const response = await openRouterClient.chat.completions.create({
    model: agentConfig.openrouterModel,
    temperature: 0.7,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}
