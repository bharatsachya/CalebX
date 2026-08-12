import {
  advance,
  copy,
  matchChoice,
  optionsForStep,
  promptForStep,
  type Input,
  type OnboardingRecord,
  type OnboardingStore,
} from "@calebx/channel";
import type { WhatsAppClient } from "./client.ts";
import type { InboundContent, InboundMessage } from "./webhook.types.ts";

type AddMemoryFn = (
  userId: string,
  message: string,
  response: string,
) => Promise<void>;

export interface OnboardingDeps {
  client: WhatsAppClient;
  onboarding: OnboardingStore;
  addMemory: AddMemoryFn;
}

/** Sends the question for whatever step the user is currently on. */
export async function sendCurrentQuestion(
  client: WhatsAppClient,
  to: string,
  record: OnboardingRecord,
  nudge?: string,
): Promise<void> {
  const prompt = promptForStep(record);
  if (prompt) await client.sendPrompt(to, prompt, nudge);
}

/**
 * Maps an inbound WhatsApp message onto an FSM input.
 *
 * The important part is the typed fallback: at a multiple-choice step, free
 * text is run through `matchChoice` so "2", "25-34" and "25–34" all count as
 * picking that option. Telegram deliberately does not do this — its inline
 * keyboard always yields a real id, and accepting typed answers there would
 * change long-standing behaviour.
 */
export function toFsmInput(
  content: InboundContent,
  record: OnboardingRecord,
): Input | null {
  if (content.kind === "choice") return { kind: "choice", id: content.id };
  if (content.kind !== "text") return null;

  const options = optionsForStep(record);
  if (!options) return { kind: "text", value: content.text };

  const matched = matchChoice(content.text, options);
  return matched ? { kind: "choice", id: matched.id } : null;
}

export type OnboardingOutcome = "handled" | "pass_through";

/**
 * Advances onboarding by one step. Returns "pass_through" when onboarding is
 * already complete and the message belongs to the conversation handler.
 */
export async function runOnboardingStep(
  message: InboundMessage,
  record: OnboardingRecord,
  deps: OnboardingDeps,
): Promise<OnboardingOutcome> {
  const { client, onboarding, addMemory } = deps;

  if (record.step === "complete") return "pass_through";

  const input = toFsmInput(message.content, record);

  // Unmatched free text at a choice step: re-ask with a nudge. Telegram
  // swallows this silently because a keyboard is still on screen; on WhatsApp
  // silence would look like the bot had died.
  if (!input) {
    await sendCurrentQuestion(
      client,
      message.waId,
      record,
      copy.CHOICE_NOT_UNDERSTOOD,
    );
    return "handled";
  }

  const result = advance(record, input);

  if (result.outcome === "pass_through") return "pass_through";
  if (result.outcome === "ignored") {
    await sendCurrentQuestion(
      client,
      message.waId,
      record,
      copy.CHOICE_NOT_UNDERSTOOD,
    );
    return "handled";
  }

  await onboarding.set(message.userId, result.record);

  // Best-effort: a memory-store outage must not swallow the user's reply. The
  // step has already been persisted, so they are not stuck either way.
  if (result.memory) {
    await addMemory(
      message.userId,
      result.memory.message,
      result.memory.response,
    ).catch((error: unknown) =>
      console.error("[whatsapp] onboarding memory write failed:", error),
    );
  }

  for (const prompt of result.prompts) {
    await client.sendPrompt(message.waId, prompt);
  }
  return "handled";
}
