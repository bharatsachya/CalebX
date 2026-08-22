import type { CardRow } from "./types.ts";

export const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Upscale applied to a card before sending. Small text costs the model dearly. */
export const SCALE = 4;

/**
 * Cards are sent as JPEG, not PNG.
 *
 * A card is mostly photograph, which PNG stores terribly: the same crop is 1138KB
 * of base64 as PNG against 132KB as JPEG — 8.6x, uploaded twice per card. On a
 * free endpoint that dominated the request time (63s per card) and was enough to
 * stall requests outright. Quality 90 is visually lossless at this upscale, and
 * the recogniser sees an image that was already JPEG-compressed by WhatsApp.
 */
export const JPEG_QUALITY = 90;

/**
 * Per-request ceiling.
 *
 * `fetch` has no default timeout, so a stalled upload hangs the whole import
 * with no error and no progress — which is exactly what a 1.1MB payload to a
 * free endpoint produced. A request that has not answered by now is not going to.
 */
export const REQUEST_TIMEOUT_MS = 90_000;

/**
 * Fields requested, in printed order. Sent to the model verbatim, so this list
 * is the contract — a name here that `CardRow` does not know is silently dropped
 * by `pick()` below.
 */
export const REQUESTED: readonly (keyof CardRow)[] = [
  "entry_no",
  "name",
  "dob",
  "birth_time",
  "birth_place",
  "gotra",
  "education",
  "height",
  "weight",
  "occupation",
  "annual_income",
  "work_place",
  "siblings",
  "father_name",
  "mother_name",
  "father_occupation",
  "father_income",
  "address",
  "phone",
  "phone_alt",
  "maternal_gotra",
] as const;

export const PROMPT = [
  "This image is one entry from a printed Hindi (Devanagari) matrimonial",
  "directory. Transcribe the printed text exactly as it appears.",
  "",
  "Rules, in order of importance:",
  "1. Transcribe, never translate. Devanagari stays Devanagari.",
  "2. Never infer, correct, complete or guess. If a character is not clearly",
  "   legible, the whole field is null. A null is correct and useful; an",
  "   invented value is a real person's wrong phone number.",
  "3. Digits especially: return a number only if every digit is legible.",
  "4. A field printed blank or as a dash is null.",
  "",
  `Return only a JSON object with these keys: ${REQUESTED.join(", ")}.`,
  "No markdown, no commentary, no code fence.",
].join("\n");

/**
 * The confirming pass, and why it is deliberately *not* the same request again.
 *
 * The first version ran `PROMPT` twice at temperature 0 — which is to say, it
 * evaluated the same deterministic function on the same bytes twice and called
 * the matching answers agreement. That check could only ever detect
 * non-determinism, never error, while reporting `confidence: 100` as though it
 * had verified something.
 *
 * Two readings mean something only when their errors are uncorrelated, so this
 * pass differs in both inputs to the model: a different rescale (so the vision
 * encoder genuinely sees different pixels) and a narrow digits-only question,
 * which removes the twenty other fields competing for attention. A misread digit
 * survives only if both framings make the same mistake — which remains possible,
 * so `needs_review` stays TRUE on every row regardless.
 */
export const CONFIRM_FIELDS = [
  "entry_no",
  "dob",
  "phone",
  "phone_alt",
  "weight",
  "annual_income",
  "father_income",
] as const;

export const CONFIRM_PROMPT = [
  "This image is one entry from a printed Hindi matrimonial directory.",
  "Read ONLY the numbers printed on it, digit by digit.",
  "",
  "- जन्म दि. is the date of birth, printed dd-mm-yyyy.",
  "- दूरभाष is a phone number: exactly 10 digits. There may be two.",
  "- प्रविष्टी क्रं. is the entry number in the dark badge at the top right.",
  "- वजन is weight, वा. आय and आय are incomes.",
  "",
  "Read each digit individually. Do not complete a number from context or",
  "from what a plausible number would look like. If any single digit of a",
  "value is not clearly legible, return null for that whole value.",
  "",
  `Return only a JSON object with these keys: ${CONFIRM_FIELDS.join(", ")}.`,
  "No markdown, no commentary, no code fence.",
].join("\n");

/** Rescale used by the confirming pass, so it does not see identical pixels. */
export const CONFIRM_SCALE = 6;

export interface VisionOptions {
  apiKey: string;
  model: string;
  /** Read every card twice and keep only numerics both passes agree on. */
  consensus: boolean;
  /** Minimum gap between requests, in ms. Free-tier endpoints are rate-limited. */
  minIntervalMs: number;
}

export const DEFAULT_VISION_MODEL = "google/gemma-4-26b-a4b-it:free";
/** Free OpenRouter endpoints allow roughly 20 requests/minute. */
export const DEFAULT_MIN_INTERVAL_MS = 3_100;

/**
 * Pulls a JSON object out of a model reply.
 *
 * Open models ignore "no code fence" often enough that stripping one is routine
 * rather than defensive; the brace scan then tolerates leading commentary.
 */
export function parseReply(reply: string): Record<string, unknown> | null {
  const withoutFence = reply
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(withoutFence.slice(start, end + 1));
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Keeps only known fields, as trimmed strings. Everything else is discarded. */
export function pick(
  parsed: Record<string, unknown>,
  fields: readonly (keyof CardRow)[] = REQUESTED,
): CardRow {
  const row: CardRow = {};
  for (const field of fields) {
    const value = parsed[field];
    if (typeof value === "string" && value.trim() !== "") {
      row[field] = value.trim();
    } else if (typeof value === "number") {
      row[field] = String(value);
    }
  }
  return row;
}
