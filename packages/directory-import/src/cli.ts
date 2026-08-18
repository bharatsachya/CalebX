/**
 * `bun run import <pdf...> [--write]` — booklet PDFs into the Candidates sheet.
 *
 * Dry by default: it parses, maps, and prints exactly what it would write, so a
 * bad parse is caught before it touches a live sheet holding real people. Pass
 * `--write` to commit.
 *
 * Idempotent. Every row's id is derived from its booklet and serial
 * (`dir:final-girls:12`), so a second run updates the same rows instead of
 * duplicating them — safe to re-run after fixing a booklet typo.
 *
 * Contact numbers go to the sensitive Contacts tab, never Candidates, matching
 * where the bot itself puts them (`003_contact_details.sql`).
 */

import { SHEET_TABS, CANDIDATE_HEADERS, USER_ID_COLUMN } from "@calebx/form";
import {
  appendRows,
  ensureTab,
  getValues,
  updateRow,
  type Row,
} from "@calebx/sheets";
import {
  mapRow,
  EXTRA_CANDIDATE_COLUMNS,
  type Cells,
  type MappedRow,
} from "./candidate.ts";
import { parsePages } from "./parse.ts";
import { readPdf } from "./pdf.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const paths = args.filter((a) => !a.startsWith("--"));

  if (paths.length === 0) {
    console.error("Usage: bun run import <pdf> [<pdf>...] [--write]");
    process.exit(1);
  }

  // 1) Parse and map every booklet into sheet rows.
  const nowIso = new Date().toISOString();
  const mapped: MappedRow[] = [];
  let flagged = 0;

  for (const path of paths) {
    const name = path.split("/").pop() ?? path;
    const rows = parsePages(await readPdf(path));
    rows.forEach((row, index) => {
      const m = mapRow(row, name, nowIso, index);
      if (m.candidate.needs_review === "TRUE") flagged++;
      mapped.push(m);
    });
    console.log(`  ${name}: ${rows.length} rows`);
  }

  // Collapse any duplicate ids (a repeated booklet serial), last write wins.
  const byId = new Map<string, MappedRow>();
  for (const m of mapped) byId.set(m.userId, m);
  const unique = [...byId.values()];

  console.log(
    `\n${unique.length} people (${flagged} flagged for review, ` +
      `${unique.filter((m) => m.contact).length} with a phone).`,
  );

  if (!write) {
    console.log("\nDry run — nothing written. Re-run with --write to commit.");
    printSample(unique);
    return;
  }

  // 2) Widen the Candidates header with the directory-only columns, once.
  const candidateHeader = await ensureHeader(SHEET_TABS.candidates, [
    ...CANDIDATE_HEADERS,
    ...EXTRA_CANDIDATE_COLUMNS,
  ]);
  const contactHeader = await ensureHeader(SHEET_TABS.contacts, [
    USER_ID_COLUMN,
    "updated_at",
    "phone",
  ]);

  // 3) Upsert: update rows whose id already exists, batch-append the rest.
  await upsert(
    SHEET_TABS.candidates,
    candidateHeader,
    unique.map((m) => m.candidate),
  );
  await upsert(
    SHEET_TABS.contacts,
    contactHeader,
    unique.flatMap((m) => (m.contact ? [m.contact] : [])),
  );

  console.log("\nDone. Review the rows where needs_review = TRUE.");
}

/** Ensures every column in `wanted` exists; returns the tab's full header. */
async function ensureHeader(
  tab: string,
  wanted: readonly string[],
): Promise<string[]> {
  await ensureTab(tab);
  const existing = (await getValues(tab))[0] ?? [];
  const merged = [...existing];
  for (const col of wanted) if (!merged.includes(col)) merged.push(col);
  if (merged.length !== existing.length) await updateRow(tab, 1, merged);
  return merged;
}

/**
 * Writes `records` to a tab keyed by `user_id`.
 *
 * Existing ids are updated in place (merging over the current row so a hand-added
 * column survives); new ids are appended together in a single call to stay well
 * under the write quota.
 */
async function upsert(
  tab: string,
  header: string[],
  records: Cells[],
): Promise<void> {
  const rows = await getValues(tab);
  const idCol = header.indexOf(USER_ID_COLUMN);
  const rowNumberById = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const id = rows[i]?.[idCol]?.trim();
    if (id && !rowNumberById.has(id)) rowNumberById.set(id, i + 1);
  }

  const toAppend: Row[] = [];
  let updated = 0;

  for (const cells of records) {
    const id = cells[USER_ID_COLUMN] ?? "";
    const rowNumber = rowNumberById.get(id);
    if (rowNumber === undefined) {
      toAppend.push(header.map((h) => cells[h] ?? ""));
    } else {
      const existing = rows[rowNumber - 1] ?? [];
      const row = header.map((h, i) => cells[h] ?? existing[i] ?? "");
      await updateRow(tab, rowNumber, row);
      updated++;
    }
  }

  await appendRows(tab, toAppend);
  console.log(
    `  ${tab}: ${toAppend.length} added, ${updated} updated ` +
      `(${records.length} total).`,
  );
}

function printSample(rows: MappedRow[]): void {
  console.log("\nSample (first 3):");
  for (const m of rows.slice(0, 3)) {
    console.log(`  ${m.userId}`);
    for (const [k, v] of Object.entries(m.candidate))
      console.log(`      ${k}: ${v}`);
    if (m.contact) console.log(`      → Contacts.phone: ${m.contact.phone}`);
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exit(1);
});
