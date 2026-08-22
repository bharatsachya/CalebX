/**
 * The Devanagari label vocabulary, and how a garbled one is still recognised.
 *
 * Every value on a card is announced by a label (`गोत्र :`), which is what makes
 * this format tractable at all. But the recogniser garbles labels as readily as
 * values — `गोत्र` came back as `गौत`, `wh` and `ww` across three runs of the
 * same card — so an exact lookup would discard most of a page.
 *
 * Two signals recover it. Labels are matched *approximately*, by edit distance
 * against a canonical spelling plus the variants actually observed; and the
 * printed line order is fixed, so a line's position votes for its field when the
 * text does not. A label that neither signal resolves is left unassigned rather
 * than attached to a plausible neighbour — a value in the wrong column is worse
 * than a value that is missing, because only one of the two announces itself.
 */

import type { CardFieldId } from "./types.ts";

/** Separators the booklet prints as `:` and the recogniser renders variously. */
export const SEPARATORS = /[:：।।।«»+;,·।|]/;

interface LabelSpec {
  field: CardFieldId;
  /** Canonical printed spelling. */
  canonical: string;
  /** Spellings observed from the recogniser, including Latin mis-reads. */
  variants: readonly string[];
}

export const LABELS: readonly LabelSpec[] = [
  {
    field: "dob",
    canonical: "जन्म दि.",
    variants: ["जन्मदि", "अन्नदि", "जन्म", "अन्न", "मोवा"],
  },
  { field: "birth_time", canonical: "समय", variants: ["सम", "समय", "सनय"] },
  {
    field: "birth_place",
    canonical: "स्थान",
    variants: ["ल्थान", "स्थान", "स्थल"],
  },
  {
    field: "gotra",
    canonical: "गोत्र",
    variants: ["गौत", "गोत", "गौत्र", "wh", "ww", "गीत"],
  },
  {
    field: "education",
    canonical: "शिक्षा",
    variants: ["किया", "शिक्षा", "शिका", "por"],
  },
  {
    field: "height",
    canonical: "ऊंचाई",
    variants: ["ऊचाई", "उंचाई", "sad", "saf", "lend"],
  },
  { field: "weight", canonical: "वजन", variants: ["वजन", "बजन", "कजन"] },
  {
    field: "occupation",
    canonical: "कार्य",
    variants: ["कार्य", "कार्व", "ord", "ard", "rd"],
  },
  {
    field: "annual_income",
    canonical: "वा. आय",
    variants: ["वाआय", "वाआप", "थाआप", "वाजाय"],
  },
  {
    field: "work_place",
    canonical: "कार्य स्थल",
    variants: ["कार्यस्थल", "कार्यस्थन", "कार्यरथल"],
  },
  {
    field: "siblings",
    canonical: "बहन/भाई",
    variants: ["बहनभाई", "बहन", "भाई", "ty", "iee"],
  },
  {
    field: "father_name",
    canonical: "पिता",
    variants: ["पिता", "लिया", "पिना", "fmd"],
  },
  {
    field: "mother_name",
    canonical: "माता",
    variants: ["माता", "नाता", "मादा"],
  },
  { field: "father_income", canonical: "आय", variants: ["आय", "जाय", "आप"] },
  { field: "address", canonical: "पता", variants: ["पता", "पत", "पदा"] },
  {
    field: "phone",
    canonical: "दूरभाष",
    variants: ["दूरभाष", "दूरभाय", "दुरभाष", "sor", "wn"],
  },
  {
    field: "maternal_gotra",
    canonical: "मामा गोत्र",
    variants: ["मामागोत्र", "मामागौत", "मामागीत"],
  },
  {
    field: "entry_no",
    canonical: "प्रविष्टी क्रं.",
    variants: ["प्रविष्टीक्रं", "प्रविष्टी", "प्रविष्ट"],
  },
];

/**
 * The printed order of a card's lines. Used as a positional prior when the
 * label text is too degraded to match on its own.
 *
 * A line may carry two fields (`जन्म दि. : … समय : …`); both are listed, left
 * first. `null` marks the name line, which is printed without a label.
 */
export const LINE_ORDER: ReadonlyArray<readonly CardFieldId[] | null> = [
  null,
  ["dob", "birth_time"],
  ["birth_place", "gotra"],
  ["education"],
  ["height", "weight"],
  ["occupation"],
  ["annual_income"],
  ["work_place"],
  ["siblings"],
  ["father_name"],
  ["mother_name"],
  ["father_occupation", "father_income"],
  ["address"],
  ["phone"],
  ["maternal_gotra"],
];

/** Strips separators, spaces and Latin case so only glyph identity is compared. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s.,:।«»|+;·'"()\-–—]/g, "")
    .trim();
}

/** Levenshtein distance, iterative two-row form. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j++) {
      current.push(
        Math.min(
          previous[j + 1]! + 1,
          current[j]! + 1,
          previous[j]! + (a[i] === b[j] ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** 1.0 for identical, 0.0 for nothing in common. */
export function similarity(a: string, b: string): number {
  const left = fold(a);
  const right = fold(b);
  if (left === "" || right === "") return 0;
  const longest = Math.max(left.length, right.length);
  return 1 - editDistance(left, right) / longest;
}

/** Below this, a label is treated as unreadable rather than matched loosely. */
const MATCH_FLOOR = 0.55;

/**
 * Best field for a printed label, or null when nothing is close enough.
 *
 * `expected` is the positional prior: fields the printed order says belong on
 * this line. A candidate in that set wins ties, which is what rescues a label
 * degraded past recognition on a line whose position is unambiguous.
 */
export function matchLabel(
  label: string,
  expected: readonly CardFieldId[] = [],
): CardFieldId | null {
  let best: CardFieldId | null = null;
  let bestScore = MATCH_FLOOR;

  for (const spec of LABELS) {
    const score = Math.max(
      similarity(label, spec.canonical),
      ...spec.variants.map((variant) => similarity(label, variant)),
    );
    // A field the line's position already predicts needs less textual evidence.
    const adjusted = expected.includes(spec.field) ? score + 0.15 : score;
    if (adjusted > bestScore) {
      bestScore = adjusted;
      best = spec.field;
    }
  }
  return best;
}
