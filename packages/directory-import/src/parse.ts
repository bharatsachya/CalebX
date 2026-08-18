/**
 * Positioned text runs → table rows.
 *
 * The approach is anchor-based rather than geometric. Three things pushed it
 * there, all discovered by reading the actual files:
 *
 *   1. The header row differs per booklet. The Girls file emits all ten labels;
 *      the Boys files merge "Date of Birth Birth Time" into one run and omit
 *      "Name" and "Eduation" altogether. Column boundaries derived from header
 *      positions therefore do not transfer between files.
 *   2. Alignment is mixed. Sr.No, dates, gotra, height and phone are centred in
 *      their cells; name and education are left-aligned. No single rule of
 *      "assign by left edge" or "assign by centre" places every cell correctly.
 *   3. The printed rules are drawn inconsistently — the three files emit 43, 28
 *      and 51 vertical segments respectively, in a different coordinate space
 *      from the text.
 *
 * What is stable is the *content*: a date is `dd-mm-yyyy`, a birth time is
 * `hh:mm`, a height is `5'6"`, a phone is ten digits, and a gotra is one of
 * eighteen known clan names. Those five anchors partition each row, and the
 * free-text columns are read out of the gaps between them.
 */

import { canonicalGotra } from "./gotra.ts";
import type { PdfPage } from "./pdf.ts";
import type { ParsedRow, RawRow, TextItem } from "./types.ts";

/** Runs whose baselines are within this many points are one printed row. */
const ROW_TOLERANCE = 4;

const DATE = /^\d{1,2}-\d{1,2}-\d{4}$/;
const TIME = /^\d{1,2}[:.]\d{2}$/;
/** `5'`, `5'6"`, `4'10''`, `5'3'’` — the booklets use several closing quotes. */
const HEIGHT = /^\d\s*'\s*(\d{1,2})?\s*(?:"|''|”|’’|’|″)?$/;
const PHONE = /^\d{10}$/;
const SR_NO = /^\d{1,4}$/;
/** A cell the booklet left blank. Not an error — the person has no value here. */
const DASH = /^[-–—]$/;

/** Groups runs into printed rows by baseline, each sorted left to right. */
export function groupIntoRows(items: TextItem[]): TextItem[][] {
  const rows: TextItem[][] = [];
  const baselines: number[] = [];

  for (const item of [...items].sort((a, b) => b.y - a.y)) {
    const index = baselines.findIndex(
      (baseline) => Math.abs(baseline - item.y) <= ROW_TOLERANCE,
    );
    if (index === -1) {
      baselines.push(item.y);
      rows.push([item]);
    } else {
      rows[index]!.push(item);
    }
  }

  for (const row of rows) row.sort((a, b) => a.x - b.x);
  return rows;
}

