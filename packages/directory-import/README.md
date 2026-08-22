# @calebx/directory-import

Printed community biodata booklets into the `Candidates` and `Contacts` tabs of
the form spreadsheet.

Two pipelines, because there are two source formats:

| Source                                      | CLI             | Reads by                                   |
| ------------------------------------------- | --------------- | ------------------------------------------ |
| Agrawal Sammelan **PDFs** — one ruled table | `import`        | copying the PDF text layer                 |
| Khandelwal Sammelan **photographs** — cards | `import:images` | recognition (Tesseract, or a vision model) |

One-shot CLIs, not a runtime dependency of any bot. Nothing else imports them.

**Prefer the PDF path whenever a PDF exists.** It copies characters; the image
path guesses them. See [Trusting the image path](#trusting-the-image-path).

## Usage

```sh
bun run import "docs/Final Girls.pdf" "docs/Final Boys.pdf"     # dry run
bun run import "docs/Final Girls.pdf" --write                   # commit

bun run import:images page-*.jpg --gender female                # dry run
bun run import:images page-*.jpg --gender female --write        # commit
bun run import:images page-*.jpg --gender female --engine vision
```

`--gender` is required to record one: the card format prints gender in the
booklet masthead, not on the card, so the importer cannot infer it per person.
Omit it and the column is left blank.

### Choosing an engine

| Flag              | Reads with                 | Needs                |
| ----------------- | -------------------------- | -------------------- |
| _(default)_       | Tesseract `hin+eng`, local | nothing              |
| `--engine vision` | An OpenRouter vision model | `OPENROUTER_API_KEY` |

The vision model defaults to `google/gemma-4-26b-a4b-it:free`; override with
`--model <id>` or `OPENROUTER_VISION_MODEL`.

Two things to weigh before reaching for `--engine vision`:

- **Privacy.** The card crops carry photographs, phone numbers and home
  addresses of people who never consented. `--engine vision` sends them to a
  third party, and OpenRouter's `:free` endpoints generally permit the provider
  to train on what they receive. A paid endpoint with training disabled is the
  safer choice for real data; the Tesseract path sends nothing anywhere.
- **Fluency is not accuracy.** Tesseract garbles visibly — `= - बस` is obviously
  broken and a reviewer skips it. A vision model given four indistinct digits
  writes a well-formed invented phone number instead. That is why every card is
  read **twice** and only numerics both passes agree on are kept. `--no-consensus`
  halves the calls and removes that check; the CLI says so when you use it.

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

## Why the PDF path uses no model at all

The booklets carry a real text layer, so every character written to the sheet is
copied out of the file rather than inferred. A transposed digit in a phone number
is not recoverable by review — nobody can tell by looking that `9422890676`
should have been `9422890767`.

## Trusting the image path

The card booklets arrived as photographs, so there is no text layer to copy and
the characters have to be recognised. That single difference drives every design
decision in `src/image/`, because a recogniser does not fail loudly — it returns
a **plausible** wrong answer. Measured on the source images: `09-08-2001` came
back as `09-08-2000`, and a house number `103` as `903`. Neither looks wrong in a
spreadsheet.

Five safeguards, in the order they fire:

1. **A resolution gate** (`quality.ts`), with a floor per engine — see
   [Required source quality](#required-source-quality). Below it the import
   _stops_ rather than writing values it cannot stand behind. `--force`
   overrides it and says so.
2. **Measured card geometry** (`geometry.ts`). Page mastheads and the gutters
   between card rows are found from ink-projection profiles, never assumed as a
   fraction of the page. An earlier version assumed 6%; the masthead is actually
   a fixed ~9px, so every row band sat 17px low and 36px long — which clipped
   each card's unlabelled name line and pulled in the name of the card below.
   The reader then reported **the wrong person's name against the right person's
   data**, which is the worst output this pipeline can produce and the hardest to
   spot. Geometry is measured for that reason.
3. **Per-line recognition, photo excluded** (`ocr.ts`, Tesseract path). Geometry
   locates lines; Tesseract reads one at a time. Left to do its own layout
   analysis on a whole card it silently drops the text beside the portrait —
   that cost the `स्थान` and `गोत्र` lines outright.
4. **Every numeric field read twice.** Tesseract cross-checks its prose pass
   against a digit-only pass; the vision reader calls the model twice and keeps
   only what both passes agree on. Disagreement is **recorded and the value
   dropped** — never arbitrated, because picking between two guesses is still a
   guess.
5. **`needs_review = TRUE` on every row, unconditionally.** In the PDF pipeline
   that flag means "this row had a problem". Here it means "no character in this
   row was read by anything but a recogniser", which is true even of the rows
   that look perfect.

### Required source quality

The two engines need very different amounts of resolution, so the gate carries a
floor for each. Measured on the same source — the WhatsApp batch at 598×1600 for
_two_ booklet pages, about **6px per text line**:

| Field        | Printed      | Tesseract        | Vision model   |
| ------------ | ------------ | ---------------- | -------------- |
| `dob`        | `09-08-2001` | `08-08-2000` ✗   | `09-08-2001` ✓ |
| house number | `103`        | `903` ✗          | `103` ✓        |
| `entry_no`   | `0299`       | unreadable ✗     | `0299` ✓       |
| `gotra`      | `कुलवाल`     | dropped ✗        | `कुलवाल` ✓     |
| digit passes | —            | confidence **0** | all correct    |

Tesseract returned a _different wrong date_ on each of three preprocessing
variants. The vision model got every digit on the card right.

The difference is language priors: a glyph classifier sees ~5px of ink and has
nothing else, while a model reads a half-legible date against a strong prior
about what dates look like. That is a genuine advantage — and the same mechanism
that will invent a fluent, well-formed, entirely wrong phone number, which is
why `vision.ts` reads every card twice.

So:

- **`--engine tesseract` wants ~20px lines** — a booklet page around **2200px
  tall** (≈300dpi), roughly 4.7x these images. If you must route scans through
  WhatsApp, send them as **documents**; photos are recompressed on send.
- **`--engine vision` clears the bar at 6px**, so the WhatsApp batch is usable.
  The floor is set to 5px and deliberately not lower: nobody has checked what a
  model does at 3px, and the honest expectation is that it invents.

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
