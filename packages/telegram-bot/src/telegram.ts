import { Bot } from "gramio";
import { PostgresUserRepository } from "@calebx/db";
import { runAgent, addMemory } from "@calebx/agent";
import {
  CHANNEL_LABELS,
  FileConsentStore,
  FileOnboardingStore,
  copy,
  telegramUserId,
} from "@calebx/channel";
import { config } from "./config.ts";
import { registerConsentGate } from "./consent.gate.ts";
import {
  registerOnboardingHandlers,
  resumeOnboarding,
} from "./onboarding.gate.ts";
import { consentKeyboard } from "./keyboards.ts";

const HINTS = copy.TELEGRAM_HINTS;

const consent = new FileConsentStore(config.consentStorePath);
const onboarding = new FileOnboardingStore(config.onboardingStorePath);
const userRepo = new PostgresUserRepository();

const bot = new Bot(config.telegramBotToken);

// 1) Consent gate FIRST — before any handler that could ingest data.
registerConsentGate(bot, consent);

// 2) Onboarding handlers — after consent gate, before message handler.
registerOnboardingHandlers(bot, onboarding, addMemory);

// 3) /start — privacy notice, or resume onboarding, or welcome back.
bot.command("start", async (context) => {
  const userId = telegramUserId(context.from.id);
  if ((await consent.get(userId)) === "granted") {
    const record = await onboarding.get(userId);
    if (record.step === "complete") return context.send(copy.WELCOME_BACK);
    return resumeOnboarding(context, record);
  }
  return context.send(copy.privacyNotice(HINTS), {
    reply_markup: consentKeyboard,
  });
});

// 4) Consent — Accept. User record created; onboarding sequence begins.
bot.callbackQuery(copy.CONSENT_ACCEPT, async (context) => {
  const telegramId = context.from?.id;
  if (telegramId === undefined) return context.answer();
  const userId = telegramUserId(telegramId);
  await consent.set(userId, "granted");
  await userRepo.createUser(userId);
  await context.answer("Thanks!");
  await context.editText(copy.ACCEPTED_MESSAGE).catch(() => undefined);
  await onboarding.set(userId, { step: "pending_name" });
  await context.send(copy.ONBOARDING_NAME_QUESTION);
});

// 5) Consent — Decline.
bot.callbackQuery(copy.CONSENT_DECLINE, async (context) => {
  const telegramId = context.from?.id;
  if (telegramId !== undefined) {
    await consent.set(telegramUserId(telegramId), "declined");
  }
  await context.answer();
  await context.editText(copy.declinedMessage(HINTS)).catch(() => undefined);
});

// 6) /forget — revoke consent and erase onboarding record.
bot.command("forget", async (context) => {
  const userId = telegramUserId(context.from.id);
  await consent.delete(userId);
  await onboarding.delete(userId);
  return context.send(copy.forgottenMessage(HINTS));
});

// 7) Any other message — only reached when consent is granted AND onboarding is complete.
bot.on("message", async (context) => {
  const text = typeof context.text === "string" ? context.text : "";
  if (text.startsWith("/") || text.trim() === "") return;

  // A failed turn must still produce a visible reply — silence reads as a dead
  // bot, and the user has no way to tell whether their message even arrived.
  let reply: string;
  try {
    reply = await runAgent(
      telegramUserId(context.from.id),
      text,
      CHANNEL_LABELS.tg,
    );
  } catch (error) {
    console.error("[telegram] agent turn failed:", error);
    reply = copy.AGENT_UNAVAILABLE;
  }
  return context.send(reply);
});

bot.onStart(({ info }) =>
  console.log(
    `✨ @${info.username} up and polling (consent + onboarding gates active).`,
  ),
);

bot.start();

export default bot;
