# @calebx/directory-import

Printed community biodata booklets (the Agrawal Parichay Sammelan PDFs) into the
`Candidates` and `Contacts` tabs of the form spreadsheet.

One-shot CLI, not a runtime dependency of any bot. Nothing else imports it.

## Usage

```sh
bun run import "docs/Final Girls.pdf" "docs/Final Boys.pdf"     # dry run
bun run import "docs/Final Girls.pdf" --write                   # commit
```

Dry by default: it parses, maps, and prints what it _would_ write. A bad parse
is caught before it touches a sheet holding real people. `--write` commits.

Idempotent — every row's id is derived from its booklet and printed serial
(`dir:final-girls:12`), so re-running after fixing a booklet typo updates the
same rows instead of duplicating them.

Requires the same Google credentials as `@calebx/sheets`; see that package's
README.

## Why parsing is anchor-based

The obvious approach — derive column boundaries from the header row, or from the
printed rules — does not work on these files:

1. **The header differs per booklet.** The Girls file emits all ten labels; the
   Boys files merge "Date of Birth Birth Time" into one run and omit "Name" and
   "Eduation" entirely.
2. **Alignment is mixed.** Serial, dates, gotra, height and phone are centred;
   name and education are left-aligned. Neither "assign by left edge" nor
   "assign by centre" places every cell.
3. **The rules are drawn inconsistently** — 43, 28 and 51 vertical segments
   across the three files, in a different coordinate space from the text.

What is stable is the _content_. A date is `dd-mm-yyyy`, a birth time `hh:mm`, a
height `5'6"`, a phone ten digits, and a gotra one of eighteen known clan names.
Those five anchors partition each row; the free-text columns are read from the
gaps between them.

## Why not a vision model

The booklets carry a real text layer, so every character written to the sheet is
copied out of the file rather than inferred. A transposed digit in a phone number
is not recoverable by review — nobody can tell by looking that `9422890676`
should have been `9422890767`.

## Invariants

- **`consent_granted` is always `FALSE`.** These people never used the bot and
  agreed to nothing (CLAUDE.md §6.1). Anything downstream must treat a `dir:`
  record as colder than a `tg:` one.
- **Ids are namespaced `dir:`** so a booklet serial can never collide with a real
  candidate (CLAUDE.md rule 12).
- **Phone numbers go to `Contacts`, never `Candidates`** — the same split the bot
  itself makes.
- **A row is never dropped for being unparseable.** An unreadable height or an
  unrecognised gotra sets `needs_review = TRUE` and writes the reason to
  `review_notes`, so a booklet typo costs one cell to fix by hand instead of a
  silent omission.
- **Normalisers return null rather than guessing.** A wrong height is worse than
  a blank one, because nobody re-checks a cell that looks plausible.

## After an import

Filter `Candidates` on `needs_review = TRUE` and work through `review_notes`.
The common causes are a gotra spelled a new way (add the variant to `gotra.ts`)
and a date outside the 1940–2010 sanity window.

## Directory-only columns

Booklet columns map onto existing form fields where the concept matches (gotra →
`community`, feet-inches → the integer `height`). The rest are appended columns —
`birth_time`, `source`, `source_no`, `needs_review`, `review_notes`. The sheet
addresses columns by header name, so widening the tab does not disturb the bot.
