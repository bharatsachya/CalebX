/**
 * Creates the three tabs and writes their header rows. `bun run sheets:init`.
 *
 * Idempotent and additive: run it again after adding a question and it appends
 * the new column to the header. It never reorders, renames, or removes an
 * existing column, because the header is what maps a cell back to a field id —
 * shuffling it would orphan every answer already collected.
 */

import {
  CANDIDATE_HEADERS,
  CONTACT_HEADERS,
  MATCH_HEADERS,
  SHEET_TABS,
} from "@calebx/form";
import { ensureTab, getValues, updateRow } from "./client.ts";

interface TabSpec {
  tab: string;
  headers: readonly string[];
  note: string;
}

const TABS: TabSpec[] = [
  {
    tab: SHEET_TABS.candidates,
    headers: CANDIDATE_HEADERS,
    note: "biodata, family, and partner preferences — written by the bot",
  },
  {
    tab: SHEET_TABS.contacts,
    headers: CONTACT_HEADERS,
    note: "SENSITIVE — protect this range, never shown to another user",
  },
  {
    tab: SHEET_TABS.matches,
    headers: MATCH_HEADERS,
    note: "curated by hand — protect this range, the bot only reads it",
  },
];

async function syncHeaders(spec: TabSpec): Promise<void> {
  await ensureTab(spec.tab);

  const existing = (await getValues(spec.tab))[0] ?? [];
  const merged = [...existing];
  const added: string[] = [];

  for (const header of spec.headers) {
    if (!merged.includes(header)) {
      merged.push(header);
      added.push(header);
    }
  }

  const missing = existing.filter(
    (header) => header !== "" && !spec.headers.includes(header),
  );

  if (added.length === 0 && existing.length > 0) {
    console.log(`  ${spec.tab}: up to date (${existing.length} columns)`);
  } else {
    await updateRow(spec.tab, 1, merged);
    const verb = existing.length === 0 ? "created" : "extended";
    console.log(`  ${spec.tab}: ${verb} — added ${added.length} column(s)`);
    if (added.length > 0) console.log(`    + ${added.join(", ")}`);
  }

  if (missing.length > 0) {
    // Left in place on purpose — it may be a notes column you added.
    console.log(`    (unrecognised columns kept: ${missing.join(", ")})`);
  }
  console.log(`    ${spec.note}`);
}

async function main(): Promise<void> {
  console.log("Syncing sheet headers...\n");
  for (const spec of TABS) {
    await syncHeaders(spec);
  }
  console.log("\nDone.");
  console.log(
    `Next: in the Sheets UI, protect the "${SHEET_TABS.contacts}" and ` +
      `"${SHEET_TABS.matches}" ranges so only you can edit them.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
