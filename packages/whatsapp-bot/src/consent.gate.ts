import { candidates, type Candidate } from "@calebx/db";
import * as copy from "./copy.ts";
import { buttonsPayload, type ChoiceOption } from "./render.ts";
import type { WhatsAppClient } from "./client.ts";

/**
 * The two consent buttons, as a choice table the renderer understands.
 */
const CONSENT_OPTIONS: readonly ChoiceOption[] = [
  { id: copy.CONSENT_ACCEPT, label: copy.CONSENT_ACCEPT_LABEL },
  { id: copy.CONSENT_DECLINE, label: copy.CONSENT_DECLINE_LABEL },
];

/** True for the only two interactive ids allowed before consent is granted. */
export function isConsentChoice(id: string): boolean {
  return id === copy.CONSENT_ACCEPT || id === copy.CONSENT_DECLINE;
}

/**
 * Resolves a typed reply to a consent decision, so users who can't or won't
 * tap a button (common for an older, non-technical parent) are not locked out.
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
  const body = nudge
    ? `${nudge}\n\n${copy.PRIVACY_NOTICE}`
    : copy.PRIVACY_NOTICE;
  await client.sendRaw(buttonsPayload(to, body, CONSENT_OPTIONS));
}

export interface ConsentDeps {
  client: WhatsAppClient;
  onGranted: (candidate: Candidate, waId: string) => Promise<void>;
}

/** Applies an accept/decline decision for this candidate. */
export async function handleConsentChoice(
  candidate: Candidate,
  waId: string,
  choiceId: string,
  deps: ConsentDeps,
): Promise<void> {
  const { client, onGranted } = deps;

  if (choiceId === copy.CONSENT_DECLINE) {
    await candidates.setConsent(candidate.id, false);
    await client.sendText(waId, copy.DECLINED_MESSAGE);
    return;
  }

  await candidates.setConsent(candidate.id, true);
  await client.sendText(waId, copy.ACCEPTED_MESSAGE);
  await onGranted(candidate, waId);
}
