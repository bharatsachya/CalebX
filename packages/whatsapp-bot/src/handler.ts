import {
  CHANNEL_LABELS,
  copy,
  type ConsentStore,
  type OnboardingStore,
} from "@calebx/channel";
import type { IUserRepository } from "@calebx/core";
import type { WhatsAppClient } from "./client.ts";
import {
  handleConsentChoice,
  isConsentChoice,
  matchConsentText,
  sendPrivacyNotice,
} from "./consent.flow.ts";
import { matchKeyword } from "./keywords.ts";
import { runOnboardingStep, sendCurrentQuestion } from "./onboarding.flow.ts";
import type { InboundMessage } from "./webhook.types.ts";

const HINTS = copy.WHATSAPP_HINTS;

type RunAgentFn = (
  userId: string,
  message: string,
  channel?: string,
) => Promise<string>;

type AddMemoryFn = (
  userId: string,
  message: string,
  response: string,
) => Promise<void>;

export interface HandlerDeps {
  client: WhatsAppClient;
  consent: ConsentStore;
  onboarding: OnboardingStore;
  users: IUserRepository;
  runAgent: RunAgentFn;
  addMemory: AddMemoryFn;
}

/**
 * Routes one inbound message. Runs inside the per-user serial queue, so it may
 * take as long as it needs — the webhook has already been acknowledged.
 *
 * Order is the point of this function: nothing reaches the agent, and nothing
 * is written to memory, before consent has been granted.
 *
 * Note this gate is stricter than Telegram's, deliberately. There, non-message
 * updates skip the consent check entirely, so a stale keyboard can drive
 * onboarding without consent. Here interactive replies go through the same
 * check as text, with only the two consent buttons exempted.
 */
export async function handleMessage(
  message: InboundMessage,
  deps: HandlerDeps,
): Promise<void> {
  const { client, consent, onboarding, runAgent } = deps;

  // We only ingest text. Media never reaches the agent or memory.
  if (message.content.kind === "unsupported") {
    await client.sendText(message.waId, copy.UNSUPPORTED_MESSAGE);
    return;
  }

  // Fire-and-forget: a read receipt round trip must not delay the reply.
  void client.markReadAndTyping(message.messageId).catch(() => undefined);

  const keyword =
    message.content.kind === "text" ? matchKeyword(message.content.text) : null;

  // FORGET is honoured at any time, consented or not.
  if (keyword === "forget") {
    await consent.delete(message.userId);
    await onboarding.delete(message.userId);
    await client.sendText(message.waId, copy.forgottenMessage(HINTS));
    return;
  }

  const consentDeps = {
    client,
    consent,
    users: deps.users,
    onGranted: async (granted: InboundMessage) => {
      const fresh = { step: "pending_name" as const };
      await onboarding.set(granted.userId, fresh);
      await sendCurrentQuestion(client, granted.waId, fresh);
    },
  };

  // The only interactive input accepted before consent.
  if (
    message.content.kind === "choice" &&
    isConsentChoice(message.content.id)
  ) {
    return handleConsentChoice(message, message.content.id, consentDeps);
  }

  if ((await consent.get(message.userId)) !== "granted") {
    const typed =
      message.content.kind === "text"
        ? matchConsentText(message.content.text)
        : null;
    if (typed) return handleConsentChoice(message, typed, consentDeps);

    // Everything else is re-prompted and dropped — never ingested.
    await sendPrivacyNotice(client, message.waId, copy.NEEDS_CONSENT_NUDGE);
    return;
  }

  const record = await onboarding.get(message.userId);

  // START equivalent: resume where they left off, or welcome them back.
  if (keyword === "start") {
    if (record.step === "complete") {
      await client.sendText(message.waId, copy.WELCOME_BACK);
    } else {
      await sendCurrentQuestion(client, message.waId, record);
    }
    return;
  }

  const outcome = await runOnboardingStep(message, record, {
    client,
    onboarding,
    addMemory: deps.addMemory,
  });
  if (outcome === "handled") return;

  // Onboarding complete — this is a real conversation turn.
  if (message.content.kind !== "text" || message.content.text.trim() === "") {
    return;
  }
  // A failed turn must still produce a visible reply — silence reads as a dead
  // bot, and the user has no way to tell whether their message even arrived.
  let reply: string;
  try {
    reply = await runAgent(
      message.userId,
      message.content.text,
      CHANNEL_LABELS.wa,
    );
  } catch (error) {
    console.error("[whatsapp] agent turn failed:", error);
    reply = copy.AGENT_UNAVAILABLE;
  }
  await client.sendText(message.waId, reply);
}
