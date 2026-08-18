/**
 * The questionnaire, derived column-for-column from `packages/db/src/migrations/`.
 *
 * Order here is the order the bot asks in, and the order columns appear in the
 * sheet. Appending a field is safe — `sheets:init` extends the header row and
 * the FSM picks the new question up for everyone who hasn't answered it yet. Do
 * not reorder or rename ids: a header that no longer matches an id orphans that
 * column's data.
 *
 * The three source files map one-to-one onto the three destination tables, so
 * `field.table` is never guesswork.
 */

import { CANDIDATE_FIELDS } from "./fields.candidates.ts";
import { CONTACT_FIELDS } from "./fields.contact.ts";
import { PREFERENCE_FIELDS } from "./fields.prefs.ts";
import type { FormField, FormSection, SectionId } from "./types.ts";

export const SECTIONS: readonly FormSection[] = [
  { id: "account", label: "Getting started" },
  { id: "biodata", label: "About you" },
  { id: "family", label: "Family" },
  { id: "contact", label: "Contact" },
  { id: "preferences", label: "What you're looking for" },
] as const;

/**
 * Written into a cell when the user passes over an optional question.
 *
 * An empty cell means "not asked yet" and is what `nextField()` looks for, so a
 * skip has to leave a mark or the form would ask the same question forever.
 */
export const SKIPPED = "-";

export const FORM_FIELDS: readonly FormField[] = [
  ...CANDIDATE_FIELDS,
  ...CONTACT_FIELDS,
  ...PREFERENCE_FIELDS,
] as const;

/** Fields whose answers live in the sensitive `Contacts` tab. */
export const SENSITIVE_FIELDS: readonly FormField[] = CONTACT_FIELDS;

/** Fields whose answers live in the main `Candidates` tab. */
export const PUBLIC_FIELDS: readonly FormField[] = [
  ...CANDIDATE_FIELDS,
  ...PREFERENCE_FIELDS,
] as const;

const FIELDS_BY_ID = new Map(FORM_FIELDS.map((field) => [field.id, field]));

/**
 * Every answer-option id mapped back to the field that owns it.
 *
 * Option ids are globally unique (`form:<field>:<value>`), so a tapped button
 * identifies its own question. That lets the handler detect a tap on a stale
 * keyboard — the user scrolling up and answering question 4 again — instead of
 * writing it to whatever question happens to be current.
 */
const FIELDS_BY_OPTION_ID = new Map(
  FORM_FIELDS.flatMap((field) =>
    (field.options ?? []).map((option) => [option.id, field] as const),
  ),
);

export function fieldById(id: string): FormField | null {
  return FIELDS_BY_ID.get(id) ?? null;
}

export function fieldByOptionId(optionId: string): FormField | null {
  return FIELDS_BY_OPTION_ID.get(optionId) ?? null;
}

/** Every answer-option id across every choice field. */
export function allOptionIds(): string[] {
  return [...FIELDS_BY_OPTION_ID.keys()];
}

export function fieldsInSection(section: SectionId): readonly FormField[] {
  return FORM_FIELDS.filter((field) => field.section === section);
}

export function sectionLabel(id: SectionId): string {
  return SECTIONS.find((section) => section.id === id)?.label ?? "Questions";
}

/** 1-based position of a field in the overall sequence, for progress display. */
export function positionOf(field: FormField): number {
  return FORM_FIELDS.findIndex((candidate) => candidate.id === field.id) + 1;
}
