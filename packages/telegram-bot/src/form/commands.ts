/**
 * The four commands: /start, /update, /match, /forget — plus /skip.
 *
 * Each is a plain function taking its dependencies, so `handlers.ts` stays a
 * registration table and none of these needs a GramIO type beyond `Sendable`.
 */

import {
  copy,
  isComplete,
  nextField,
  promptForField,
  skip,
  type MatchStore,
} from "@calebx/form";
import {
  eraseProfile,
  loadProfile,
  saveProfile,
  type ProfileStores,
} from "./profile.ts";
import { sendPrompts, sendText, type Sendable } from "./render.ts";
import { endEdit } from "./session.ts";

/** Begins the form, or resumes it at the first unanswered question. */
export async function startCommand(
  stores: ProfileStores,
  context: Sendable,
  userId: string,
): Promise<void> {
  endEdit(userId); // /start abandons any half-finished /update
  const profile = await loadProfile(stores, userId);
  const upcoming = nextField(profile.answers);

  if (!upcoming) return sendText(context, copy.ALREADY_COMPLETE);

  await sendText(context, profile.exists ? copy.RESUMING : copy.WELCOME);
  await sendPrompts(context, [promptForField(upcoming)]);
}

/** Passes over the current optional question. */
export async function skipCommand(
  stores: ProfileStores,
  context: Sendable,
  userId: string,
): Promise<void> {
  const profile = await loadProfile(stores, userId);
  const current = nextField(profile.answers);
  if (!current) return sendText(context, copy.NOTHING_TO_SKIP);

  const result = skip(profile.answers, current);
  if (result.outcome !== "advanced") {
    return sendPrompts(context, result.prompts);
  }

  try {
    await saveProfile(stores, userId, result.answers, profile.createdAt);
  } catch (error) {
    console.error(`[form] skip failed for ${userId}:`, error);
    return sendText(context, copy.STORAGE_UNAVAILABLE);
  }

  await sendPrompts(context, result.prompts);
}

/**
 * Shows the hand-curated suggestions.
 *
 * Takes a `MatchStore` and nothing else. It has no `ContactStore`, so there is
 * no route from here to a phone number — the rule in `003_contact_details.sql`
 * holds because of what this function can reach, not because of what it
 * remembers not to print.
 */
export async function matchCommand(
  stores: ProfileStores,
  matches: MatchStore,
  context: Sendable,
  userId: string,
): Promise<void> {
  const profile = await loadProfile(stores, userId);
  if (!isComplete(profile.answers)) {
    return sendText(context, copy.MATCH_INCOMPLETE_PROFILE);
  }

  let found;
  try {
    found = await matches.list(userId);
  } catch (error) {
    console.error(`[form] match lookup failed for ${userId}:`, error);
    return sendText(context, copy.STORAGE_UNAVAILABLE);
  }

  if (found.length === 0) return sendText(context, copy.NO_MATCHES);
  await sendText(context, copy.formatMatches(found));
}

/** Erases the user's answers and contact details. Never touches Matches. */
export async function forgetCommand(
  stores: ProfileStores,
  context: Sendable,
  userId: string,
): Promise<void> {
  endEdit(userId);
  try {
    await eraseProfile(stores, userId);
  } catch (error) {
    console.error(`[form] erase failed for ${userId}:`, error);
    return sendText(context, copy.STORAGE_UNAVAILABLE);
  }
  await sendText(context, copy.FORGOTTEN);
}
