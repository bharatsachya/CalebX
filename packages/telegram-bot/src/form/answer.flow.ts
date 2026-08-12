/**
 * Applying one answer — the path shared by typed replies and tapped buttons.
 *
 * Both entry points land in `applyAnswer`, so an answer behaves identically
 * however it arrived, and `/update` edit mode is honoured in one place instead
 * of two.
 */

import {
  advance,
  applyEdit,
  copy,
  fieldById,
  isComplete,
  nextField,
  promptForField,
  type Input,
} from "@calebx/form";
import { loadProfile, saveProfile, type ProfileStores } from "./profile.ts";
import { sendPrompts, sendText, type Sendable } from "./render.ts";
import { currentEdit, endEdit } from "./session.ts";

export async function applyAnswer(
  stores: ProfileStores,
  context: Sendable,
  userId: string,
  input: Input,
): Promise<void> {
  const profile = await loadProfile(stores, userId);
  const editingId = currentEdit(userId);

  const result = editingId
    ? editAnswer(profile.answers, editingId, input)
    : advance(profile.answers, input);

  if (result === null) {
    endEdit(userId);
    return sendText(context, copy.UPDATE_CANCELLED);
  }

  if (result.outcome === "complete") {
    // Every question is answered and this wasn't an edit — nothing to apply.
    return sendText(context, copy.ALREADY_COMPLETE);
  }

  if (result.outcome === "rejected") {
    // Nothing changed; the FSM already produced the reason and the re-ask.
    return sendPrompts(context, result.prompts);
  }

  // Persist before replying: a reply the sheet didn't record would have the user
  // believing an answer was saved when it wasn't.
  try {
    await saveProfile(stores, userId, result.answers, profile.createdAt);
  } catch (error) {
    console.error(`[form] save failed for ${userId}:`, error);
    return sendText(context, copy.STORAGE_UNAVAILABLE);
  }

  if (editingId) endEdit(userId);

  await sendPrompts(context, result.prompts);

  // An edit made from inside an unfinished form should carry on where it left
  // off, rather than dropping the user at a dead end.
  if (editingId && !isComplete(result.answers)) {
    const upcoming = nextField(result.answers);
    if (upcoming) await sendPrompts(context, [promptForField(upcoming)]);
  }
}

/** Null means "the field vanished from the config" — treat as a cancelled edit. */
function editAnswer(
  answers: Record<string, string>,
  fieldId: string,
  input: Input,
) {
  const field = fieldById(fieldId);
  return field ? applyEdit(answers, field, input) : null;
}
