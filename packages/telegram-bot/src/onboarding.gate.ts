import type { Bot } from "gramio";
import type { OnboardingRecord, OnboardingStore } from "./onboarding.store.ts";
import {
  ageKeyboard,
  ONBOARDING_AGE_OPTIONS,
  ONBOARDING_AGE_QUESTION,
  onboardingCityQuestion,
  onboardingComplete,
  ONBOARDING_NAME_QUESTION,
  ONBOARDING_PURPOSE_ALL,
  ONBOARDING_PURPOSE_COMMUNITIES,
  ONBOARDING_PURPOSE_MEET,
  ONBOARDING_PURPOSE_PLACES,
  ONBOARDING_PURPOSE_QUESTION,
  purposeKeyboard,
} from "./messages.ts";

type AddMemoryFn = (
  userId: number,
  message: string,
  response: string,
) => Promise<void>;

const PURPOSE_LABELS: Record<string, string> = {
  [ONBOARDING_PURPOSE_MEET]: "meet people",
  [ONBOARDING_PURPOSE_PLACES]: "discover places",
  [ONBOARDING_PURPOSE_COMMUNITIES]: "find communities",
  [ONBOARDING_PURPOSE_ALL]:
    "meet people, discover places, and find communities",
};

/** Re-sends the right question for the user's current onboarding step. */
export async function resumeOnboarding(
  context: { send: (text: string, opts?: object) => Promise<unknown> },
  record: OnboardingRecord,
): Promise<void> {
  switch (record.step) {
    case "pending_name":
      await context.send(ONBOARDING_NAME_QUESTION);
      break;
    case "pending_city":
      await context.send(onboardingCityQuestion(record.name ?? "there"));
      break;
    case "pending_age":
      await context.send(ONBOARDING_AGE_QUESTION, {
        reply_markup: ageKeyboard,
      });
      break;
    case "pending_purpose":
      await context.send(ONBOARDING_PURPOSE_QUESTION, {
        reply_markup: purposeKeyboard,
      });
      break;
  }
}

/**
 * Registers onboarding middleware and keyboard callback handlers.
 * Must be wired AFTER the consent gate and BEFORE the message handler.
 *
 * - Messages during onboarding are consumed here; they never reach runAgent.
 * - When step === "complete", calls next() so the message handler takes over.
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

    const record = await store.get(telegramId);

    if (record.step === "complete") return next();

    if (record.step === "pending_name") {
      const name = text.trim() || "friend";
      const updated = { ...record, name, step: "pending_city" as const };
      await store.set(telegramId, updated);
      return context.send(onboardingCityQuestion(name));
    }

    if (record.step === "pending_city") {
      const city = text.trim() || "your city";
      const updated = { ...record, city, step: "pending_age" as const };
      await store.set(telegramId, updated);
      return context.send(ONBOARDING_AGE_QUESTION, {
        reply_markup: ageKeyboard,
      });
    }

    // pending_age / pending_purpose — waiting for keyboard tap; ignore free text
  });

  // --- Age keyboard callbacks ---
  for (const age of ONBOARDING_AGE_OPTIONS) {
    bot.callbackQuery(`onboarding:age:${age}`, async (context) => {
      const telegramId = context.from?.id;
      if (telegramId === undefined) return context.answer();

      const record = await store.get(telegramId);
      if (record.step !== "pending_age") return context.answer();

      const updated = { ...record, age, step: "pending_purpose" as const };
      await store.set(telegramId, updated);
      await context.answer();
      await context.send(ONBOARDING_PURPOSE_QUESTION, {
        reply_markup: purposeKeyboard,
      });
    });
  }

  // --- Purpose keyboard callbacks ---
  const purposeCallbacks = [
    ONBOARDING_PURPOSE_MEET,
    ONBOARDING_PURPOSE_PLACES,
    ONBOARDING_PURPOSE_COMMUNITIES,
    ONBOARDING_PURPOSE_ALL,
  ] as const;

  for (const callbackId of purposeCallbacks) {
    bot.callbackQuery(callbackId, async (context) => {
      const telegramId = context.from?.id;
      if (telegramId === undefined) return context.answer();

      const record = await store.get(telegramId);
      if (record.step !== "pending_purpose") return context.answer();

      const purposeLabel = PURPOSE_LABELS[callbackId] ?? "explore";
      const updated = {
        ...record,
        purpose: purposeLabel,
        step: "complete" as const,
      };
      await store.set(telegramId, updated);

      const name = updated.name ?? "friend";
      const summary = `My name is ${name}, I'm ${updated.age ?? "unknown age"} years old, based in ${updated.city ?? "unknown city"}. I joined CALEBX to: ${purposeLabel}.`;
      await addMemory(telegramId, summary, "Got it — I'll keep that in mind.");

      await context.answer();
      await context.send(onboardingComplete(name, purposeLabel));
    });
  }
}
