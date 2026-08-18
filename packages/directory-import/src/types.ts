/**
 * Types for the directory importer.
 *
 * A "directory" here is a printed community biodata booklet — the Agrawal
 * Parichay Sammelan PDFs — laid out as one ruled table with a fixed set of
 * columns. These people never used the bot and never consented to anything, so
 * everything downstream treats them as a colder record than a `tg:` candidate.
 */

/** One text run from the PDF, with the geometry needed to rebuild the table. */
export interface TextItem {
  /** Left edge, PDF user space. */
  x: number;
  /** Baseline y. Larger is further up the page. */
  y: number;
  /** Advance width of the run. */
  width: number;
  text: string;
}

/** The table's logical columns, in printed order. Identical in all three PDFs. */
export const COLUMNS = [
  "sr_no",
  "name",
  "dob",
  "birth_time",
  "birth_place",
  "gotra",
  "education",
  "occupation",
  "height",
  "contact",
] as const;

export type ColumnId = (typeof COLUMNS)[number];

/** A parsed table row, still as printed strings. Normalisation happens later. */
export type RawRow = Partial<Record<ColumnId, string>>;

/**
 * A row that survived parsing, with provenance.
 *
 * `issues` is never thrown away: an unparseable height or a missing gotra is
 * written to the sheet alongside the row rather than dropping the person, so a
 * booklet typo costs you one cell to fix by hand instead of a silent omission.
 */
export interface ParsedRow {
  raw: RawRow;
  page: number;
  issues: string[];
}
