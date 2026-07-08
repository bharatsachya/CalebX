import type { SessionTurn, SummaryRecord } from "@calebx/types";
import { responseCall, summarizeCall } from "./llm.ts";
import {
  buildResponsePrompt,
  renderTurns,
  SUMMARIZE_PROMPT,
  type AgentProfile,
} from "./system-prompt.ts";

/**
 * Single-call conversational turn. Feeds the model the user's profile, past session
 * summaries (long-term memory), and the recent in-session turns (short-term memory).
 * One LLM call per message — extraction and mem0 removed to keep cost near zero.
 */
export async function runAgent(
  profile: AgentProfile,
  summaries: SummaryRecord[],
  recentTurns: SessionTurn[],
  message: string,
): Promise<string> {
  const reply = await responseCall(
    buildResponsePrompt(profile, summaries),
    renderTurns(recentTurns, message),
  );
  return reply || "I'm here — what's on your mind?";
}

export interface SessionSummary {
  summary: string;
  interests: string[];
}

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
}

function parseSummary(raw: string): SessionSummary | null {
  try {
    const parsed = JSON.parse(stripFences(raw)) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "summary" in parsed &&
      typeof (parsed as { summary: unknown }).summary === "string"
    ) {
      const obj = parsed as { summary: string; interests?: unknown };
      const interests = Array.isArray(obj.interests)
        ? obj.interests.filter((i): i is string => typeof i === "string")
        : [];
      return { summary: obj.summary, interests };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Distills a chat session into a persona summary + interest tags. One LLM call with a
 * single retry on malformed JSON. Returns null if both attempts fail (caller skips storage).
 */
export async function summarizeSession(
  turns: SessionTurn[],
): Promise<SessionSummary | null> {
  const transcript = turns
    .map((t) => `${t.role === "user" ? "Them" : "CALEBX"}: ${t.text}`)
    .join("\n");

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await summarizeCall(SUMMARIZE_PROMPT, transcript);
    const parsed = parseSummary(raw);
    if (parsed !== null) return parsed;
  }
  return null;
}
