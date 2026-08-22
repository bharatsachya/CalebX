/**
 * A read card → the cells that land in the Candidates and Contacts tabs.
 *
 * The sibling of `candidate.ts`, for the card format. It shares that file's two
 * assertions — `consent_granted` is FALSE (§6.1: these people agreed to
 * nothing) and ids are namespaced so a booklet serial cannot collide with a real
 * candidate (rule 12) — and adds a third that is specific to OCR:
 *
 *   **`needs_review` is unconditionally TRUE.**
 *
 * In the PDF pipeline that flag means "this row had a parse problem". Here it
 * means "no character in this row was read by anything but a recogniser", which
 * is true of every row, including the ones that look perfect. A clean-looking
 * OCR row is exactly the dangerous case: `09-08-2000` for `09-08-2001` reads as
 * data, not as damage.
 */

import { USER_ID_COLUMN } from "@calebx/form";
import type { Cells, MappedRow } from "./candidate.ts";
import { dobToIso, heightToCm } from "./normalize.ts";
import type { ParsedCard } from "./image/types.ts";

/** Card-only columns appended after the form's own Candidates columns. */
export const EXTRA_CARD_COLUMNS = [
  "birth_time",
  "weight",
  "annual_income",
  "work_place",
  "maternal_gotra",
  "source",
  "source_no",
  "source_page",
  "ocr_confidence",
  "needs_review",
  "review_notes",
] as const;

/**
 * Gender is not printed on a card — the booklet is split into `युवक` (men) and
 * `युवती` (women) sections and the masthead carries it. Passed in by the caller
 * rather than guessed here, and left blank when unknown.
 */
export type Gender = "male" | "female" | null;

export function mapCard(
  parsed: ParsedCard,
  sourceName: string,
  sourceSlug: string,
  nowIso: string,
  gender: Gender,
): MappedRow {
  const raw = parsed.raw;
  const issues = [...parsed.issues];

  // The printed entry number is the stable id. Without one there is nothing to
  // key on across re-imports, so the position in the booklet stands in — and
  // that is recorded as an issue, because position shifts if a page is re-shot.
  const serial = raw.entry_no?.trim();
  if (!serial) issues.push("no entry number — id derived from page position");
  const suffix = serial ?? `p${parsed.page}-${parsed.index}`;
  const userId = `dir:${sourceSlug}:${suffix}`;

  const set = (cells: Cells, key: string, value: string | undefined): void => {
    if (value !== undefined && value.trim() !== "") cells[key] = value.trim();
  };

  const candidate: Cells = {
    [USER_ID_COLUMN]: userId,
    created_at: nowIso,
    updated_at: nowIso,
    consent_granted: "FALSE",
  };

  set(candidate, "full_name", raw.name);
  if (gender) candidate.gender = gender;
  set(candidate, "birth_place", raw.birth_place);
  set(candidate, "community", raw.gotra);
  set(candidate, "highest_education", raw.education);
  set(candidate, "occupation", raw.occupation);
  set(candidate, "father_name", raw.father_name);
  set(candidate, "father_occupation", raw.father_occupation);
  set(candidate, "mother_name", raw.mother_name);

  // Printed as sisters/brothers in one cell, e.g. `2/1`.
  if (raw.siblings) {
    const match = raw.siblings.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      candidate.sisters = match[1]!;
      candidate.brothers = match[2]!;
    } else {
      issues.push(`unparseable siblings "${raw.siblings}"`);
    }
  }

  if (raw.dob) {
    const iso = dobToIso(raw.dob);
    if (iso) candidate.dob = iso;
    else issues.push(`unparseable dob "${raw.dob}"`);
  }

  if (raw.height) {
    const cm = heightToCm(raw.height);
    if (cm !== null) candidate.height = String(cm);
    else issues.push(`unparseable height "${raw.height}"`);
  }

  set(candidate, "birth_time", raw.birth_time);
  set(candidate, "weight", raw.weight);
  set(candidate, "annual_income", raw.annual_income);
  set(candidate, "work_place", raw.work_place);
  set(candidate, "maternal_gotra", raw.maternal_gotra);

  candidate.source = sourceName;
  set(candidate, "source_no", serial);
  candidate.source_page = String(parsed.page);
  candidate.ocr_confidence = parsed.confidence.toFixed(0);
  // Unconditional — see the file header.
  candidate.needs_review = "TRUE";
  set(candidate, "review_notes", issues.join("; "));

  const contactCells: Cells = { [USER_ID_COLUMN]: userId, updated_at: nowIso };
  set(contactCells, "phone", raw.phone);
  set(contactCells, "address", raw.address);
  const hasContact =
    contactCells.phone !== undefined || contactCells.address !== undefined;

  return { userId, candidate, contact: hasContact ? contactCells : null };
}
