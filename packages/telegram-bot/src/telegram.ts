import { Bot } from "gramio";
import { HelixUserRepository } from "@calebx/db";
import { runAgent } from "@calebx/agent";
import { config } from "./config.ts";
import { FileConsentStore } from "./file-consent.store.ts";
import { registerConsentGate } from "./consent.gate.ts";
import {
  ACCEPTED_MESSAGE,
  CONSENT_ACCEPT,
  CONSENT_DECLINE,
  consentKeyboard,
  DECLINED_MESSAGE,
  FORGOTTEN_MESSAGE,
  PRIVACY_NOTICE,
  WELCOME_BACK,
} from "./messages.ts";

const consent = new FileConsentStore(config.consentStorePath);
const userRepo = new HelixUserRepository();

const bot = new Bot(config.telegramBotToken);

// 1) Consent gate FIRST — before any handler that could ingest data.
registerConsentGate(bot, consent);

// 2) /start — privacy notice, or welcome back if already consented.
bot.command("start", async (context) => {
  const telegramId = context.from.id;
  if ((await consent.get(telegramId)) === "granted") {
    return context.send(WELCOME_BACK);
  }
  return context.send(PRIVACY_NOTICE, { reply_markup: consentKeyboard });
});

// 3) Consent — Accept. The user record is created only AFTER consent is granted.
bot.callbackQuery(CONSENT_ACCEPT, async (context) => {
  const telegramId = context.from?.id;
  if (telegramId === undefined) return context.answer();
  await consent.set(telegramId, "granted");
  await userRepo.createUser(telegramId);
  await context.answer("Thanks!");
  // Replace the notice so the buttons can't be tapped again.
  await context.editText(ACCEPTED_MESSAGE).catch(() => undefined);
});

// 4) Consent — Decline. We store the decision so we don't re-nag.
bot.callbackQuery(CONSENT_DECLINE, async (context) => {
  const telegramId = context.from?.id;
  if (telegramId !== undefined) await consent.set(telegramId, "declined");
  await context.answer();
  await context.editText(DECLINED_MESSAGE).catch(() => undefined);
});

// 5) /forget — revoke consent and erase what we stored.
bot.command("forget", async (context) => {
  const telegramId = context.from.id;
  await consent.delete(telegramId);
  // TODO(persona): when HelixDB lands, also delete this user's PersonaChunks here.
  return context.send(FORGOTTEN_MESSAGE);
});

// 6) Any other message — only reached when consent is granted (the gate guarantees it).
bot.on("message", async (context) => {
  const text = typeof context.text === "string" ? context.text : "";
  if (text.startsWith("/") || text.trim() === "") return;
  const reply = await runAgent(context.from.id, text);
  return context.send(reply);
});

bot.onStart(({ info }) =>
  console.log(`✨ @${info.username} up and polling (consent gate active).`),
);

bot.start();

export default bot;
