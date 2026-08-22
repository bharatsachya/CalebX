/**
 * Types for the card-booklet (image) importer.
 *
 * A different printed format from the ruled table in `../types.ts`: the
 * Khandelwal Parichay Sammelan booklets lay each person out as a *card* — a
 * photo, an entry number, and a column of `label : value` lines in Devanagari.
 *
 * That difference is what makes this pipeline label-driven rather than
 * anchor-driven. The PDF parser has to infer columns from content because the
 * table prints no labels; here every field announces itself (`गोत्र :`), so the
 * gotra vocabulary is only a *validator*, never a parsing anchor.
 */

/** Fields a card can carry, in printed order. */
export const CARD_FIELDS = [
  "entry_no",
  "name",
  "dob",
  "birth_time",
  "birth_place",
  "gotra",
  "education",
  "height",
  "weight",
  "occupation",
  "annual_income",
  "work_place",
  "siblings",
  "father_name",
  "mother_name",
  "father_occupation",
  "father_income",
  "address",
  "phone",
  "phone_alt",
  "maternal_gotra",
] as const;

export type CardFieldId = (typeof CARD_FIELDS)[number];

/** A card's values, still as OCR'd strings. Normalisation happens later. */
export type CardRow = Partial<Record<CardFieldId, string>>;

/** A rectangle in image pixel space. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One booklet page found inside a source image. */
export interface PageRegion {
  /** 1-based position within the image, not the printed page number. */
  index: number;
  box: Box;
}

/** One card, located but not yet read. */
export interface CardRegion {
  page: number;
  /** 0-based position within the page, reading order: left-right, top-down. */
  index: number;
  box: Box;
  /** Text column only — the photo excluded. See `geometry.ts`. */
  textBox: Box;
}

/**
 * A card that was read, with provenance and every doubt recorded.
 *
 * `issues` is never thrown away and `confidence` is never discarded: unlike the
 * PDF pipeline, where every character written to the sheet was *copied* out of a
 * text layer, every character here was *guessed* by a recogniser. The row
 * carries that distinction downstream so nothing can mistake it for verified.
 */
export interface ParsedCard {
  raw: CardRow;
  /** Source image path, so a reviewer can open the original. */
  sourceImage: string;
  page: number;
  index: number;
  issues: string[];
  /** Mean Tesseract confidence across the card's lines, 0..100. */
  confidence: number;
}
