/**
 * Callback ids for the `/update` picker.
 *
 * Telegram round-trips these as `callback_data`, which is capped at 64 bytes —
 * the longest id these builders can produce is well inside that, but a very long
 * new field id would not be. Answer options have their own ids, declared in
 * `choices.ts`.
 *
 * Declared here rather than in the bot for the same reason the copy is: the ids
 * are a contract between what was rendered and what comes back, and a second
 * channel would need the identical set.
 */

const SECTION_PREFIX = "form:section:";
const EDIT_PREFIX = "form:edit:";

/** Closes the picker without changing anything. */
export const CALLBACK_CANCEL = "form:cancel";

/** Returns from the field list to the section list. */
export const CALLBACK_BACK = "form:back";

export function sectionCallback(sectionId: string): string {
  return `${SECTION_PREFIX}${sectionId}`;
}

export function editCallback(fieldId: string): string {
  return `${EDIT_PREFIX}${fieldId}`;
}

/** The section id in a picker callback, or null if it isn't one. */
export function parseSectionCallback(data: string): string | null {
  return data.startsWith(SECTION_PREFIX)
    ? data.slice(SECTION_PREFIX.length)
    : null;
}

/** The field id in an edit callback, or null if it isn't one. */
export function parseEditCallback(data: string): string | null {
  return data.startsWith(EDIT_PREFIX) ? data.slice(EDIT_PREFIX.length) : null;
}
