/**
 * The form bot: a deterministic questionnaire backed by Google Sheets.
 *
 * A separate entry point from `telegram.ts` on purpose. That bot builds a
 * persona through open conversation with an LLM; this one asks a fixed list of
 * questions and stores the answers in a spreadsheet a human curates by hand. The
 * two run independently so the experiences can be compared.
 *
 * Notably absent: `@calebx/agent` and `@calebx/db`. No model, no Postgres.
 *
 *   bun run bot:form
 */

import { Bot } from "gramio";
import { FileConsentStore } from "@calebx/channel";
import { FORM_FIELDS, SHEET_TABS } from "@calebx/form";
import {
  SheetsCandidateStore,
  SheetsContactStore,
  SheetsMatchStore,
} from "@calebx/sheets";
import { config } from "./config.ts";
import { registerConsentGate } from "./consent.gate.ts";
import { registerFormHandlers } from "./form/handlers.ts";

const consent = new FileConsentStore(config.consentStorePath);

const bot = new Bot(config.telegramBotToken);

// 1) Consent gate FIRST — nothing reaches the sheet before agreement.
//    /start and /forget pass through; everything else gets the notice.
registerConsentGate(bot, consent);

// 2) The form itself.
registerFormHandlers(bot, {
  candidates: new SheetsCandidateStore(),
  contacts: new SheetsContactStore(),
  matches: new SheetsMatchStore(),
  consent,
});

bot.onStart(({ info }) =>
  console.log(
    `📋 @${info.username} up and polling — ${FORM_FIELDS.length} questions, ` +
      `sheet tabs: ${Object.values(SHEET_TABS).join(", ")}.`,
  ),
);

bot.start();

export default bot;
