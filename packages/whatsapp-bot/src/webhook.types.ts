/**
 * Shapes of the WhatsApp Cloud API webhook payload we actually read.
 *
 * Deliberately partial: Meta adds fields freely, and every field here is
 * optional because the payload is untrusted input that has only been proven to
 * come from Meta (by signature), not proven to be well-formed.
 */

export interface WebhookPayload {
  object?: string;
  entry?: WebhookEntry[];
}

export interface WebhookEntry {
  id?: string;
  changes?: WebhookChange[];
}

export interface WebhookChange {
  field?: string;
  value?: WebhookValue;
}

export interface WebhookValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: WebhookContact[];
  /** Present only on inbound user messages. */
  messages?: InboundRaw[];
  /** Delivery/read receipts. Arrive on the same `messages` field; ignored. */
  statuses?: unknown[];
  errors?: unknown[];
}

export interface WebhookContact {
  wa_id?: string;
  profile?: { name?: string };
}

export interface InboundRaw {
  /** The sender's wa_id. Reply to this exact string, never a re-derived one. */
  from?: string;
  /** "wamid.…" — the idempotency key. */
  id?: string;
  /** Unix seconds, as a STRING. */
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  interactive?: {
    type?: string;
    list_reply?: { id?: string; title?: string };
    button_reply?: { id?: string; title?: string };
  };
}

/** What the rest of the bot works with. */
export interface InboundMessage {
  /** Digits only, no leading "+". Use verbatim as the reply address. */
  waId: string;
  /** Channel-namespaced id, e.g. "wa:16505551234". */
  userId: string;
  messageId: string;
  timestampMs: number;
  profileName?: string;
  content: InboundContent;
}

export type InboundContent =
  | { kind: "text"; text: string }
  | { kind: "choice"; id: string; title: string }
  | { kind: "unsupported"; type: string };
