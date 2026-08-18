/**
 * Per-field answer validation.
 *
 * These run before anything is written, because the sheet is a staging area for
 * a Postgres import: `height` and `brothers` land in `integer` columns and `dob`
 * in a `date` column (`002_candidates.sql`). Accepting free text here would
 * defer the parse failure to the import, long after the user has gone.
 *
 * Validators return a message from `copy.ts` rather than authoring one, so the
 * FSM stays free of user-facing strings.
 */

import * as copy from "./copy.ts";
import type { Answers, FormField } from "./types.ts";

export type Validation =
  { ok: true; value: string } | { ok: false; message: string };

const DATE_PATTERN = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

/** Validates one raw answer against a single field's own rules. */
export function validate(field: FormField, raw: string): Validation {
  const value = raw.trim();

  if (value === "") {
    return field.required
      ? { ok: false, message: copy.REQUIRED_FIELD }
      : { ok: false, message: copy.CANNOT_SKIP_REQUIRED };
  }

  switch (field.kind) {
    case "integer":
      return validateInteger(field, value);
    case "date":
      return validateDate(value);
    case "choice":
      return validateChoice(field, value);
    case "text":
    case "long_text":
      return { ok: true, value };
  }
}

function validateInteger(field: FormField, value: string): Validation {
  if (!/^-?\d+$/.test(value)) {
    return { ok: false, message: copy.INVALID_INTEGER };
  }

  const parsed = Number(value);
  const min = field.min ?? Number.NEGATIVE_INFINITY;
  const max = field.max ?? Number.POSITIVE_INFINITY;

  if (parsed < min || parsed > max) {
    return {
      ok: false,
      message: copy.outOfRange(field.min ?? min, field.max ?? max),
    };
  }

  return { ok: true, value: String(parsed) };
}

/**
 * Accepts DD/MM/YYYY (or DD-MM-YYYY) and normalises to the ISO `YYYY-MM-DD` that
 * a Postgres `date` column expects.
 *
 * Rebuilding the date and comparing components back is what catches 31/02/1990,
 * which `Date` would silently roll forward to 03/03.
 */
function validateDate(value: string): Validation {
  const parts = DATE_PATTERN.exec(value);
  if (!parts) return { ok: false, message: copy.INVALID_DATE };

  const day = Number(parts[1]);
  const month = Number(parts[2]);
  const year = Number(parts[3]);

  const date = new Date(Date.UTC(year, month - 1, day));
  const isReal =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!isReal) return { ok: false, message: copy.INVALID_DATE };

  const currentYear = new Date().getUTCFullYear();
  if (year < currentYear - 100 || year > currentYear - 18) {
    return { ok: false, message: copy.INVALID_DATE };
  }

  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { ok: true, value: iso };
}

/**
 * Only reached when a user types instead of tapping. `married` is rejected with
 * its own message because "pick from the list" would be a confusing answer to
 * someone who is, in fact, married — see `candidates.repo.ts:9`.
 */
function validateChoice(field: FormField, value: string): Validation {
  if (
    field.id === "marital_status" &&
    value.toLowerCase().replace(/[\s_-]/g, "") === "married"
  ) {
    return { ok: false, message: copy.MARRIED_NOT_ELIGIBLE };
  }
  return { ok: false, message: copy.INVALID_CHOICE };
}

/**
 * Cross-field check applied after `validate` passes.
 *
 * Only `age_max` has one today. Kept separate from `validate` so single-field
 * rules stay independent of profile state.
 */
export function crossValidate(
  field: FormField,
  value: string,
  answers: Answers,
): Validation {
  if (field.id !== "age_max") return { ok: true, value };

  const min = answers["age_min"];
  if (min === undefined || !/^\d+$/.test(min)) return { ok: true, value };

  return Number(value) < Number(min)
    ? { ok: false, message: copy.AGE_RANGE_INVERTED }
    : { ok: true, value };
}
