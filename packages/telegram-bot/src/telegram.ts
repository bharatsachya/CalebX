import { Bot } from "gramio";
import { HelixUserRepository } from "@calebx/db";
import { runAgent, addMemory } from "@calebx/agent";
import { config } from "./config.ts";
import { FileConsentStore } from "./file-consent.store.ts";
import { registerConsentGate } from "./consent.gate.ts";
import { FileOnboardingStore } from "./onboarding.store.ts";
import {
  registerOnboardingHandlers,
  resumeOnboarding,
} from "./onboarding.gate.ts";
import {
  ACCEPTED_MESSAGE,
  CONSENT_ACCEPT,
  CONSENT_DECLINE,
  consentKeyboard,
  DECLINED_MESSAGE,
  FORGOTTEN_MESSAGE,
  ONBOARDING_NAME_QUESTION,
  PRIVACY_NOTICE,
  WELCOME_BACK,
} from "./messages.ts";

const consent = new FileConsentStore(config.consentStorePath);
const onboarding = new FileOnboardingStore(config.onboardingStorePath);
const userRepo = new HelixUserRepository();

const bot = new Bot(config.telegramBotToken);

// 1) Consent gate FIRST — before any handler that could ingest data.
registerConsentGate(bot, consent);

// 2) Onboarding handlers — after consent gate, before message handler.
registerOnboardingHandlers(bot, onboarding, addMemory);

// 3) /start — privacy notice, or resume onboarding, or welcome back.
bot.command("start", async (context) => {
  const telegramId = context.from.id;
  if ((await consent.get(telegramId)) === "granted") {
    const record = await onboarding.get(telegramId);
    if (record.step === "complete") return context.send(WELCOME_BACK);
    return resumeOnboarding(context, record);
  }
  return context.send(PRIVACY_NOTICE, { reply_markup: consentKeyboard });
});

// 4) Consent — Accept. User record created; onboarding sequence begins.
bot.callbackQuery(CONSENT_ACCEPT, async (context) => {
  const telegramId = context.from?.id;
  if (telegramId === undefined) return context.answer();
  await consent.set(telegramId, "granted");
  await userRepo.createUser(telegramId);
  await context.answer("Thanks!");
  await context.editText(ACCEPTED_MESSAGE).catch(() => undefined);
  await onboarding.set(telegramId, { step: "pending_name" });
  await context.send(ONBOARDING_NAME_QUESTION);
});

// 5) Consent — Decline.
bot.callbackQuery(CONSENT_DECLINE, async (context) => {
  const telegramId = context.from?.id;
  if (telegramId !== undefined) await consent.set(telegramId, "declined");
  await context.answer();
  await context.editText(DECLINED_MESSAGE).catch(() => undefined);
});

// 6) /forget — revoke consent and erase onboarding record.
bot.command("forget", async (context) => {
  const telegramId = context.from.id;
  await consent.delete(telegramId);
  await onboarding.delete(telegramId);
  return context.send(FORGOTTEN_MESSAGE);
});

// 7) Any other message — only reached when consent is granted AND onboarding is complete.
bot.on("message", async (context) => {
  const text = typeof context.text === "string" ? context.text : "";
  if (text.startsWith("/") || text.trim() === "") return;
  const reply = await runAgent(context.from.id, text);
  return context.send(reply);
});

bot.onStart(({ info }) =>
  console.log(
    `✨ @${info.username} up and polling (consent + onboarding gates active).`,
  ),
);

bot.start();

export default bot;
