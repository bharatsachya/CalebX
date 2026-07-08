import { getConfig } from "@calebx/config";
import { LLMError } from "@calebx/errors";

/**
 * Google AI Studio (Gemini) client over the Generative Language REST API. Pure
 * `fetch`, so it runs on Cloudflare Workers. Model comes from config.GEMINI_MODEL;
 * the API key is sent in the x-goog-api-key header (never in the URL/logs).
 */
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  promptFeedback?: { blockReason?: string };
}

async function chat(
  systemPrompt: string,
  userContent: string,
  temperature: number,
): Promise<string> {
  const config = getConfig();
  const url = `${API_BASE}/${config.GEMINI_MODEL}:generateContent`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        generationConfig: { temperature },
      }),
    });
  } catch (error) {
    throw new LLMError(
      error instanceof Error ? error.message : "LLM request failed",
      error,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new LLMError(
      `Gemini request failed (HTTP ${response.status}): ${detail.slice(0, 300)}`,
    );
  }

  const body = (await response.json()) as GeminiResponse;
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
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
