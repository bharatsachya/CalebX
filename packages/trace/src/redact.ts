import type { AttributeValue, SpanAttributes } from "./types.ts";

/**
 * Span attributes are written to disk and read by whoever is debugging. mem0
 * already holds raw conversation text; the trace log must not become a second,
 * unbounded copy of it. So redaction is on by default and opt-out, never
 * opt-in — a new span added in six months is safe without its author thinking
 * about it.
 */

/**
 * Any attribute whose key contains one of these (case-insensitive) is replaced
 * with a fingerprint. Substring matching, not exact keys, is what makes this
 * hold for attributes nobody has written yet (`user_message`, `replyText`,
 * `candidate_name` all match).
 */
const SENSITIVE_KEY_PARTS = [
  "text",
  "message",
  "content",
  "prompt",
  "reply",
  "phone",
  "email",
  "name",
  "address",
  "token",
  "apikey",
  "api_key",
  "secret",
  "password",
  "invite",
  "link",
  "biodata",
  "photo",
];

/**
 * Keys that look sensitive by the rule above but are safe and useful, so they
 * are allowed through verbatim. Kept explicit and short — every entry here is a
 * deliberate exception someone has to justify.
 */
const ALLOWED_KEYS = new Set([
  "name", // the span's own name field is set separately, never as an attribute
  "model.name",
  "tool.name",
  "queue.name",
  "step.name",
  "error.name",
  "text.length",
  "message.count",
]);

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Replaces a value with something you can still reason about: how long it was,
 * and a stable hash so two occurrences of the same string are visibly the same
 * string. `[redacted:42:1a2b3c4d]`.
 */
export function fingerprint(value: string): string {
  return `[redacted:${value.length}:${fnv1a(value)}]`;
}

/**
 * A WhatsApp `wa_id` *is* a phone number, so a namespaced user id is PII on one
 * channel and not the other. Masking both keeps the trace readable (you can
 * still tell two spans apart) without printing anyone's number.
 *
 * `wa:16505551234` → `wa:***234`. Non-namespaced input is fingerprinted instead
 * of being passed through, because an unrecognised id shape is exactly when you
 * do not know what you are logging.
 */
export function maskUserId(userId: string): string {
  const separator = userId.indexOf(":");
  if (separator <= 0) return fingerprint(userId);

  const channel = userId.slice(0, separator);
  const nativeId = userId.slice(separator + 1);
  if (nativeId === "") return fingerprint(userId);

  const tail = nativeId.length <= 3 ? nativeId : nativeId.slice(-3);
  return `${channel}:***${tail}`;
}

export function isSensitiveKey(key: string): boolean {
  if (ALLOWED_KEYS.has(key)) return false;
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part));
}

function redactValue(key: string, value: AttributeValue): AttributeValue {
  if (value === null) return null;
  if (typeof value !== "string") return value;
  if (key === "userId" || key.endsWith(".userId") || key.endsWith("_user_id")) {
    return maskUserId(value);
  }
  return isSensitiveKey(key) ? fingerprint(value) : value;
}

/**
 * Returns a new object; never mutates the caller's attributes. `undefined`
 * values are dropped rather than serialised as null, so an optional attribute
 * that was not set does not show up as a field in the trace file.
 */
export function redactAttributes(
  attributes: SpanAttributes,
  enabled = true,
): SpanAttributes {
  const out: SpanAttributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    out[key] = enabled ? redactValue(key, value) : value;
  }
  return out;
}
