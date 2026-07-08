import { Bot } from "gramio";
import {
  Neo4jUserRepository,
  Neo4jSummaryStore,
  Neo4jRecommendationStore,
} from "@calebx/db";
import { config as env } from "@calebx/config";
import { config } from "./config.ts";
import { FileConsentStore } from "./file-consent.store.ts";
import { registerConsentGate } from "./consent.gate.ts";
import { FileOnboardingStore } from "./onboarding.store.ts";
import { FileSessionStore } from "./session.store.ts";
import {
  registerOnboardingHandlers,
  resumeOnboarding,
} from "./onboarding.gate.ts";
import { registerRecommendationHandlers } from "./recommend.handlers.ts";
import { registerChatHandlers } from "./chat.handlers.ts";
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
const session = new FileSessionStore(config.sessionStorePath);
const userRepo = new Neo4jUserRepository();
const summaryStore = new Neo4jSummaryStore();
const recStore = new Neo4jRecommendationStore();

const bot = new Bot(config.telegramBotToken);

// 1) Consent gate FIRST — before any handler that could ingest data.
registerConsentGate(bot, consent);

// 2) Onboarding — after consent, before the chat handler.
registerOnboardingHandlers(bot, onboarding, userRepo);

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
  await userRepo.createUser(telegramId, {
    username: context.from?.username ?? "",
  });
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

// 6) /forget — revoke consent and erase everything derived from this user.
bot.command("forget", async (context) => {
  const telegramId = context.from.id;
  await userRepo.deleteUser(telegramId);
  await session.delete(telegramId);
  await consent.delete(telegramId);
  await onboarding.delete(telegramId);
  return context.send(FORGOTTEN_MESSAGE);
});

// 7) Recommendation callbacks (Say hi / Skip) + /matches.
registerRecommendationHandlers(bot, recStore);

// 8) Chat + photo handler — reached only after consent + onboarding complete.
registerChatHandlers(bot, {
  session,
  onboarding,
  summaryStore,
  userRepo,
  maxDailyMessages: env.MAX_DAILY_MESSAGES,
});

bot.onStart(({ info }) =>
  console.log(
    `✨ @${info.username} up and polling (consent + onboarding gates active).`,
  ),
);

bot.start();

export default bot;
