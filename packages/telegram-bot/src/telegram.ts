import { Bot } from "gramio";
import { PostgresUserRepository } from "@calebx/db";
import {
  CHANNEL_LABELS,
  FileConsentStore,
  FileOnboardingStore,
  copy,
  telegramUserId,
} from "@calebx/channel";
import { addMemory } from "@calebx/agent";
import {
  buildAgentDeps,
  createRunner,
  createSubscriber,
  executionMode,
} from "@calebx/queue";
import { initTracing } from "@calebx/trace";
import { config } from "./config.ts";
import { registerConsentGate } from "./consent.gate.ts";
import {
  registerOnboardingHandlers,
  resumeOnboarding,
} from "./onboarding.gate.ts";
import { registerAgentHandlers } from "./agent.gate.ts";
import { registerAdminHandlers } from "./admin.gate.ts";
import { consentKeyboard, forgetConfirmKeyboard } from "./keyboards.ts";

const HINTS = copy.TELEGRAM_HINTS;

initTracing("telegram");

const consent = new FileConsentStore(config.consentStorePath);
const onboarding = new FileOnboardingStore(config.onboardingStorePath);
const userRepo = new PostgresUserRepository();

const bot = new Bot(config.telegramBotToken);

const agentDeps = await buildAgentDeps();
const runner = createRunner(agentDeps);
// Typing is published only when a dispatch worker exists to act on it; in
// inline mode nothing is subscribed and the events would go nowhere.
const typingBus = executionMode() === "queue" ? createSubscriber() : undefined;

// 1) Consent gate FIRST — before any handler that could ingest data.
registerConsentGate(bot, consent);

// 2) Onboarding handlers — after consent gate, before the message handler.
registerOnboardingHandlers(bot, onboarding, (userId, message, response) =>
  addMemory(userId, null, message, response).then(() => undefined),
);

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

// 6) /forget — irreversible, so it asks first. The wipe itself spans mem0, the
//    graph, Postgres and the channel stores; see agent.gate.ts.
bot.command("forget", async (context) =>
  context.send(copy.forgetConfirmRequest(HINTS), {
    reply_markup: forgetConfirmKeyboard,
  }),
);

// 7) The agent: /switch, /recommendation, /findme, the forget confirmation, and
//    ordinary conversation. Only reached once consent and onboarding are done.
registerAgentHandlers(bot, {
  agent: agentDeps,
  runner,
  typingBus,
  adminChatId: config.adminChatId,
  eraseChannelState: async (userId) => {
    await consent.delete(userId);
    await onboarding.delete(userId);
  },
});

// 8) Admin commands — /register_group, run inside a group with the bot as admin.
registerAdminHandlers(bot, {
  agent: agentDeps,
  adminChatId: config.adminChatId,
});

bot.onStart(({ info }) =>
  process.stdout.write(
    `✨ @${info.username} up and polling — ${executionMode()} execution, consent + onboarding gates active.\n`,
  ),
);

bot.start();

export default bot;
export { CHANNEL_LABELS };
