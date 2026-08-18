/**
 * Turning printed strings into the value shapes the Candidates sheet expects.
 *
 * The form's own columns are typed — `dob` is a date, `height` is an integer in
 * centimetres (`fields.candidates.ts`) — because a later Postgres import reads
 * them straight into typed columns. A booklet prints neither: dates are
 * `dd-mm-yyyy` and heights are feet-and-inches. Converting here, at the boundary,
 * keeps every downstream reader (the sheet, a future import) seeing one format.
 *
 * Every function returns null rather than guessing when the input is malformed,
 * and the caller records that as a review flag — a wrong height is worse than a
 * blank one, because nobody re-checks a cell that looks plausible.
 */

/** `dd-mm-yyyy` (or with `.`/`/` separators) → ISO `yyyy-mm-dd`, or null. */
export function dobToIso(printed: string): string | null {
  const match = printed.trim().match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1940 || year > 2010) return null; // a marriage directory, not a birth register

  // Reject impossible days (31 Feb) by round-tripping through Date.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

const FEET_INCHES = /^(\d)\s*'\s*(\d{1,2})?/;

/**
 * Feet-and-inches (`5'6"`, `5'`, `4'10''`) → centimetres, rounded, or null.
 *
 * Clamped to the form's own `120..230` bound so a mis-read like `8'` becomes a
 * flag rather than a value no human is that tall.
 */
export function heightToCm(printed: string): number | null {
  const match = printed.trim().match(FEET_INCHES);
  if (!match) return null;

  const feet = Number(match[1]);
  const inches = match[2] ? Number(match[2]) : 0;
  if (inches > 11) return null;

  const cm = Math.round(feet * 30.48 + inches * 2.54);
  return cm >= 120 && cm <= 230 ? cm : null;
}

/** Girls booklet → female, Boys booklet → male. The only signal we have. */
export function genderFromSource(sourceName: string): "male" | "female" | null {
  const lower = sourceName.toLowerCase();
  if (lower.includes("girl")) return "female";
  if (lower.includes("boy")) return "male";
  return null;
}

/** `"Final Girls.pdf"` → `"final-girls"`, for a stable, readable id namespace. */
export function sourceSlug(sourceName: string): string {
  return sourceName
    .replace(/\.pdf$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
