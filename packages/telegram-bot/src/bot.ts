import { Bot } from "gramio";
import { getConfig } from "@calebx/config";
import {
  Neo4jUserRepository,
  Neo4jSummaryStore,
  Neo4jRecommendationStore,
} from "@calebx/db";
import type { Env } from "./env.ts";
import { Neo4jConsentStore } from "./consent.store.ts";
import { Neo4jOnboardingStore } from "./onboarding.store.ts";
import { KvSessionStore } from "./session.store.ts";
import { registerConsentGate } from "./consent.gate.ts";
import {
  registerOnboardingHandlers,
  resumeOnboarding,
} from "./onboarding.gate.ts";
import { registerChatHandlers } from "./chat.handlers.ts";
import { registerRecommendationHandlers } from "./recommend.handlers.ts";
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

/** Concrete stores the bot and the daily job share for one request/isolate. */
export interface BotDeps {
  consent: Neo4jConsentStore;
  onboarding: Neo4jOnboardingStore;
  session: KvSessionStore;
  userRepo: Neo4jUserRepository;
  summaryStore: Neo4jSummaryStore;
  recStore: Neo4jRecommendationStore;
}

/** Wires the Neo4j-backed stores + the KV session buffer from the Worker env. */
export function buildDeps(env: Env): BotDeps {
  return {
    consent: new Neo4jConsentStore(),
    onboarding: new Neo4jOnboardingStore(),
    session: new KvSessionStore(env.SESSIONS),
    userRepo: new Neo4jUserRepository(),
    summaryStore: new Neo4jSummaryStore(),
    recStore: new Neo4jRecommendationStore(),
  };
}

/**
 * Builds the GramIO bot with every handler wired, in the required order:
 *   1. consent gate (chokepoint — before any content is ingested)
 *   2. onboarding middleware + keyboard callbacks
 *   3. /start, consent accept/decline, /forget
 *   4. recommendation callbacks + /matches
 *   5. the conversational message handler
 * No polling loop — updates arrive via the webhook handler in worker.ts.
 */
export function createBot(deps: BotDeps): Bot {
  const config = getConfig();
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // 1) Consent gate FIRST.
  registerConsentGate(bot, deps.consent);

  // 2) Onboarding — after consent, before the message handler.
  registerOnboardingHandlers(bot, deps.onboarding, deps.userRepo);

  // 3a) /start — privacy notice, resume onboarding, or welcome back.
  bot.command("start", async (context) => {
    const telegramId = context.from.id;
    if ((await deps.consent.get(telegramId)) === "granted") {
      const record = await deps.onboarding.get(telegramId);
      if (record.step === "complete") return context.send(WELCOME_BACK);
      return resumeOnboarding(context, record);
    }
    return context.send(PRIVACY_NOTICE, { reply_markup: consentKeyboard });
  });

  // 3b) Consent — Accept. User node created; onboarding begins.
  bot.callbackQuery(CONSENT_ACCEPT, async (context) => {
    const telegramId = context.from?.id;
    if (telegramId === undefined) return context.answer();
    await deps.consent.set(telegramId, "granted");
    await deps.userRepo.createUser(telegramId, {
      username: context.from?.username ?? "",
    });
    await context.answer("Thanks!");
    await context.editText(ACCEPTED_MESSAGE).catch(() => undefined);
    await deps.onboarding.set(telegramId, { step: "pending_name" });
    await context.send(ONBOARDING_NAME_QUESTION);
  });

  // 3c) Consent — Decline.
  bot.callbackQuery(CONSENT_DECLINE, async (context) => {
    const telegramId = context.from?.id;
    if (telegramId !== undefined)
      await deps.consent.set(telegramId, "declined");
    await context.answer();
    await context.editText(DECLINED_MESSAGE).catch(() => undefined);
  });

  // 3d) /forget — erase the user node (consent, onboarding, summaries) + session.
  bot.command("forget", async (context) => {
    const telegramId = context.from.id;
    await deps.userRepo.deleteUser(telegramId);
    await deps.session.delete(telegramId);
    return context.send(FORGOTTEN_MESSAGE);
  });

  // 4) Recommendation callbacks (Say hi / Skip) + /matches.
  registerRecommendationHandlers(bot, deps.recStore);

  // 5) Conversational message handler (only reached post-consent, post-onboarding).
  registerChatHandlers(bot, {
    session: deps.session,
    onboarding: deps.onboarding,
    summaryStore: deps.summaryStore,
    userRepo: deps.userRepo,
    maxDailyMessages: config.MAX_DAILY_MESSAGES,
  });

  return bot;
}
