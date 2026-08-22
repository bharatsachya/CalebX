/**
 * The resolution gate.
 *
 * This is the most important file in the image pipeline, and the reason the
 * pipeline is safe to point at a spreadsheet holding real people.
 *
 * Recognition quality is bounded by how many pixels a glyph occupies, and past
 * that bound a recogniser stops reading and starts guessing. The guesses are
 * *plausible* — a date comes back as `09-08-2000` instead of `09-08-2001`, a
 * house number as `903` instead of `103` — so nobody reviewing the sheet can
 * catch them. Upscaling does not help; it cannot restore detail that compression
 * already discarded.
 *
 * **The bound is not the same for both engines**, which was measured, not
 * assumed. On the same 6px-line-height source:
 *
 *   - Tesseract returned a different wrong date on every preprocessing variant
 *     and scored confidence 0 on its digit passes.
 *   - A vision model read the same card with every digit correct — date, entry
 *     number, weight, both incomes, and the house number Tesseract had mangled.
 *
 * The difference is language priors. A glyph classifier sees ~5px of ink and has
 * nothing else to go on; a model reads a partly-illegible date against a strong
 * prior about what dates look like. That is a real advantage and it is also the
 * failure mode — the same priors will happily invent a plausible phone number.
 * Hence two floors, and the two-pass consensus check in `vision.ts`.
 */

import { findLines, type GrayImage } from "./geometry.ts";
import type { CardRegion } from "./types.ts";

/** Which reader the source is being judged for. */
export type Engine = "tesseract" | "vision";

export interface Thresholds {
  /** Below this median printed line height, recognition is guesswork. */
  min: number;
  /** At or above this, recognition is dependable enough to be worth reviewing. */
  good: number;
}

/**
 * Per-engine floors, in source pixels of printed line height.
 *
 * Only the 6px point is measured (see the file header). The Tesseract numbers
 * come from its documented ~30px x-height preference, confirmed by that failure;
 * the vision floor sits just below the point where the model was observed to
 * read cleanly, and is deliberately not extrapolated further down — nobody has
 * checked what a model does at 3px, and the honest guess is that it invents.
 */
export const THRESHOLDS: Record<Engine, Thresholds> = {
  tesseract: { min: 20, good: 28 },
  vision: { min: 5, good: 10 },
};

/** Retained for callers that predate the per-engine split. */
export const MIN_LINE_HEIGHT = THRESHOLDS.tesseract.min;
export const GOOD_LINE_HEIGHT = THRESHOLDS.tesseract.good;

export interface QualityReport {
  /** Median text-line height across every card found, in source pixels. */
  medianLineHeight: number;
  cardsFound: number;
  verdict: "good" | "marginal" | "unusable";
  /** How much larger the source must be for dependable recognition. */
  requiredScale: number;
  summary: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export function assessQuality(
  image: GrayImage,
  cards: CardRegion[],
  engine: Engine = "tesseract",
): QualityReport {
  const { min, good } = THRESHOLDS[engine];
  const heights = cards.flatMap((card) =>
    findLines(image, card.textBox).map((line) => line.height),
  );

  const medianLineHeight = median(heights);
  const verdict =
    medianLineHeight >= good
      ? "good"
      : medianLineHeight >= min
        ? "marginal"
        : "unusable";

  const requiredScale =
    medianLineHeight > 0 ? Math.max(1, good / medianLineHeight) : Infinity;

  const px = `${medianLineHeight.toFixed(1)}px median line height`;
  const summary =
    verdict === "good"
      ? `${px} — dependable for ${engine}.`
      : verdict === "marginal"
        ? `${px} — readable by ${engine} but error-prone; check every numeric ` +
          `field against the booklet.`
        : `${px}, against the ${min}px minimum for ${engine}. It would return ` +
          `plausible-looking wrong values. Source needs to be about ` +
          `${requiredScale.toFixed(1)}x larger` +
          (engine === "tesseract"
            ? ", or try --engine vision, which reads lower resolutions."
            : ".");

  return {
    medianLineHeight,
    cardsFound: cards.length,
    verdict,
    requiredScale,
    summary,
  };
}

/** Advice printed when the gate rejects an image. Actionable, not scolding. */
export const RESOLUTION_ADVICE = [
  "Ways to get a usable source, best first:",
  "  1. The booklet as a PDF. It carries a real text layer, so `bun run import`",
  "     reads it with no OCR at all and no guessing — the same path the Agrawal",
  "     directory already uses.",
  "  2. Re-send the images through WhatsApp as *documents*, not photos.",
  "     Photos are recompressed on send; documents are not.",
  "  3. Re-scan or re-photograph the printed booklet, one page per image,",
  "     at 300dpi or better (a booklet page wants to be ~2200px tall).",
].join("\n");
