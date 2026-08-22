/**
 * Telegram rendering for the form. Everything here is GramIO; every string and
 * every id comes from `@calebx/form`.
 *
 * Same discipline as `../keyboards.ts`: keyboards are built *from* the shared
 * tables, never hand-written, so a `callback_data` value cannot drift from the
 * id the FSM expects back.
 */

import { InlineKeyboard } from "gramio";
import {
  CALLBACK_BACK,
  CALLBACK_CANCEL,
  SECTIONS,
  copy,
  editCallback,
  fieldsInSection,
  sectionCallback,
  type FormField,
  type SectionId,
} from "@calebx/form";

/** Two per row for short labels, one per row otherwise. */
export function keyboardForField(field: FormField): InlineKeyboard {
  const options = field.options ?? [];
  const twoPerRow = options.every((option) => option.label.length <= 14);

  const keyboard = new InlineKeyboard();
  options.forEach((option, index) => {
    if (index > 0 && (!twoPerRow || index % 2 === 0)) keyboard.row();
    keyboard.text(option.label, option.id);
  });
  return keyboard;
}

/** Step one of `/update`: which part of the form. */
export function sectionPickerKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  SECTIONS.forEach((section) => {
    keyboard.text(section.label, sectionCallback(section.id)).row();
  });
  keyboard.text(copy.UPDATE_CANCEL_LABEL, CALLBACK_CANCEL);
  return keyboard;
}

/**
 * Step two of `/update`: which answer within that section.
 *
 * Labels carry the current value so the user can see what they're changing
 * without leaving the picker. Telegram truncates long button text, so the value
 * is clipped first.
 */
export function fieldPickerKeyboard(
  section: SectionId,
  answers: Record<string, string>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const field of fieldsInSection(section)) {
    const current = answers[field.id];
    const suffix = current ? ` · ${clip(current, 18)}` : "";
    keyboard
      .text(`${shortLabel(field)}${suffix}`, editCallback(field.id))
      .row();
  }

  keyboard
    .text(copy.UPDATE_BACK_LABEL, CALLBACK_BACK)
    .text(copy.UPDATE_CANCEL_LABEL, CALLBACK_CANCEL);
  return keyboard;
}

/** The question, trimmed to something that fits on a button. */
function shortLabel(field: FormField): string {
  return clip(field.prompt.replace(/\?$/, ""), 30);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Phone verification contact-sharing keyboard. */
export const requestPhoneKeyboard = {
  keyboard: [
    [
      {
        text: copy.REQUEST_PHONE_BUTTON,
        request_contact: true,
      },
    ],
  ],
  resize_keyboard: true,
  one_time_keyboard: true,
};

export const removeKeyboard = {
  remove_keyboard: true as const,
};
