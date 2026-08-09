import { candidates, messages, type Candidate } from "@calebx/db";
import type { WhatsAppClient } from "./client.ts";
import * as copy from "./copy.ts";
import {
  handleConsentChoice,
  isConsentChoice,
  matchConsentText,
  sendPrivacyNotice,
} from "./consent.gate.ts";
import { matchKeyword } from "./keywords.ts";
import type { InboundMessage } from "./webhook.types.ts";

export interface HandlerDeps {
  client: WhatsAppClient;
}

/**
 * Routes one inbound message. Runs inside the per-user serial queue, so it may
 * take as long as it needs — the webhook has already been acknowledged.
 *
 * Nothing past the consent gate runs before consent is granted, with only the
 * two consent buttons exempted. Biodata is far more sensitive than the chat
 * text a normal message carries, so this gate is checked on every turn, not
 * just the first.
 */
export async function handleMessage(
  message: InboundMessage,
  deps: HandlerDeps,
): Promise<void> {
  const { client } = deps;

  // We only ingest text and button/list replies.
  if (message.content.kind === "unsupported") {
    await client.sendText(message.waId, copy.UNSUPPORTED_MESSAGE);
    return;
  }

  // Fire-and-forget: a read receipt round trip must not delay the reply.
  void client.markReadAndTyping(message.messageId).catch(() => undefined);

  const candidate = await candidates.findOrCreateByPhone(message.waId);

  const keyword =
    message.content.kind === "text" ? matchKeyword(message.content.text) : null;

  // FORGET is honoured at any time, consented or not.
  if (keyword === "forget") {
    await candidates.setConsent(candidate.id, false);
    await client.sendText(message.waId, copy.FORGOTTEN_MESSAGE);
    return;
  }

  const consentDeps = {
    client,
    onGranted: async (_candidate: Candidate, waId: string) => {
      // The biodata signup flow lands in a later PR; this placeholder keeps
      // the consent gate independently testable until then.
      await client.sendText(waId, copy.SIGNUP_COMING_SOON);
    },
  };

  // The only interactive input accepted before consent.
  if (
    message.content.kind === "choice" &&
    isConsentChoice(message.content.id)
  ) {
    return handleConsentChoice(
      candidate,
      message.waId,
      message.content.id,
      consentDeps,
    );
  }

  if (!candidate.consent_granted) {
    const typed =
      message.content.kind === "text"
        ? matchConsentText(message.content.text)
        : null;
    if (typed) {
      return handleConsentChoice(candidate, message.waId, typed, consentDeps);
    }

    // Everything else is re-prompted and dropped — never persisted as biodata.
    await sendPrivacyNotice(client, message.waId, copy.NEEDS_CONSENT_NUDGE);
    return;
  }

  // Only messages the candidate sends once consented become part of the raw
  // log the matchmaker reads — the consent exchange itself is tracked as a
  // column on candidates, not logged as a "message".
  await messages.logMessage(
    candidate.id,
    message.messageId,
    "inbound",
    messageBody(message),
  );

  // Consent already granted — the signup flow (a later PR) takes over from
  // here, including handling START. For now, acknowledge so the sender isn't
  // staring at silence.
  await client.sendText(message.waId, copy.SIGNUP_COMING_SOON);
}

function messageBody(message: InboundMessage): string | null {
  if (message.content.kind === "text") return message.content.text;
  if (message.content.kind === "choice") {
    return `[choice] ${message.content.title} (${message.content.id})`;
  }
  return null;
}
