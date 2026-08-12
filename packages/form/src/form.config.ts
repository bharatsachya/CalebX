/**
 * The one file to open when you want to change what the bot asks or says.
 *
 * Everything configurable about the form lives behind this module: the
 * questions, the choice options, the sheet layout, the commands, and every
 * user-facing string. It re-exports rather than inlines only because the repo
 * caps files at 300 lines — one import site, four small files behind it.
 *
 *   choices.ts   option tables for multiple-choice questions
 *   fields.ts    the questionnaire (assembled from three per-table files)
 *   sheet.ts     tab names, header rows, Matches columns
 *   copy.ts      every string the user can see
 *
 * Adding a question: append a `FormField` to the right `fields.*.ts`, then run
 * `bun run sheets:init` to extend the header row. Nothing else needs to change.
 */

export {
  COMPLEXION_OPTIONS,
  DIET_OPTIONS,
  DIET_PREF_OPTIONS,
  GENDER_OPTIONS,
  INCOME_BAND_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  OWNER_TYPE_OPTIONS,
} from "./choices.ts";

export {
  FORM_FIELDS,
  PUBLIC_FIELDS,
  SECTIONS,
  SENSITIVE_FIELDS,
  SKIPPED,
  allOptionIds,
  fieldByOptionId,
  fieldById,
  fieldsInSection,
  positionOf,
  sectionLabel,
} from "./fields.ts";

export {
  CALLBACK_BACK,
  CALLBACK_CANCEL,
  editCallback,
  parseEditCallback,
  parseSectionCallback,
  sectionCallback,
} from "./callbacks.ts";

export {
  CANDIDATE_HEADERS,
  CANDIDATE_META_COLUMNS,
  CONTACT_HEADERS,
  MATCH_COLUMNS,
  MATCH_HEADERS,
  MATCH_REASON_COLUMN,
  SHEET_TABS,
  USER_ID_COLUMN,
} from "./sheet.ts";

export * as copy from "./copy.ts";
export { COMMANDS } from "./copy.ts";
