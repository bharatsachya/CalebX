/**
 * Image → page regions → card regions → text-line bands.
 *
 * Everything here is geometry, driven by projection profiles over pixel
 * darkness. None of it recognises a character, which is why it holds up at any
 * input resolution while recognition does not (see `quality.ts`).
 *
 * The layout is rigid and was verified against the source images: each booklet
 * page opens and closes with a full-width dark band (the maroon masthead and the
 * page-number footer), and holds a 2 x 3 grid of cards. Two booklet pages are
 * stacked in each WhatsApp image, so band positions come out as a consistent
 * header/footer/header/footer sequence.
 */

import sharp from "sharp";
import type { Box, CardRegion, PageRegion } from "./types.ts";

/** Pixels below this are "ink". Chosen well above the maroon bands' luminance. */
const INK = 110;
/** A row is part of a band when this fraction of it is ink. */
const BAND_COVERAGE = 0.7;
/** Bands thinner than this are rules or borders, not mastheads. */
const MIN_BAND_ROWS = 8;

/** A page's cards are laid out in this grid. Fixed by the printed format. */
export const CARD_COLUMNS = 2;
export const CARD_ROWS = 3;

/**
 * Fraction of a card's width occupied by the portrait, measured from the right.
 *
 * The photo must be excluded before OCR. Left in, it does not merely add noise —
 * Tesseract's layout analysis treats it as a block and silently drops the text
 * lines beside it. In the spike that cost the `स्थान` and `गोत्र` lines outright.
 */
const PHOTO_FRACTION = 0.34;

export interface GrayImage {
  data: Buffer;
  width: number;
  height: number;
}

/** Loads an image as raw 8-bit grayscale, the form every profile here needs. */
export async function loadGray(path: string): Promise<GrayImage> {
  const { data, info } = await sharp(path)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Fraction of each row that is ink, for rows within `box`. */
function rowInkProfile(image: GrayImage, box: Box): number[] {
  const profile: number[] = [];
  for (let y = box.top; y < box.top + box.height; y++) {
    let ink = 0;
    for (let x = box.left; x < box.left + box.width; x++) {
      if (image.data[y * image.width + x]! < INK) ink++;
    }
    profile.push(ink / box.width);
  }
  return profile;
}

/** Start row of every full-width dark band, top to bottom. */
function findBands(image: GrayImage): number[] {
  const profile = rowInkProfile(image, {
    left: 0,
    top: 0,
    width: image.width,
    height: image.height,
  });
  const bands: number[] = [];
  let run = 0;
  profile.forEach((coverage, y) => {
    if (coverage > BAND_COVERAGE) {
      run++;
      if (run === MIN_BAND_ROWS) bands.push(y - (MIN_BAND_ROWS - 1));
    } else {
      run = 0;
    }
  });
  return bands;
}

/**
 * The booklet pages stacked inside one source image.
 *
 * Bands alternate masthead, footer, masthead, footer — so pages are consecutive
 * pairs. An odd trailing band is a page whose footer was cropped off; it is
 * dropped rather than guessed at, because a half-page yields half-cards and a
 * half-card is indistinguishable from a badly-read one downstream.
 */
export function findPages(image: GrayImage): PageRegion[] {
  const bands = findBands(image);
  const pages: PageRegion[] = [];

  for (let i = 0; i + 1 < bands.length; i += 2) {
    const top = bands[i]!;
    const bottom = bands[i + 1]!;
    if (bottom - top < image.height / 8) continue; // a rule pair, not a page
    pages.push({
      index: pages.length + 1,
      box: { left: 0, top, width: image.width, height: bottom - top },
    });
  }
  return pages;
}

/** A run of rows with essentially no ink. */
interface Gap {
  start: number;
  end: number;
}

/** Blank horizontal runs of at least `minRows`, in page-relative coordinates. */
function findGaps(profile: number[], minRows: number): Gap[] {
  const gaps: Gap[] = [];
  let start = -1;
  profile.forEach((coverage, y) => {
    if (coverage < 0.005 && start === -1) {
      start = y;
    } else if (coverage >= 0.005 && start !== -1) {
      if (y - start >= minRows) gaps.push({ start, end: y });
      start = -1;
    }
  });
  if (start !== -1 && profile.length - start >= minRows) {
    gaps.push({ start, end: profile.length });
  }
  return gaps;
}

/**
 * The row bands of a page's card grid, found from the printed gutters.
 *
 * Dividing the page into three equal parts looks reasonable and is wrong: the
 * masthead is a fixed ~9px rather than a fixed *fraction*, so an assumed
 * percentage shifts every row down. On the source images a 6% assumption put the
 * first band 17px late and 36px long — which clipped each card's unlabelled name
 * line and pulled in the name of the card below. The model then dutifully
 * reported the wrong person's name against the right person's data, which is the
 * worst failure this pipeline can produce and the hardest to notice.
 *
 * The gutters between card rows are the widest blank runs on the page, so they
 * are measured instead of assumed. Falls back to equal division when the page is
 * too degraded to show them.
 */
function findRowBands(
  image: GrayImage,
  page: PageRegion,
): Array<{ top: number; height: number }> {
  const { top, height } = page.box;
  const profile = rowInkProfile(image, page.box);

  // The masthead is the leading run of heavy ink.
  let masthead = 0;
  while (masthead < profile.length && profile[masthead]! > 0.5) masthead++;

  const gaps = findGaps(profile.slice(masthead), 4).map((gap) => ({
    start: gap.start + masthead,
    end: gap.end + masthead,
  }));

  // Content starts after the gap that follows the masthead.
  const contentTop =
    gaps.length > 0 && gaps[0]!.start <= masthead + 8 ? gaps[0]!.end : masthead;

  // The row separators are the widest remaining gaps — CARD_ROWS - 1 of them.
  const separators = gaps
    .filter((gap) => gap.start > contentTop)
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, CARD_ROWS - 1)
    .sort((a, b) => a.start - b.start);

  if (separators.length !== CARD_ROWS - 1) {
    const bandHeight = Math.floor((height - contentTop) / CARD_ROWS);
    return Array.from({ length: CARD_ROWS }, (_, row) => ({
      top: top + contentTop + row * bandHeight,
      height: bandHeight,
    }));
  }

  const edges = [
    contentTop,
    ...separators.flatMap((s) => [s.start, s.end]),
    height,
  ];
  const bands: Array<{ top: number; height: number }> = [];
  for (let i = 0; i < edges.length; i += 2) {
    bands.push({ top: top + edges[i]!, height: edges[i + 1]! - edges[i]! });
  }
  return bands;
}

