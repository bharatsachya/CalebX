# @calebx/directory-import — src

Two pipelines that converge on one writer.

```
PDF    →  pdf.ts   →  parse.ts        →  candidate.ts       ┐
                                                            ├→ upsert.ts → sheet
images →  image/*  →  image/card.ts   →  candidate.card.ts  ┘
```

**Shared**

| File           | Responsibility                                                                           |
| -------------- | ---------------------------------------------------------------------------------------- |
| `normalize.ts` | Printed strings → the value shapes the sheet expects (ISO dates, centimetres, id slugs). |
| `upsert.ts`    | Header widening and the `user_id`-keyed upsert. Used by both CLIs.                       |
| `index.ts`     | Public surface, for tests and one-off scripts.                                           |

**PDF path** (deterministic — characters are copied, never inferred)

| File           | Responsibility                                                                              |
| -------------- | ------------------------------------------------------------------------------------------- |
| `types.ts`     | `TextItem`, `COLUMNS`, `RawRow`, `ParsedRow`. No logic.                                     |
| `pdf.ts`       | PDF → positioned text runs. The only file that touches pdfjs.                               |
| `gotra.ts`     | The eighteen-clan vocabulary and its spelling variants. Used as a parsing anchor.           |
| `parse.ts`     | Positioned runs → `ParsedRow`: group by baseline, locate anchors, read free text from gaps. |
| `candidate.ts` | `ParsedRow` → the cells that land in `Candidates` and `Contacts`.                           |
| `cli.ts`       | `bun run import`.                                                                           |

**Image path** (probabilistic — every character is a recogniser's guess)

| File                | Responsibility                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `image/types.ts`    | `CARD_FIELDS`, `CardRow`, `CardRegion`, `ParsedCard`. No logic.                               |
| `image/geometry.ts` | Projection profiles: image → booklet pages → 2x3 card grid → text-line bands. No recognition. |
| `image/quality.ts`  | The resolution gate. Refuses input too small to read dependably.                              |
| `image/labels.ts`   | Devanagari label vocabulary, edit-distance matching, and the positional prior.                |
| `image/ocr.ts`      | The two Tesseract workers (`hin+eng` prose, `eng` digits-only). The only tesseract importer.  |
| `image/card.ts`     | **Tesseract reader.** Located card → `ParsedCard`: line splitting, label resolution.          |
| `image/vision.ts`   | **Vision reader.** Same seam, via OpenRouter: crop → JSON → `ParsedCard`. Two passes.         |
| `image/validate.ts` | Rules both readers must satisfy: empty-value strings, mobile format, two-pass reconciliation. |
| `candidate.card.ts` | `ParsedCard` → the cells that land in `Candidates` and `Contacts`.                            |
| `cli.images.ts`     | `bun run import:images`, and the `--engine` switch between the two readers.                   |

## Invariants

- **`pdf.ts` is the only pdfjs importer**, and it uses `legacy/build/pdf.mjs` —
  the default entry expects browser globals.
- **`parse.ts` knows nothing about sheets; `candidate.ts` knows nothing about
  PDFs.** The seam is `ParsedRow`. That is what lets the parser be tested against
  a booklet without any Google credentials.
- **Issues accumulate, they never abort.** `ParsedRow.issues` flows into
  `review_notes` and `needs_review`; a row with problems still reaches the sheet.
- **Normalisers return `null`, never a guess** (`dobToIso`, `heightToCm`). The
  caller turns null into a review flag.
- **Gotra matching is a closed vocabulary, case-insensitive, variant-tolerant.**
  A new spelling belongs in `GOTRA_VARIANTS`, not in a fuzzy matcher — anchor
  detection has to be exact or rows split in the wrong place.
- **`upsert.ts` merges over the existing row**, so a column you added by hand in
  the sheet survives a re-import from either pipeline.

### Image path only

- **`image/geometry.ts` recognises nothing.** It is pure projection-profile
  arithmetic, which is why it holds at any resolution while recognition does not.
  Keep it that way: it is the part that can be trusted.
- **Grid boundaries are measured, never assumed as a fraction of the page.** The
  masthead is a fixed ~9px, not a percentage; assuming 6% put every row band 17px
  low and 36px long, so each card lost its name line and inherited the name of the
  card below. A reader then attributes **the wrong person's name to the right
  person's data** — silent, and the worst thing this pipeline can emit. If the
  grid ever needs adjusting, adjust the gutter detection, not a constant.
- **`image/ocr.ts` is the only tesseract importer**, and it recognises one _line_
  at a time. Never hand Tesseract a whole card — its layout analysis merges
  neighbouring text and silently drops lines beside the portrait.
- **The photo is excluded before OCR**, via `CardRegion.textBox`.
- **Numeric fields must survive two recognisers.** On disagreement the value is
  dropped and the disagreement written to `review_notes`. Never arbitrate —
  choosing between two guesses produces a third guess. Both readers obey this:
  Tesseract cross-checks its prose pass against a digit-only pass, the vision
  reader calls the model twice and runs `reconcile`.
- **`validate.ts` is shared, and must stay shared.** The engines fail
  differently — Tesseract garbles, a vision model invents fluently — but the
  guarantee the sheet needs is identical. A rule living in only one reader is a
  hole in the other.
- **Both readers return `ParsedCard` and nothing else.** The mapper, the
  validators and the sheet writer are engine-blind; only `cli.images.ts` knows
  which one ran. Adding a third engine should touch no file downstream of the
  seam.
- **`needs_review` is `TRUE` on every image row, unconditionally**, unlike the PDF
  path where it signals a specific problem. A clean-looking OCR row is the
  dangerous case, not the safe one.
- **The gate in `image/quality.ts` is the last thing to weaken.** If a future
  change makes it advisory, this pipeline starts writing plausible fiction about
  real people into a spreadsheet nobody re-checks.
