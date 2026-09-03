/**
 * Post-processing a model reply before the user sees it.
 *
 * These rules are in the persona prompts too, but a prompt is a request and this
 * is a guarantee. The one that matters most is the single-question rule: a bot
 * that asks three things at once reads as a form, which is precisely what CALEBX
 * exists not to be.
 */

/** Splits on sentence enders, keeping the ender with its sentence. */
function splitSentences(text: string): string[] {
  return text.match(/[^.!?\n]+[.!?]*\n*|\n+/g) ?? [text];
}

/**
 * Keeps at most one question, dropping later ones.
 *
 * Statements are preserved in place — trimming everything after the first
 * question mark would throw away the useful half of "There's a place in
 * Indiranagar you'd like. Want the name? It's near the metro." What is dropped
 * is only the *additional* interrogative sentences.
 */
export function enforceOneQuestion(text: string): string {
  const sentences = splitSentences(text);
  let seenQuestion = false;
  const kept: string[] = [];

  for (const sentence of sentences) {
    const isQuestion = sentence.includes("?");
    if (isQuestion && seenQuestion) continue;
    if (isQuestion) seenQuestion = true;
    kept.push(sentence);
  }

  const out = kept.join("").trim();
  // If dropping questions emptied the message, keep the first sentence rather
  // than sending nothing — silence reads as a dead bot.
  return out === "" ? (sentences[0] ?? text).trim() : out;
}

/**
 * Words that mean the model is narrating its own machinery. Its instructions
 * forbid this; when it happens anyway the sentence has to go, because "let me
 * query the database" destroys the illusion the whole product rests on.
 */
const INTERNALS = [
  "vector",
  "embedding",
  "database",
  "neo4j",
  "postgres",
  "mem0",
  "tool call",
  "function call",
  "my tools",
  "api",
  "prompt",
  "llm",
  "openrouter",
];

export function stripInternalsTalk(text: string): string {
  const sentences = splitSentences(text);
  const kept = sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return !INTERNALS.some((word) => lower.includes(word));
  });
  const out = kept.join("").trim();
  return out === "" ? "" : out;
}

/**
 * The full outbound pass.
 *
 * Order matters: internals are stripped first, because a stripped sentence may
 * have been the message's only question, and the question rule should then see
 * what actually remains.
 */
export function finalizeReply(text: string, fallback: string): string {
  const cleaned = stripInternalsTalk(text.trim());
  if (cleaned === "") return fallback;
  const single = enforceOneQuestion(cleaned);
  return single === "" ? fallback : single;
}
