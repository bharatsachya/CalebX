/**
 * `bun run import:images <jpg...> [--write] [--force] [--gender male|female]`
 *
 * Booklet *photographs* into the Candidates sheet. The sibling of `cli.ts`,
 * which does the same job for booklet PDFs.
 *
 * The difference that matters is trust. A PDF carries a text layer, so that
 * importer copies characters. There is no text layer in a photograph, so this
 * one asks a recogniser to guess them — and guesses about real people's phone
 * numbers and dates of birth are not something a spreadsheet can hold safely
 * without saying so. Hence two safeguards the PDF path does not need:
 *
 *   1. A resolution gate. Below `quality.ts`'s floor the import stops instead of
 *      writing plausible-looking wrong values. `--force` overrides it, loudly.
 *   2. Every row is written with `needs_review = TRUE`, however clean it looks.
 *
 * Dry by default, like its sibling. `--write` commits.
 */

import { writeSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { env } from "@calebx/config";
import { SHEET_TABS, CANDIDATE_HEADERS, USER_ID_COLUMN } from "@calebx/form";
import type { MappedRow } from "./candidate.ts";
import { EXTRA_CARD_COLUMNS, mapCard } from "./candidate.card.ts";
import { readCard } from "./image/card.ts";
import { findCards, findPages, loadGray } from "./image/geometry.ts";
import { CardReader } from "./image/ocr.ts";
import { assessQuality, RESOLUTION_ADVICE } from "./image/quality.ts";
import type { CardRegion, ParsedCard } from "./image/types.ts";
import {
  DEFAULT_MIN_INTERVAL_MS,
  DEFAULT_VISION_MODEL,
  VisionReader,
} from "./image/vision.ts";
import { sourceSlug } from "./normalize.ts";
import { ensureHeader, upsert } from "./upsert.ts";
import {
  type Engine,
  flagValue,
  parseArgs,
  printRows,
} from "./cli.images.helpers.ts";

/**
 * Binds whichever engine was asked for to a single call shape.
 *
 * Both readers produce a `ParsedCard`, so everything downstream — the mapper,
 * the validators, the sheet writer — is engine-blind. Only this function knows
 * which one ran.
 */
type ReadFn = (card: CardRegion) => Promise<ParsedCard>;

/**
 * Per-card progress, written straight to the file descriptor.
 *
 * `console.log` block-buffers when stdout is a pipe or a file, so a vision run
 * over a booklet emits nothing at all for many minutes and a stalled import is
 * indistinguishable from a slow one. A direct write flushes, which is what makes
 * `bun run import:images … | tee log` and background runs legible.
 */
function progress(line: string): void {
  writeSync(1, `${line}\n`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  // Committing a reviewed result never re-runs the images. Recognition is
  // expensive and not reproducible — a second run drops different cards to
  // provider timeouts — so re-running to commit would write rows nobody looked
  // at. This path writes exactly the file that was reviewed.
  if (options.fromJson) {
    const reviewed = JSON.parse(
      await readFile(options.fromJson, "utf8"),
    ) as MappedRow[];
    console.log(`${reviewed.length} reviewed row(s) from ${options.fromJson}`);
    if (!options.write) {
      printRows(reviewed);
      console.log("\nDry run — nothing written. Add --write to commit.");
      return;
    }
    await commit(reviewed);
    return;
  }

  if (options.paths.length === 0) {
    console.error(
      "Usage: bun run import:images <jpg> [<jpg>...] [--write] [--force]\n" +
        "         [--gender male|female] [--engine tesseract|vision]\n" +
        "         [--model <openrouter-model>] [--no-consensus] [--json <path>]\n" +
        "         [--from-json <path>]",
    );
    process.exit(1);
  }
  if (options.gender === null) {
    console.log(
      "No --gender given. The booklet prints it in the masthead, not on the\n" +
        "card, so gender will be left blank on every row.\n",
    );
  }

  const model =
    flagValue(process.argv.slice(2), "--model") ??
    env("directory-import").optional(
      "OPENROUTER_VISION_MODEL",
      DEFAULT_VISION_MODEL,
    );

  // Only the vision engine needs a key, so the Tesseract path stays runnable
  // with no credentials at all.
  const vision =
    options.engine === "vision"
      ? new VisionReader({
          apiKey: env("directory-import").requiredOrExit("OPENROUTER_API_KEY"),
          model,
          consensus: options.consensus,
          minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
        })
      : null;
  const tesseract =
    options.engine === "tesseract" ? await CardReader.create() : null;

  console.log(
    options.engine === "vision"
      ? `engine: vision (${model}${options.consensus ? ", two passes" : ", SINGLE PASS"})`
      : "engine: tesseract (hin+eng, local)",
  );
  if (options.engine === "vision" && !options.consensus) {
    console.log(
      "  --no-consensus: numeric fields are written on one reading. A vision\n" +
        "  model states an invented number as fluently as a real one.",
    );
  }

  const mapped: MappedRow[] = [];
  const nowIso = new Date().toISOString();
  let rejected = 0;

  try {
    for (const path of options.paths) {
      const name = path.split("/").pop() ?? path;
      const image = await loadGray(path);
      const pages = findPages(image);
      const cards = pages.flatMap((page) => findCards(image, page));
      const quality = assessQuality(image, cards, options.engine);

      console.log(
        `\n${name}  ${image.width}x${image.height}  ` +
          `${pages.length} page(s), ${cards.length} card(s)`,
      );
      console.log(`  quality: ${quality.summary}`);

      if (quality.verdict === "unusable" && !options.force) {
        console.log("  → skipped. Re-run with --force to read it anyway.");
        rejected++;
        continue;
      }
      if (quality.verdict === "unusable") {
        console.log("  → --force given: reading anyway. Trust nothing here.");
      }

      const read: ReadFn = vision
        ? (card) => vision.readCard(path, card)
        : (card) => readCard(tesseract!, image, path, card);

      for (const [n, card] of cards.entries()) {
        const started = Date.now();

        // One unreadable card must not cost the other 179. A credentials
        // failure is different — every subsequent call would fail identically,
        // so that one aborts rather than logging the same error 180 times.
        let parsed: ParsedCard;
        try {
          parsed = await read(card);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (/\b40[13]\b/.test(message)) throw error;
          progress(`  [${n + 1}/${cards.length}] ${message} — skipped`);
          continue;
        }

        const fields = Object.keys(parsed.raw).length;
        progress(
          `  [${n + 1}/${cards.length}] ${parsed.raw.entry_no ?? "no id"} ` +
            `${parsed.raw.name ?? "(no name)"} — ${fields} fields, ` +
            `${parsed.issues.length} issue(s), ${Date.now() - started}ms`,
        );

        if (fields === 0) continue;
        mapped.push(
          mapCard(parsed, name, sourceSlug(name), nowIso, options.gender),
        );
      }
    }
  } finally {
    await tesseract?.close();
  }

  if (rejected > 0) {
    console.log(`\n${rejected} image(s) skipped by the resolution gate.\n`);
    console.log(RESOLUTION_ADVICE);
  }

  if (mapped.length === 0) {
    console.log("\nNothing to write.");
    return;
  }

  // Collapse duplicate ids (the same entry number read twice), last write wins.
  const byId = new Map<string, MappedRow>();
  for (const row of mapped) byId.set(row.userId, row);
  const unique = [...byId.values()];

  console.log(
    `\n${unique.length} card(s) read, every one flagged for review, ` +
      `${unique.filter((row) => row.contact).length} with contact details.`,
  );

  if (options.json) {
    await writeFile(options.json, JSON.stringify(unique, null, 2));
    console.log(`\nFull result written to ${options.json}`);
  }

  if (!options.write) {
    printRows(unique);
    console.log("\nDry run — nothing written. Re-run with --write to commit.");
    return;
  }

  await commit(unique);
}

/** Widens both tabs' headers, then upserts by `user_id`. */
async function commit(rows: MappedRow[]): Promise<void> {
  const candidateHeader = await ensureHeader(SHEET_TABS.candidates, [
    ...CANDIDATE_HEADERS,
    ...EXTRA_CARD_COLUMNS,
  ]);
  const contactHeader = await ensureHeader(SHEET_TABS.contacts, [
    USER_ID_COLUMN,
    "updated_at",
    "phone",
    "address",
  ]);

  await upsert(
    SHEET_TABS.candidates,
    candidateHeader,
    rows.map((row) => row.candidate),
  );
  await upsert(
    SHEET_TABS.contacts,
    contactHeader,
    rows.flatMap((row) => (row.contact ? [row.contact] : [])),
  );

  console.log("\nDone. Every row needs checking against the printed booklet.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  // A rejected key is a configuration mistake, not a crash. The stack trace
  // says nothing the user can act on; the one-line fix does.
  if (/\b40[13]\b/.test(message)) {
    console.error(
      `\n${message}\n\n` +
        "OpenRouter rejected the credentials. Set a real key in the repo-root\n" +
        ".env — they look like `sk-or-v1-…` and run about 73 characters:\n\n" +
        "  OPENROUTER_API_KEY=sk-or-v1-...\n\n" +
        "Get one at https://openrouter.ai/keys",
    );
    process.exit(1);
  }

  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exit(1);
});
