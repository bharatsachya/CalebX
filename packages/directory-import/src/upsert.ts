/**
 * Writing mapped rows to a tab, keyed by `user_id`.
 *
 * Shared by both importers — the PDF table and the image cards land in the same
 * two tabs, and an id written by one must update, not duplicate, a row written
 * by the other.
 */

import { USER_ID_COLUMN } from "@calebx/form";
import {
  appendRows,
  ensureTab,
  getValues,
  updateRow,
  type Row,
} from "@calebx/sheets";
import type { Cells } from "./candidate.ts";

/** Ensures every column in `wanted` exists; returns the tab's full header. */
export async function ensureHeader(
  tab: string,
  wanted: readonly string[],
): Promise<string[]> {
  await ensureTab(tab);
  const existing = (await getValues(tab))[0] ?? [];
  const merged = [...existing];
  for (const column of wanted)
    if (!merged.includes(column)) merged.push(column);
  if (merged.length !== existing.length) await updateRow(tab, 1, merged);
  return merged;
}

/**
 * Writes `records` to a tab keyed by `user_id`.
 *
 * Existing ids are updated in place (merging over the current row so a
 * hand-added column survives); new ids are appended together in a single call to
 * stay well under the write quota.
 */
export async function upsert(
  tab: string,
  header: string[],
  records: Cells[],
): Promise<void> {
  const rows = await getValues(tab);
  const idColumn = header.indexOf(USER_ID_COLUMN);
  const rowNumberById = new Map<string, number>();
  for (let i = 1; i < rows.length; i++) {
    const id = rows[i]?.[idColumn]?.trim();
    if (id && !rowNumberById.has(id)) rowNumberById.set(id, i + 1);
  }

  const toAppend: Row[] = [];
  let updated = 0;

  for (const cells of records) {
    const id = cells[USER_ID_COLUMN] ?? "";
    const rowNumber = rowNumberById.get(id);
    if (rowNumber === undefined) {
      toAppend.push(header.map((column) => cells[column] ?? ""));
    } else {
      const existing = rows[rowNumber - 1] ?? [];
      const row = header.map((column, i) => cells[column] ?? existing[i] ?? "");
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
