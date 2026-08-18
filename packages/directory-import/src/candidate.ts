/**
 * A parsed booklet row → the cells that land in the Candidates and Contacts tabs.
 *
 * These people never used the bot, so the mapping asserts two things the form's
 * own writes take for granted: `consent_granted` is FALSE (§6.1 — they agreed to
 * nothing), and the id is namespaced `dir:` so a booklet serial can never
 * collide with a real `tg:` candidate (CLAUDE.md rule 12).
 *
 * Booklet columns map onto existing form fields where the concept matches
 * (gotra → community, feet-inches → the integer `height`); the handful with no
 * form field — birth time, provenance, the review flag — are appended columns
 * named in `EXTRA_CANDIDATE_COLUMNS`. The sheet tolerates extra columns by
 * design (`table.ts`), so this widens the tab without disturbing the bot.
 */

import { USER_ID_COLUMN } from "@calebx/form";
import type { ParsedRow } from "./types.ts";
import {
  dobToIso,
  genderFromSource,
  heightToCm,
  sourceSlug,
} from "./normalize.ts";

/** Directory-only columns appended after the form's own Candidates columns. */
export const EXTRA_CANDIDATE_COLUMNS = [
  "birth_time",
  "source",
  "source_no",
  "needs_review",
  "review_notes",
] as const;

/** A row's worth of cells, keyed by column header. */
export type Cells = Record<string, string>;

export interface MappedRow {
  userId: string;
  /** Candidates-tab cells: form fields (by id) plus the extras above. */
  candidate: Cells;
  /** Contacts-tab cells, or null when the booklet gave no phone. */
  contact: Cells | null;
}

/**
 * Builds the sheet rows for one parsed entry.
 *
 * `nowIso` and `index` are passed in rather than read here so the whole import
 * shares one timestamp and a caller can supply a stable fallback id for the rare
 * row whose serial the booklet omitted.
 */
export function mapRow(
  parsed: ParsedRow,
  sourceName: string,
  nowIso: string,
  index: number,
): MappedRow {
  const raw = parsed.raw;
  const slug = sourceSlug(sourceName);
  const serial = raw.sr_no?.trim();
  const userId = `dir:${slug}:${serial ?? `p${parsed.page}-${index}`}`;

  const issues = [...parsed.issues];
  const set = (cells: Cells, key: string, value: string | null | undefined) => {
    if (value !== null && value !== undefined && value !== "")
      cells[key] = value;
  };

  const candidate: Cells = {
    [USER_ID_COLUMN]: userId,
    created_at: nowIso,
    updated_at: nowIso,
    consent_granted: "FALSE",
  };

  set(candidate, "full_name", raw.name);
  set(candidate, "gender", genderFromSource(sourceName) ?? undefined);
  set(candidate, "birth_place", raw.birth_place);
  set(candidate, "community", raw.gotra);
  set(candidate, "highest_education", raw.education);
  set(candidate, "occupation", raw.occupation);

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
  candidate.source = sourceName;
  set(candidate, "source_no", serial);
  candidate.needs_review = issues.length > 0 ? "TRUE" : "FALSE";
  set(candidate, "review_notes", issues.join("; "));

  const contact: Cells | null = raw.contact
    ? { [USER_ID_COLUMN]: userId, updated_at: nowIso, phone: raw.contact }
    : null;

  return { userId, candidate, contact };
}
