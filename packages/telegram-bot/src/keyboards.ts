import { InlineKeyboard } from "gramio";
import {
  AGE_OPTIONS,
  PURPOSE_OPTIONS,
  copy,
  type ChoiceOption,
} from "@calebx/channel";

/**
 * Telegram-specific rendering. Everything here is GramIO; the text and the
 * option ids come from `@calebx/channel` so the two bots cannot drift.
 *
 * Keyboards are built FROM the shared option tables rather than hand-written,
 * so a `callback_data` string can never fall out of sync with the id the
 * onboarding FSM expects back.
 */

/** Lays options out one per row, in declaration order. */
function keyboardFrom(options: readonly ChoiceOption[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  options.forEach((option, index) => {
    if (index > 0) keyboard.row();
    keyboard.text(option.label, option.id);
  });
  return keyboard;
}

export const consentKeyboard = new InlineKeyboard()
  .text(copy.CONSENT_ACCEPT_LABEL, copy.CONSENT_ACCEPT)
  .row()
  .text(copy.CONSENT_DECLINE_LABEL, copy.CONSENT_DECLINE);

/** Two per row, preserving the original 18–24 / 25–34 · 35–44 / 45+ layout. */
export const ageKeyboard = AGE_OPTIONS.reduce(
  (keyboard, option, index) =>
    index === 2
      ? keyboard.row().text(option.label, option.id)
      : keyboard.text(option.label, option.id),
  new InlineKeyboard(),
);

export const purposeKeyboard = keyboardFrom(PURPOSE_OPTIONS);

/** Picks the keyboard for a choice prompt coming out of the shared FSM. */
export function keyboardForGroup(group: "age" | "purpose"): InlineKeyboard {
  return group === "age" ? ageKeyboard : purposeKeyboard;
}

/** Asked before entering a mode for the first time — each collects different data. */
export const modeConsentKeyboard = new InlineKeyboard()
  .text(copy.MODE_SWITCH_ACCEPT_LABEL, copy.MODE_SWITCH_ACCEPT)
  .row()
  .text(copy.MODE_SWITCH_DECLINE_LABEL, copy.MODE_SWITCH_DECLINE);

/**
 * `/forget` is irreversible, so it is a two-step with the destructive action
 * spelled out rather than a single command that silently wipes everything.
 */
export const forgetConfirmKeyboard = new InlineKeyboard()
  .text(copy.FORGET_DECLINE_LABEL, copy.FORGET_CONFIRM_DECLINE)
  .row()
  .text(copy.FORGET_ACCEPT_LABEL, copy.FORGET_CONFIRM_ACCEPT);

/** People discovery is opt-in; nobody is described to anyone without this. */
export const discoverableKeyboard = new InlineKeyboard()
  .text("Yes, find me people", copy.DISCOVERABLE_ACCEPT)
  .row()
  .text("Not for now", copy.DISCOVERABLE_DECLINE);
