/**
 * Rules every recognised card must survive, whichever engine read it.
 *
 * Deliberately shared between the Tesseract and vision readers. The engines fail
 * in different ways — Tesseract garbles glyphs, a vision model invents fluent
 * plausible text — but the guarantee the sheet needs is the same either way, and
 * a rule that lived in only one reader would be a hole in the other.
 *
 * Everything here *drops* a bad value and records why. Nothing repairs one: a
 * repaired value is a guess wearing the costume of a fact.
 */

import type { CardRow } from "./types.ts";

/** An Indian mobile number: ten digits, first one 6-9. */
const MOBILE = /^[6-9]\d{9}$/;

/** Keeps only digits — for comparing two readings of the same number. */
export const digitsOf = (text: string): string => text.replace(/\D/g, "");

/**
 * Values a recogniser emits when it means "nothing here".
 *
 * A vision model asked for JSON will happily write the string `"null"`, `"N/A"`
 * or `"-"` into a field rather than emit a JSON null, and any of those would
 * otherwise reach the spreadsheet as a person's occupation.
 */
const EMPTY = new Set([
  "",
  "-",
  "--",
  "null",
  "nil",
  "none",
  "n/a",
  "na",
  "unknown",
  "unreadable",
  "not readable",
  "not visible",
  "blank",
]);

export function isEmptyValue(value: string): boolean {
  return EMPTY.has(value.trim().toLowerCase());
}

/**
 * Drops values that cannot be right, appending the reason to `issues`.
 *
 * Mutates `raw` in place — the caller owns it and has nothing else to do with a
 * rejected value but forget it.
 */
export function validateCard(raw: CardRow, issues: string[]): void {
  for (const [field, value] of Object.entries(raw)) {
    if (value !== undefined && isEmptyValue(value)) {
      delete raw[field as keyof CardRow];
    }
  }

  for (const field of ["phone", "phone_alt"] as const) {
    const value = raw[field];
    if (value === undefined) continue;
    const digits = digitsOf(value);
    if (MOBILE.test(digits)) {
      raw[field] = digits;
    } else {
      issues.push(`${field} "${value}" is not a 10-digit mobile — dropped`);
      delete raw[field];
    }
  }

  if (raw.name !== undefined && raw.name.trim().length < 3) {
    issues.push(`name "${raw.name}" too short to be real — dropped`);
    delete raw.name;
  }

  // A 4-digit printed serial. Anything else means the badge was misread, and a
  // wrong entry number silently overwrites a different person on re-import.
  if (raw.entry_no !== undefined) {
    const digits = digitsOf(raw.entry_no);
    if (digits.length < 3 || digits.length > 5) {
      issues.push(`entry number "${raw.entry_no}" implausible — dropped`);
      delete raw.entry_no;
    } else {
      raw.entry_no = digits;
    }
  }
}

/**
 * Fields printed in Latin numerals — the ones worth reading twice.
 *
 * These carry the risk the rest of the card does not. A garbled name is
 * self-evidently garbled; a garbled phone number looks exactly like a phone
 * number.
 */
export const NUMERIC_FIELDS: ReadonlySet<keyof CardRow> = new Set([
  "dob",
  "phone",
  "phone_alt",
  "weight",
  "annual_income",
  "father_income",
  "entry_no",
]);

/**
 * Keeps only the numeric fields two independent readings agree on.
 *
 * Disagreement is recorded and the value dropped, never arbitrated — picking a
 * winner between two guesses yields a third guess with false confidence.
 */
export function reconcile(
  first: CardRow,
  second: CardRow,
  issues: string[],
): CardRow {
  const merged: CardRow = { ...first };

  for (const field of NUMERIC_FIELDS) {
    const a = first[field];
    if (a === undefined) continue;
    const b = second[field];

    if (b === undefined) {
      issues.push(`${field}: only one pass read it ("${a}") — dropped`);
      delete merged[field];
      continue;
    }
    if (digitsOf(a) !== digitsOf(b)) {
      issues.push(`${field}: passes disagree ("${a}" vs "${b}") — dropped`);
      delete merged[field];
    }
  }
  return merged;
}
