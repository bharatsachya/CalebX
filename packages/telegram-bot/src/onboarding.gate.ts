import type { Bot } from "gramio";
import {
  AGE_OPTIONS,
  PURPOSE_OPTIONS,
  advance,
  promptForStep,
  telegramUserId,
  type OnboardingRecord,
  type OnboardingStore,
  type Prompt,
} from "@calebx/channel";
import { keyboardForGroup } from "./keyboards.ts";

/** Anything that can send a message back — both message and callback contexts. */
interface Sendable {
  send(text: string, options?: object): Promise<unknown>;
}

type AddMemoryFn = (
  userId: string,
  message: string,
  response: string,
) => Promise<void>;

/**
 * Writes the onboarding memory without letting a failure swallow the user's
 * reply. The step is already persisted by the time this runs, so a memory-store
 * outage costs a memory, not the conversation.
 */
async function writeMemory(
  addMemory: AddMemoryFn,
  userId: string,
  memory: { message: string; response: string },
): Promise<void> {
  try {
    await addMemory(userId, memory.message, memory.response);
  } catch (error) {
    console.error("[telegram] onboarding memory write failed:", error);
  }
}

/** Renders one FSM prompt as a Telegram message, with a keyboard if it's a choice. */
async function sendPrompt(context: Sendable, prompt: Prompt): Promise<void> {
  if (prompt.kind === "text") {
    await context.send(prompt.text);
    return;
  }
  await context.send(prompt.text, {
    reply_markup: keyboardForGroup(prompt.group),
  });
}

/** Re-sends the right question for the user's current onboarding step. */
export async function resumeOnboarding(
  context: Sendable,
  record: OnboardingRecord,
): Promise<void> {
  const prompt = promptForStep(record);
  if (prompt) await sendPrompt(context, prompt);
}

/**
 * Registers onboarding middleware and keyboard callback handlers.
 * Must be wired AFTER the consent gate and BEFORE the message handler.
 *
 * - Messages during onboarding are consumed here; they never reach runAgent.
 * - When step === "complete", calls next() so the message handler takes over.
 *
 * All step logic lives in the shared FSM in `@calebx/channel`; this file only
 * translates between GramIO and that FSM.
 */
export function registerOnboardingHandlers(
  bot: Bot,
  store: OnboardingStore,
  addMemory: AddMemoryFn,
): void {
  // --- Message middleware ---
  bot.use(async (context, next) => {
    if (!context.is("message")) return next();
    const text = typeof context.text === "string" ? context.text : "";
    if (text.startsWith("/")) return next();

    const telegramId = context.from?.id;
    if (telegramId === undefined) return next();

    const userId = telegramUserId(telegramId);
    const record = await store.get(userId);
    const result = advance(record, { kind: "text", value: text });

    // Onboarding finished → the conversation handler owns this message.
    if (result.outcome === "pass_through") return next();

    // Free text at a keyboard-only step. Consumed silently, without a reply and
    // without reaching the agent — long-standing behaviour, preserved.
    if (result.outcome === "ignored") return;

    await store.set(userId, result.record);
    if (result.memory) await writeMemory(addMemory, userId, result.memory);
    for (const prompt of result.prompts) await sendPrompt(context, prompt);
  });

  // --- Keyboard callbacks, one per shared option ---
  for (const option of [...AGE_OPTIONS, ...PURPOSE_OPTIONS]) {
    bot.callbackQuery(option.id, async (context) => {
      const telegramId = context.from?.id;
      if (telegramId === undefined) return context.answer();

      const userId = telegramUserId(telegramId);
      const record = await store.get(userId);
      const result = advance(record, { kind: "choice", id: option.id });

      // A tap that doesn't apply here — a stale keyboard from an earlier step,
      // or one tapped after onboarding completed. Acknowledge it so the client
      // stops spinning, and change nothing.
      if (result.outcome !== "advanced") return context.answer();

      await store.set(userId, result.record);
      if (result.memory) {
        await addMemory(userId, result.memory.message, result.memory.response);
      }
      await context.answer();
      for (const prompt of result.prompts) await sendPrompt(context, prompt);
    });
  }
}
