export { readPdf, type PdfPage } from "./pdf.ts";
export { parsePages, parseRow, groupIntoRows } from "./parse.ts";
export {
  mapRow,
  EXTRA_CANDIDATE_COLUMNS,
  type MappedRow,
  type Cells,
} from "./candidate.ts";
export {
  dobToIso,
  heightToCm,
  genderFromSource,
  sourceSlug,
} from "./normalize.ts";
export { canonicalGotra, isGotra } from "./gotra.ts";
export { ensureHeader, upsert } from "./upsert.ts";
export * from "./types.ts";

// ── image (card-booklet) pipeline ────────────────────────────────────
export {
  loadGray,
  findPages,
  findCards,
  findLines,
  type GrayImage,
} from "./image/geometry.ts";
export {
  assessQuality,
  RESOLUTION_ADVICE,
  MIN_LINE_HEIGHT,
  GOOD_LINE_HEIGHT,
  THRESHOLDS,
  type Thresholds,
  type QualityReport,
} from "./image/quality.ts";
export { matchLabel, similarity, LABELS, LINE_ORDER } from "./image/labels.ts";
export { CardReader, type OcrLine } from "./image/ocr.ts";
export { readCard, splitPairs } from "./image/card.ts";
export {
  VisionReader,
  parseReply,
  DEFAULT_VISION_MODEL,
  DEFAULT_MIN_INTERVAL_MS,
  type VisionOptions,
} from "./image/vision.ts";
export {
  validateCard,
  reconcile,
  isEmptyValue,
  digitsOf,
  NUMERIC_FIELDS,
} from "./image/validate.ts";
export { mapCard, EXTRA_CARD_COLUMNS, type Gender } from "./candidate.card.ts";
export * from "./image/types.ts";
