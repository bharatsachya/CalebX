/**
 * Tesseract, wrapped so the rest of the pipeline never touches it directly.
 *
 * Two recognisers, deliberately:
 *
 *   - `hin+eng` for prose — names, places, gotra, occupations. The booklet mixes
 *     scripts inside one field (`शिक्षा : B.Com, UPSC Pursuing`), so neither
 *     language alone reads a card.
 *   - `eng` with a digit whitelist for numerics. Dates, phones and incomes are
 *     printed in Latin numerals, and constraining the alphabet stops the
 *     recogniser resolving a smudged digit into Devanagari.
 *
 * Recognition runs per *line*, not per card. Tesseract's page-layout analysis is
 * the wrong tool once geometry has already located the lines, and on a dense
 * card it merges neighbours — in the spike, whole-card mode silently swallowed
 * two fields.
 *
 * Every line is upscaled so its printed height lands near `TARGET_LINE_HEIGHT`.
 * That is a legibility floor for the recogniser, not a quality fix: upscaling
 * interpolates, it does not restore. `quality.ts` is what guards quality.
 */

import { dataPath } from "@calebx/config";
import sharp from "sharp";
import { createWorker, type Worker } from "tesseract.js";
import type { Box } from "./types.ts";

/**
 * Where the language models are cached.
 *
 * Tesseract fetches them on first use and, left to itself, writes them into
 * whatever the cwd happens to be — which for `bun --cwd packages/directory-import`
 * is the package directory. Pinning it to the repo's gitignored `.data/` keeps
 * 6.6MB of model out of the source tree and shares one copy across runs.
 */
const CACHE_PATH = dataPath("tessdata");

/** Line height, in pixels, that Tesseract is happiest with. */
const TARGET_LINE_HEIGHT = 40;
/** Never upscale beyond this — past it, interpolation only adds smear. */
const MAX_SCALE = 8;
/** Pixels of padding around a line, so ascenders are not clipped. */
const PAD = 2;

export interface OcrLine {
  text: string;
  /** Tesseract's own 0..100 confidence. Carried through to the sheet. */
  confidence: number;
}

/** `7` = treat the image as a single text line. */
const PSM_SINGLE_LINE = "7";

async function prepare(
  path: string,
  box: Box,
  imageHeight: number,
): Promise<Buffer> {
  const top = Math.max(0, box.top - PAD);
  const height = Math.min(imageHeight - top, box.height + PAD * 2);
  const scale = Math.min(MAX_SCALE, Math.max(2, TARGET_LINE_HEIGHT / height));

  return sharp(path)
    .extract({ left: box.left, top, width: box.width, height })
    .resize({ width: Math.round(box.width * scale), kernel: "lanczos3" })
    .grayscale()
    .normalise()
    .toBuffer();
}

/**
 * Holds both Tesseract workers open across an import.
 *
 * Worker startup dominates per-line cost, so creating one per line would make a
 * booklet take hours. Always `close()` — the workers are child processes and
 * outlive the script otherwise.
 */
export class CardReader {
  private constructor(
    private readonly prose: Worker,
    private readonly digits: Worker,
  ) {}

  static async create(): Promise<CardReader> {
    const [prose, digits] = await Promise.all([
      createWorker(["hin", "eng"], undefined, { cachePath: CACHE_PATH }),
      createWorker("eng", undefined, { cachePath: CACHE_PATH }),
    ]);
    await prose.setParameters({
      tessedit_pageseg_mode: PSM_SINGLE_LINE as never,
    });
    await digits.setParameters({
      tessedit_pageseg_mode: PSM_SINGLE_LINE as never,
      tessedit_char_whitelist: "0123456789-/.,",
    });
    return new CardReader(prose, digits);
  }

  /** Reads a line as mixed Devanagari/Latin prose. */
  async readProse(
    path: string,
    box: Box,
    imageHeight: number,
  ): Promise<OcrLine> {
    const buffer = await prepare(path, box, imageHeight);
    const { data } = await this.prose.recognize(buffer);
    return { text: data.text.trim(), confidence: data.confidence };
  }

  /**
   * Reads a region as digits only.
   *
   * Used as a second opinion on numeric fields: where this and the prose pass
   * disagree on a phone number or a date, the value is flagged rather than
   * arbitrated. Two recognisers producing two different answers is exactly the
   * signal that neither can be trusted.
   */
  async readDigits(
    path: string,
    box: Box,
    imageHeight: number,
  ): Promise<OcrLine> {
    const buffer = await prepare(path, box, imageHeight);
    const { data } = await this.digits.recognize(buffer);
    return { text: data.text.trim(), confidence: data.confidence };
  }

  async close(): Promise<void> {
    await Promise.all([this.prose.terminate(), this.digits.terminate()]);
  }
}
