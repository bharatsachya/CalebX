# @calebx/directory-import — src

The pipeline, in order: `pdf` → `parse` → `candidate` → `cli`.

| File           | Responsibility                                                                              |
| -------------- | ------------------------------------------------------------------------------------------- |
| `types.ts`     | `TextItem`, `COLUMNS`, `RawRow`, `ParsedRow`. No logic.                                     |
| `pdf.ts`       | PDF → positioned text runs. The only file that touches pdfjs.                               |
| `gotra.ts`     | The eighteen-clan vocabulary and its spelling variants. Used as a parsing anchor.           |
| `parse.ts`     | Positioned runs → `ParsedRow`: group by baseline, locate anchors, read free text from gaps. |
| `normalize.ts` | Printed strings → the value shapes the sheet expects (ISO dates, centimetres, id slugs).    |
| `candidate.ts` | `ParsedRow` → the cells that land in `Candidates` and `Contacts`.                           |
| `cli.ts`       | `bun run import` — dry-run reporting, header widening, and the keyed upsert.                |
| `index.ts`     | Public surface, for tests and one-off scripts.                                              |

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
- **`cli.ts` upserts by `user_id` and merges over the existing row**, so a column
  you added by hand in the sheet survives a re-import.
