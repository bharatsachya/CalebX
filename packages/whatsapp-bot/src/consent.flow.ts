import { copy, type ConsentStore } from "@calebx/channel";
import type { IUserRepository } from "@calebx/core";
import type { WhatsAppClient } from "./client.ts";
import { buttonsPayload } from "./render.ts";
import type { InboundMessage } from "./webhook.types.ts";

const HINTS = copy.WHATSAPP_HINTS;

/**
 * The two consent buttons, as a choice table the renderer understands.
 * Uses the short labels — WhatsApp clips reply-button titles at 20 characters.
 */
const CONSENT_OPTIONS = [
  {
    id: copy.CONSENT_ACCEPT,
    label: copy.CONSENT_ACCEPT_LABEL_SHORT,
    value: "granted",
  },
  {
    id: copy.CONSENT_DECLINE,
    label: copy.CONSENT_DECLINE_LABEL_SHORT,
    value: "declined",
  },
] as const;

/** True for the only two interactive ids allowed before consent is granted. */
export function isConsentChoice(id: string): boolean {
  return id === copy.CONSENT_ACCEPT || id === copy.CONSENT_DECLINE;
}

/**
 * Resolves a typed reply to a consent decision, so users who can't or won't tap
 * a button are not locked out of the flow.
 */
export function matchConsentText(text: string): string | null {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z ]/g, "");
  if (
    ["yes", "y", "agree", "i agree", "ok", "okay", "accept"].includes(
      normalized,
    )
  ) {
    return copy.CONSENT_ACCEPT;
  }
  if (["no", "n", "not now", "decline", "nope"].includes(normalized)) {
    return copy.CONSENT_DECLINE;
  }
  return null;
}

/** Two reply buttons — consent has exactly two options, so it fits. */
export async function sendPrivacyNotice(
  client: WhatsAppClient,
  to: string,
  nudge?: string,
): Promise<void> {
  const notice = copy.privacyNotice(HINTS);
  const body = nudge ? `${nudge}\n\n${notice}` : notice;
  await client.sendRaw(buttonsPayload(to, body, CONSENT_OPTIONS));
}

export interface ConsentDeps {
  client: WhatsAppClient;
  consent: ConsentStore;
  users: IUserRepository;
  onGranted: (message: InboundMessage) => Promise<void>;
}

/** Applies an accept/decline decision and starts onboarding on accept. */
export async function handleConsentChoice(
  message: InboundMessage,
  choiceId: string,
  deps: ConsentDeps,
): Promise<void> {
  const { client, consent, users, onGranted } = deps;

  if (choiceId === copy.CONSENT_DECLINE) {
    await consent.set(message.userId, "declined");
    await client.sendText(message.waId, copy.declinedMessage(HINTS));
    return;
  }

  await consent.set(message.userId, "granted");
  await users.createUser(message.userId);
  await client.sendText(message.waId, copy.ACCEPTED_MESSAGE);
  await onGranted(message);
}
