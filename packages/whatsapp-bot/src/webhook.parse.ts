import { whatsappUserId } from "@calebx/channel";
import type {
  InboundContent,
  InboundMessage,
  InboundRaw,
  WebhookPayload,
} from "./webhook.types.ts";

/**
 * Turns a verified webhook body into the inbound messages we care about.
 *
 * Everything else on the wire is dropped here: delivery and read receipts
 * arrive on the SAME `messages` field, carrying a `statuses` array and no
 * `messages` array, and so do async send errors. Guarding on the *presence of
 * `messages`* handles all of those in one condition — and stays correct when
 * Meta adds another sibling array, which branching on `statuses` would not.
 */
export function parseInbound(payload: unknown): InboundMessage[] {
  const messages: InboundMessage[] = [];
  const body = payload as WebhookPayload | null;
  if (body?.object !== "whatsapp_business_account") return messages;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;

      const value = change.value;
      if (!Array.isArray(value?.messages)) continue;

      const profileNames = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) {
          profileNames.set(contact.wa_id, contact.profile.name);
        }
      }

      for (const raw of value.messages) {
        const parsed = toInboundMessage(raw, profileNames);
        if (parsed) messages.push(parsed);
      }
    }
  }

  return messages;
}

function toInboundMessage(
  raw: InboundRaw,
  profileNames: Map<string, string>,
): InboundMessage | null {
  const waId = raw.from;
  const messageId = raw.id;
  // Without a sender or an id we can neither reply nor dedupe — drop it.
  if (!waId || !messageId) return null;

  const seconds = Number(raw.timestamp);
  const profileName = profileNames.get(waId);

  return {
    waId,
    userId: whatsappUserId(waId),
    messageId,
    // Meta sends unix SECONDS as a string. A missing/garbled value falls back to
    // "now" so a malformed timestamp cannot make a live message look stale.
    timestampMs: Number.isFinite(seconds) ? seconds * 1000 : Date.now(),
    ...(profileName === undefined ? {} : { profileName }),
    content: toContent(raw),
  };
}

function toContent(raw: InboundRaw): InboundContent {
  if (raw.type === "text" && typeof raw.text?.body === "string") {
    return { kind: "text", text: raw.text.body };
  }

  if (raw.type === "interactive" && raw.interactive) {
    const reply = raw.interactive.list_reply ?? raw.interactive.button_reply;
    if (reply?.id) {
      return { kind: "choice", id: reply.id, title: reply.title ?? "" };
    }
  }

  // Media, audio, stickers, location, reactions, orders, system events. We only
  // ingest text — the privacy notice promises we learn from chats, and an
  // unparsed media caption is not covered by that.
  return { kind: "unsupported", type: raw.type ?? "unknown" };
}
