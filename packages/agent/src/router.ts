import type { AgentMode } from "@calebx/core";
import { withSpan } from "@calebx/trace";
import type { ChatModel } from "./chat.ts";
import { modeFromClassification } from "./modes.ts";

/**
 * The master intent router.
 *
 * It runs once per user — on the first substantive message — and its answer
 * decides which product they are talking to. It is a separate, low-temperature
 * call rather than something folded into the reply, because classification and
 * conversation want opposite settings and because a misclassification is
 * expensive enough to be worth its own span in a trace.
 */

export const ROUTER_PROMPT = `Classify what this person came for. Answer with exactly one
word and nothing else:

matchmaker — they are looking for a marriage partner, talking about matrimony,
biodata, families, or being set up with someone to marry.

community_connector — anything else: making friends, finding places, groups,
events, moving to a city, or just chatting.

If it is ambiguous or you cannot tell, answer community_connector.`;

/**
 * Classifies a first message.
 *
 * Never throws: a router failure falls back to the community connector rather
 * than dropping the turn. That side asks less and collects less, so guessing it
 * wrongly costs a mildly odd conversation, while guessing matchmaker wrongly
 * opens with questions about marriage.
 */
export async function classifyMode(
  model: ChatModel,
  message: string,
): Promise<{ mode: AgentMode; confident: boolean }> {
  return withSpan("router.classify", { kind: "llm" }, async (span) => {
    try {
      const completion = await model.complete({
        system: ROUTER_PROMPT,
        messages: [{ role: "user", content: message }],
        tools: [],
        temperature: 0.1,
      });
      const raw = completion.content.trim();
      const mode = modeFromClassification(raw);
      // "Confident" only when the model actually named a mode. An empty or
      // rambling answer lands on the default, and the caller may want to know
      // that it was a default rather than a decision.
      const confident =
        raw !== "" &&
        (raw.toLowerCase().includes("matchmaker") ||
          raw.toLowerCase().includes("matrimonial") ||
          raw.toLowerCase().includes("community"));
      span.setAttributes({ mode, confident });
      return { mode, confident };
    } catch (error) {
      span.recordError(error);
      return { mode: "community_connector", confident: false };
    }
  });
}
