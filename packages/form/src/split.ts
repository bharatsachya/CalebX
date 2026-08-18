/**
 * Routing answers between the two tabs they are stored in.
 *
 * The FSM asks one flat sequence of questions, but `003_contact_details.sql`
 * keeps contact information in its own table for a reason, and the sheet mirrors
 * that. Which field goes where is a property of the schema, not of the bot, so
 * the split lives here as a pure function rather than in a handler.
 */

import { FORM_FIELDS } from "./fields.ts";
import type { Answers } from "./types.ts";

const SENSITIVE_IDS = new Set(
  FORM_FIELDS.filter((field) => field.table === "contact_details").map(
    (field) => field.id,
  ),
);

export function isSensitive(fieldId: string): boolean {
  return SENSITIVE_IDS.has(fieldId);
}

/** Splits a full answer set into its two destination tabs. */
export function splitAnswers(answers: Answers): {
  candidate: Answers;
  contact: Answers;
} {
  const candidate: Answers = {};
  const contact: Answers = {};

  for (const [id, value] of Object.entries(answers)) {
    if (SENSITIVE_IDS.has(id)) contact[id] = value;
    else candidate[id] = value;
  }

  return { candidate, contact };
}

/**
 * Recombines the two tabs into the flat map the FSM expects.
 *
 * Contact answers win on a key collision, but there are none by construction —
 * a field id belongs to exactly one table.
 */
export function mergeAnswers(candidate: Answers, contact: Answers): Answers {
  return { ...candidate, ...contact };
}
