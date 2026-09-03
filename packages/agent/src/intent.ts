/**
 * Recognising a plain-language recommendation request.
 *
 * The agent runs the recommendation path itself when someone asks for one — it
 * never replies "type /recommendation" (assumptions.md A10). This matcher is
 * what makes that possible without asking the model to remember to call a tool.
 *
 * Keyword matching rather than a classifier call: it costs nothing, it is
 * deterministic, and a false negative just means the conversation continues
 * normally, which is a perfectly good turn.
 */

const ASKS = [
  "recommend",
  "recommendation",
  "suggest",
  "suggestion",
  "show me",
  "any matches",
  "any options",
  "who should i",
  "anyone i",
  "anyone else",
  "where should i",
  "where can i",
  "know a place",
  "know anywhere",
  "know anyone",
  "find me",
  "got anything",
  "any groups",
  "any people",
  "who else",
];

/** Phrases that look like an ask but are not one. */
const NOT_ASKS = ["do not recommend", "don't recommend", "stop recommending"];

export function looksLikeRecommendationRequest(text: string): boolean {
  const lower = text.toLowerCase();
  if (NOT_ASKS.some((phrase) => lower.includes(phrase))) return false;
  return ASKS.some((phrase) => lower.includes(phrase));
}

/**
 * Parses a leading slash command.
 *
 * Returns null for ordinary text. `/switch community` → `{name: "switch",
 * argument: "community"}`. Telegram's `@botname` suffix is stripped, because in
 * a group chat that is how the command arrives.
 */
export function parseCommand(
  text: string,
): { name: string; argument?: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  const name = (head ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (name === "") return null;

  const argument = rest.join(" ").trim();
  return argument === "" ? { name } : { name, argument };
}
