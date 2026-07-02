import type { Bot } from "gramio";
import type { ConsentStore } from "./consent.store.ts";
import {
  consentKeyboard,
  NEEDS_CONSENT_NUDGE,
  PRIVACY_NOTICE,
} from "./messages.ts";

/** Commands always allowed through — they ARE the consent flow. */
const ALWAYS_ALLOWED_COMMANDS = new Set(["/start", "/forget"]);

function leadingCommand(text: string): string {
  // "/start", "/start@MyBot", "/start extra" → "/start"
  const first = text.trim().split(/\s+/)[0] ?? "";
  return first.split("@")[0] ?? "";
}

/**
 * Consent gate. Register FIRST, before any handler that could ingest data.
 *
 *   - Non-message updates (e.g. the consent buttons) pass straight through.
 *   - /start and /forget always pass through.
 *   - Any other message is allowed only if the user has granted consent.
 *     Otherwise it is dropped here — it never reaches a downstream handler — and
 *     the user is re-shown the privacy notice.
 *
 * Because this is the single chokepoint, every future handler that ingests
 * message content (the persona pipeline) is protected automatically.
 */
export function registerConsentGate(bot: Bot, consent: ConsentStore): void {
  bot.use(async (context, next) => {
    // Only messages carry content we'd process; narrow to the message context.
    if (!context.is("message")) return next();

    const text = typeof context.text === "string" ? context.text : "";
    if (ALWAYS_ALLOWED_COMMANDS.has(leadingCommand(text))) return next();

    const telegramId = context.from?.id;
    if (telegramId === undefined) return; // unidentifiable → drop, store nothing

    if ((await consent.get(telegramId)) === "granted") return next();

    // Not consented: re-prompt and STOP (no next()) → message is never ingested.
    await context.send(`${NEEDS_CONSENT_NUDGE}\n\n${PRIVACY_NOTICE}`, {
      reply_markup: consentKeyboard,
    });
  });
}
