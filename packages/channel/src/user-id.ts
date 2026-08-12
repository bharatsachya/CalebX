/**
 * Namespaced user identity, shared across every chat channel.
 *
 * Telegram gives us numeric ids; WhatsApp gives us phone numbers. Both are
 * digit strings, so without a namespace a WhatsApp number could collide with a
 * Telegram id — and mem0 keys memories by a single flat `user_id` string, so a
 * collision would merge two strangers' personas.
 *
 * Everything downstream (ledgers, mem0) therefore uses `"<channel>:<native id>"`.
 */

/** Channels CALEBX can be reached on. */
export type Channel = "tg" | "wa";

/** A namespaced id, e.g. `"tg:1101953596"` or `"wa:16505551234"`. */
export type UserId = string;

/** Human-readable channel names, used in the agent system prompt. */
export const CHANNEL_LABELS: Record<Channel, string> = {
  tg: "Telegram",
  wa: "WhatsApp",
};

/** Builds a namespaced id from a Telegram numeric user id. */
export function telegramUserId(telegramId: number | string): UserId {
  return `tg:${telegramId}`;
}

/**
 * Builds a namespaced id from a WhatsApp `wa_id`.
 *
 * Pass the `wa_id` exactly as it appeared in the webhook payload — for some
 * countries (notably +52 Mexico and +54 Argentina) it differs from the number
 * the user dialled from, and normalising it would break replies.
 */
export function whatsappUserId(waId: string): UserId {
  return `wa:${waId}`;
}

/** Matches a pre-namespace ledger key. Those could only ever be Telegram ids. */
export const LEGACY_NUMERIC = /^\d+$/;

/**
 * Splits a namespaced id back into its parts. Returns null for anything that
 * is not a recognised `<channel>:<id>` pair, including legacy bare numerics —
 * callers should treat that as "not addressable", not "assume Telegram".
 */
export function parseUserId(
  userId: UserId,
): { channel: Channel; nativeId: string } | null {
  const separator = userId.indexOf(":");
  if (separator <= 0) return null;

  const channel = userId.slice(0, separator);
  const nativeId = userId.slice(separator + 1);
  if (nativeId === "") return null;
  if (channel !== "tg" && channel !== "wa") return null;

  return { channel, nativeId };
}

/** Display name for the channel an id belongs to; falls back to a neutral word. */
export function channelLabel(userId: UserId): string {
  const parsed = parseUserId(userId);
  return parsed ? CHANNEL_LABELS[parsed.channel] : "chat";
}
