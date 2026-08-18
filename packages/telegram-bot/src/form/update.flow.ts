/**
 * Asking the question again during `/update`.
 *
 * Separate from the ordinary question render because an edit deliberately drops
 * the "Question 7 of 30" prefix — the user is not walking the form, they are
 * changing one thing — and adds the value they are about to replace.
 */

import { copy, editPrompt, type FormField } from "@calebx/form";
import { sendPrompt, sendText, type Sendable } from "./render.ts";

export async function editPromptFor(
  context: Sendable,
  field: FormField,
  current: string | undefined,
): Promise<void> {
  if (current) await sendText(context, copy.currentValue(current));
  await sendPrompt(context, editPrompt(field));
}