/** Joins runs into one cell value, collapsing the spacing pdfjs leaves behind. */
function join(items: TextItem[]): string {
  return items
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

function blank(value: string | undefined): boolean {
  return value === undefined || value === "" || DASH.test(value);
}

/**
 * Splits the run between gotra and height into education and occupation.
 *
 * These are the only two adjacent free-text columns, so there is no anchor
 * between them. The widest horizontal gap is the cell boundary: within a cell
 * pdfjs emits runs a few points apart, while the gutter between two cells is
 * tens of points. `headerSplit` — the centre of the "Occupation" label, which
 * every booklet does print — breaks ties when the run holds a single cell.
 */
function splitEducationOccupation(
  items: TextItem[],
  headerSplit: number | null,
): { education: TextItem[]; occupation: TextItem[] } {
  if (items.length === 0) return { education: [], occupation: [] };

  if (items.length === 1) {
    const only = items[0]!;
    const isOccupation =
      headerSplit !== null && only.x + only.width / 2 >= headerSplit;
    return isOccupation
      ? { education: [], occupation: items }
      : { education: items, occupation: [] };
  }

  let widestGap = -1;
  let cut = -1;
  for (let index = 0; index < items.length - 1; index++) {
    const gap = items[index + 1]!.x - (items[index]!.x + items[index]!.width);
    if (gap > widestGap) {
      widestGap = gap;
      cut = index + 1;
    }
  }

  // Runs inside one cell sit close together. If nothing is meaningfully far
  // apart, this is a single cell and the header decides which one it is.
  if (widestGap < 12) {
    const centre = items[0]!.x + items[items.length - 1]!.width / 2;
    const isOccupation = headerSplit !== null && centre >= headerSplit;
    return isOccupation
      ? { education: [], occupation: items }
      : { education: items, occupation: [] };
  }

  return { education: items.slice(0, cut), occupation: items.slice(cut) };
}

/** Centre of the "Occupation" header label, if this page prints one. */
export function occupationHeaderSplit(rows: TextItem[][]): number | null {
  for (const row of rows) {
    const label = row.find((item) => /^Occupation$/i.test(item.text));
    if (label) return label.x + label.width / 2 - 30;
  }
  return null;
}

/** True for the header row, the booklet title, and other non-data lines. */
function isTableRow(row: TextItem[]): boolean {
  const hasDate = row.some((item) => DATE.test(item.text));
  const hasPhone = row.some((item) => PHONE.test(item.text));
  return hasDate || hasPhone;
}

/**
 * Reads one printed row into named columns.
 *
 * Anchors are located first; everything left over is attributed to the
 * free-text column that sits in that gap. A missing anchor is recorded as an
 * issue and the columns that depended on it are left empty, so the row still
 * reaches the sheet with the fields that did parse.
 */
export function parseRow(
  row: TextItem[],
  page: number,
  headerSplit: number | null,
): ParsedRow {
  const raw: RawRow = {};
  const issues: string[] = [];

  const dateAt = row.findIndex((item) => DATE.test(item.text));
  const phoneAt = row.findIndex((item) => PHONE.test(item.text));
  const gotraAt = row.findIndex((item) => canonicalGotra(item.text) !== null);
  const heightAt = row.findIndex((item) => HEIGHT.test(item.text));

  if (dateAt !== -1) raw.dob = row[dateAt]!.text;
  else issues.push("no date of birth found");

  if (phoneAt !== -1) raw.contact = row[phoneAt]!.text;
  else issues.push("no contact number found");

  if (heightAt !== -1) raw.height = row[heightAt]!.text;

  if (gotraAt !== -1) raw.gotra = canonicalGotra(row[gotraAt]!.text)!;
  else issues.push("gotra not recognised");

  // Sr.No and name both sit left of the date.
  if (dateAt > 0) {
    const head = row.slice(0, dateAt);
    const first = head[0]!;
    if (SR_NO.test(first.text)) {
      raw.sr_no = first.text;
      raw.name = join(head.slice(1));
    } else {
      raw.name = join(head);
      issues.push("no serial number found");
    }
  }

  // Birth time is the run immediately after the date — but only when it looks
  // like a time. A row printing "-" there simply has no birth time recorded.
  const afterDate = dateAt === -1 ? -1 : dateAt + 1;
  let placeStart = afterDate;
  if (afterDate !== -1 && afterDate < row.length) {
    const candidate = row[afterDate]!;
    if (TIME.test(candidate.text)) {
      raw.birth_time = candidate.text.replace(".", ":");
      placeStart = afterDate + 1;
    } else if (DASH.test(candidate.text)) {
      placeStart = afterDate + 1;
    }
  }

  // Birth place fills the gap between birth time and gotra.
  if (placeStart !== -1 && gotraAt > placeStart) {
    raw.birth_place = join(row.slice(placeStart, gotraAt));
  }

  // Education and occupation share the gap between gotra and height/phone.
  const tailEnd =
    heightAt !== -1 ? heightAt : phoneAt !== -1 ? phoneAt : row.length;
  if (gotraAt !== -1 && tailEnd > gotraAt + 1) {
    const tail = row.slice(gotraAt + 1, tailEnd);
    const { education, occupation } = splitEducationOccupation(
      tail,
      headerSplit,
    );
    if (education.length) raw.education = join(education);
    if (occupation.length) raw.occupation = join(occupation);
  }

  // A dash means "not recorded", which is different from "we failed to read it".
  for (const key of Object.keys(raw) as (keyof RawRow)[]) {
    if (blank(raw[key])) delete raw[key];
  }

  if (raw.name === undefined) issues.push("no name found");

  return { raw, page, issues };
}

/** Every data row across every page. */
export function parsePages(pages: PdfPage[]): ParsedRow[] {
  const parsed: ParsedRow[] = [];

  for (const { page, items } of pages) {
    const rows = groupIntoRows(items);
    const headerSplit = occupationHeaderSplit(rows);
    for (const row of rows) {
      if (!isTableRow(row)) continue;
      parsed.push(parseRow(row, page, headerSplit));
    }
  }

  return parsed;
}
