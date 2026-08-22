/**
 * Types for the form prototype.
 *
 * The value vocabulary mirrors `packages/db/src/types.ts`, which in turn mirrors
 * `packages/db/src/migrations/`. Keeping the strings identical is what makes a
 * later import of the sheet into Postgres a column mapping rather than a
 * translation layer.
 */

import type { ChoiceOption } from "@calebx/channel";

/** Which migration table a field ultimately belongs to. */
export type FormTable = "candidates" | "partner_prefs" | "contact_details";

/** Question groupings, used for progress display and the `/update` picker. */
export type SectionId =
  "account" | "biodata" | "family" | "contact" | "preferences";

export interface FormSection {
  id: SectionId;
  label: string;
}

/**
 * How an answer is captured and validated.
 *
 * `integer` and `date` exist because the underlying columns are `integer` and
 * `date` — accepting free text there would push a parse failure into the import
 * step, long after the user has gone.
 */
export type FieldKind = "text" | "long_text" | "integer" | "date" | "choice";

export interface FormField {
  /** Stable id. Also the sheet column header and the Postgres column name. */
  id: string;
  section: SectionId;
  /** Destination table on a future Postgres import. */
  table: FormTable;
  kind: FieldKind;
  /** The question as the user sees it. */
  prompt: string;
  /** Shown under the prompt for fields whose expected format isn't obvious. */
  hint?: string;
  /** Present iff `kind === "choice"`. */
  options?: readonly ChoiceOption[];
  /** Optional fields can be passed over with `/skip`. */
  required: boolean;
  /** Inclusive bounds for `integer` fields. */
  min?: number;
  max?: number;
}

/**
 * One candidate's answers, keyed by `FormField.id`.
 *
 * A missing key means "not asked yet"; `SKIPPED` means "asked and passed over".
 * The distinction is load-bearing — the current question is derived as the first
 * field with no entry, so a skipped field must leave a mark or the form would
 * loop on it forever.
 */
export type Answers = Record<string, string>;

export interface CandidateProfile {
  userId: string;
  telegramUserId?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Mirrored from the consent ledger so the sheet is self-describing — you can
   * see who agreed without cross-referencing `.data/consent.json`.
   * `packages/channel`'s `ConsentStore` remains the authority the gate reads.
   */
  consentGranted: boolean;
  answers: Answers;
}

/** SENSITIVE — see `003_contact_details.sql`. Never rendered into a match. */
export interface ContactRecord {
  userId: string;
  answers: Answers;
}

/**
 * A hand-curated suggestion, read from the Matches tab.
 *
 * Deliberately a flat string map rather than a mirror of the `matches` table:
 * the columns are declared in `fields.ts` and rendered generically, so you can
 * add a column in the sheet without touching code.
 */
export interface Match {
  userId: string;
  values: Record<string, string>;
}
