/**
 * Located card → `ParsedCard`.
 *
 * The card is read line by line, each line split into `label : value` pairs, and
 * each label resolved through `labels.ts`. Numeric fields are then read a second
 * time by the digit recogniser and the two answers compared: agreement is kept,
 * disagreement is recorded as an issue and the value dropped. Arbitrating
 * between two recognisers that disagree would just be picking a guess, and the
 * whole point of this file is to never write a guess into the sheet.
 */

import { findLines, type GrayImage } from "./geometry.ts";
import { LINE_ORDER, matchLabel, SEPARATORS } from "./labels.ts";
import type { CardReader } from "./ocr.ts";
import { digitsOf, NUMERIC_FIELDS, validateCard } from "./validate.ts";
import type { Box, CardFieldId, CardRegion, ParsedCard } from "./types.ts";

/**
 * Splits `label : value  label : value` into pairs.
 *
 * After splitting on the separator, an interior segment holds one field's value
 * followed by the next field's label. The boundary is found by testing
 * progressively longer tails against the label vocabulary — the longest tail
 * that resolves to a field is the next label.
 */
export function splitPairs(
  line: string,
  expected: readonly CardFieldId[],
): Array<{ label: string; value: string }> {
  const segments = line
    .split(SEPARATORS)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");
  if (segments.length < 2) return [];

  const pairs: Array<{ label: string; value: string }> = [];
  let label = segments[0]!;

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i]!;
    const isLast = i === segments.length - 1;

    if (isLast) {
      pairs.push({ label, value: segment });
      break;
    }

    const words = segment.split(/\s+/);
    let boundary = words.length; // no next label found → whole segment is value
    for (let take = 1; take <= Math.min(2, words.length - 1); take++) {
      const tail = words.slice(words.length - take).join(" ");
      if (matchLabel(tail, expected) !== null) boundary = words.length - take;
    }

    pairs.push({ label, value: words.slice(0, boundary).join(" ") });
    label = words.slice(boundary).join(" ");
  }
  return pairs;
}

async function readEntryNumber(
  reader: CardReader,
  path: string,
  card: CardRegion,
  imageHeight: number,
): Promise<string | null> {
  // The entry badge is printed white-on-dark at the card's top right, above the
  // portrait. Inverted, so the digit pass sees dark text on light as it expects.
  const badge: Box = {
    left: card.box.left + Math.round(card.box.width * 0.6),
    top: card.box.top,
    width: Math.round(card.box.width * 0.4),
    height: Math.round(card.box.height * 0.11),
  };
  const { text } = await reader.readDigits(path, badge, imageHeight);
  const digits = digitsOf(text);
  return digits.length >= 3 ? digits.slice(-4) : null;
}

export async function readCard(
  reader: CardReader,
  image: GrayImage,
  path: string,
  card: CardRegion,
): Promise<ParsedCard> {
  const raw: Record<string, string> = {};
  const issues: string[] = [];
  const confidences: number[] = [];

  const lines = findLines(image, card.textBox);
  if (lines.length === 0) {
    return {
      raw: {},
      sourceImage: path,
      page: card.page,
      index: card.index,
      issues: ["no text lines found in card"],
      confidence: 0,
    };
  }

  for (const [position, line] of lines.entries()) {
    const box: Box = {
      left: card.textBox.left,
      top: line.top,
      width: card.textBox.width,
      height: line.height,
    };
    const expected = LINE_ORDER[position] ?? [];
    const { text, confidence } = await reader.readProse(
      path,
      box,
      image.height,
    );
    confidences.push(confidence);
    if (text === "") continue;

    // The first line is the person's name, printed without a label.
    if (position === 0) {
      raw.name = text;
      continue;
    }

    const pairs = splitPairs(text, expected);
    if (pairs.length === 0) {
      // A line whose separator was lost still contributes, if position is
      // unambiguous and the line carries exactly one field.
      if (expected.length === 1) raw[expected[0]!] = text;
      else issues.push(`line ${position}: no label found in "${text}"`);
      continue;
    }

    for (const { label, value } of pairs) {
      const field = matchLabel(label, expected);
      if (field === null) {
        issues.push(`line ${position}: unrecognised label "${label}"`);
        continue;
      }
      if (value.trim() === "") continue;

      if (NUMERIC_FIELDS.has(field)) {
        const second = await reader.readDigits(path, box, image.height);
        const fromProse = digitsOf(value);
        // The digit pass reads the whole line, so it holds every numeral on it;
        // agreement means the prose reading appears there intact.
        if (fromProse !== "" && digitsOf(second.text).includes(fromProse)) {
          raw[field] = value.trim();
        } else {
          issues.push(
            `${field}: recognisers disagree ("${value.trim()}" vs ` +
              `"${second.text.trim()}") — dropped`,
          );
        }
        continue;
      }

      raw[field] = value.trim();
    }
  }

  const entryNo = await readEntryNumber(reader, path, card, image.height);
  if (entryNo) raw.entry_no = entryNo;
  else issues.push("entry number unreadable");

  validateCard(raw, issues);

  return {
    raw,
    sourceImage: path,
    page: card.page,
    index: card.index,
    issues,
    confidence:
      confidences.length === 0
        ? 0
        : confidences.reduce((sum, n) => sum + n, 0) / confidences.length,
  };
}
