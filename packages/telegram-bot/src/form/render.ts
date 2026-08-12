/**
 * Turns the FSM's `Prompt`s into Telegram messages.
 *
 * The `Sendable` narrowing is the same trick `../onboarding.gate.ts` uses: it
 * lets one renderer serve both a message context and a callback context without
 * either being imported here.
 */

import { keyboardForField } from "./keyboards.ts";
import type { Prompt } from "@calebx/form";

export interface Sendable {
  send(
    text: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> | unknown;
}

/** HTML, not Markdown — see the note at the top of `@calebx/form`'s `copy.ts`. */
const PARSE_MODE = { parse_mode: "HTML" } as const;

export async function sendPrompt(
  context: Sendable,
  prompt: Prompt,
): Promise<void> {
  if (prompt.kind === "choice") {
    await context.send(prompt.text, {
      ...PARSE_MODE,
      reply_markup: keyboardForField(prompt.field),
    });
    return;
  }
  await context.send(prompt.text, PARSE_MODE);
}

/**
 * Sends prompts in order, awaiting each.
 *
 * Sequential on purpose: a rejection is "here's what's wrong" followed by the
 * re-ask, and Telegram does not guarantee ordering across concurrent sends.
 */
export async function sendPrompts(
  context: Sendable,
  prompts: readonly Prompt[],
): Promise<void> {
  for (const prompt of prompts) {
    await sendPrompt(context, prompt);
  }
}

/** Plain text with HTML parsing on, for copy that isn't an FSM prompt. */
export async function sendText(context: Sendable, text: string): Promise<void> {
  await context.send(text, PARSE_MODE);
}