/** The 2 x 3 card grid within a page, in reading order. */
export function findCards(image: GrayImage, page: PageRegion): CardRegion[] {
  const { left, width } = page.box;
  const cardWidth = Math.floor(width / CARD_COLUMNS);
  const cards: CardRegion[] = [];

  for (const band of findRowBands(image, page)) {
    for (let column = 0; column < CARD_COLUMNS; column++) {
      const box: Box = {
        left: left + column * cardWidth,
        top: band.top,
        width: cardWidth,
        height: band.height,
      };
      cards.push({
        page: page.index,
        index: cards.length,
        box,
        textBox: {
          ...box,
          width: Math.round(box.width * (1 - PHOTO_FRACTION)),
        },
      });
    }
  }
  return cards;
}

/**
 * Text-line bands within a region, top to bottom.
 *
 * Devanagari hangs from a shirorekha, so a printed line reads as one dense run
 * of ink rows with clean gaps between lines — the profile separates lines far
 * more reliably than it separates characters, which is exactly the property this
 * pipeline leans on.
 */
export function findLines(
  image: GrayImage,
  box: Box,
  minRows = 3,
): Array<{ top: number; height: number }> {
  const profile = rowInkProfile(image, box);
  const lines: Array<{ top: number; height: number }> = [];
  let start = -1;

  profile.forEach((coverage, offset) => {
    const hasInk = coverage > 0.01;
    if (hasInk && start === -1) {
      start = offset;
    } else if (!hasInk && start !== -1) {
      if (offset - start >= minRows) {
        lines.push({ top: box.top + start, height: offset - start });
      }
      start = -1;
    }
  });

  if (start !== -1 && profile.length - start >= minRows) {
    lines.push({ top: box.top + start, height: profile.length - start });
  }
  return lines;
}
