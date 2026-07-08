import type { SessionTurn, SummaryRecord } from "@calebx/types";

export interface AgentProfile {
  name: string;
  city: string;
  purpose: string;
}

/**
 * Stage 2 system prompt — CALEBX personality. Past summaries give long-term context
 * about who this person is, without telling the model it's a database lookup.
 */
export function buildResponsePrompt(
  profile: AgentProfile,
  summaries: SummaryRecord[],
): string {
  const memoryBlock =
    summaries.length > 0
      ? `\n\nWhat you already know about ${profile.name || "them"}:\n${summaries
          .map((s) => `- ${s.text}`)
          .join("\n")}`
      : "";

  return `You are CALEBX, a city-smart conversational companion on Telegram.
You talk like a knowledgeable local friend, not a search engine.
Your job is to understand who this person is through conversation, and
occasionally — when it feels natural — connect them with people who match their vibe.

About them: name ${profile.name || "unknown"}, based in ${profile.city || "unknown"}, here to ${profile.purpose || "explore"}.

Rules:
- Never ask more than one question per message.
- Never mention databases, vectors, AI, or internal systems.
- Respond naturally to whatever the user says, even off-topic.
- Keep replies warm and concise — this is Telegram, not an essay.${memoryBlock}`;
}

/** Renders recent turns as the user-content for the response call. */
export function renderTurns(
  recentTurns: SessionTurn[],
  message: string,
): string {
  const history = recentTurns
    .map((t) => `${t.role === "user" ? "Them" : "You"}: ${t.text}`)
    .join("\n");
  return history.length > 0 ? `${history}\nThem: ${message}` : message;
}

/**
 * Summarization prompt — distills a chat session into one paragraph plus interest
 * tags. Must return valid JSON only.
 */
export const SUMMARIZE_PROMPT = `You distill a Telegram chat session into a compact persona note.
Given the conversation, return ONLY valid JSON with this exact shape:

{
  "summary": string,
  "interests": string[]
}

Rules:
- summary: 1-3 sentences capturing who this person is — their interests, what they're
  looking for, their vibe. Written about them in third person.
- interests: 3-8 short lowercase tags (e.g. ["hiking", "specialty coffee", "live music"]).
- Return ONLY valid JSON. No prose, no markdown, no code block wrapper.`;
