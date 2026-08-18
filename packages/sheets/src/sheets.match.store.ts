/**
 * `MatchStore` over the `Matches` tab. Read-only.
 *
 * `006_matches.sql`: "v1 matches are created by hand through the internal admin
 * — there is no algorithmic matcher. `reason` is human-written and is what the
 * parent actually reads."
 *
 * Here the internal admin is you, editing the sheet. This file issues exactly
 * one kind of call — a read — and the port it implements declares no write
 * method, so there is no route by which a user could alter what you curated.
 *
 * Rows are not cached: you add a match while the bot is running and the next
 * `/match` picks it up with no restart.
 */

import {
  MATCH_COLUMNS,
  MATCH_REASON_COLUMN,
  SHEET_TABS,
  USER_ID_COLUMN,
  type Match,
  type MatchStore,
} from "@calebx/form";
import { SheetTable } from "./table.ts";

/** Columns copied into a rendered match. Contact details are not among them. */
const RENDERED_COLUMNS: readonly string[] = [
  ...MATCH_COLUMNS.map((column) => column.id),
  MATCH_REASON_COLUMN,
];

export class SheetsMatchStore implements MatchStore {
  private readonly table = new SheetTable(SHEET_TABS.matches);

  async list(userId: string): Promise<Match[]> {
    const rows = await this.table.readAll();

    return rows
      .filter((cells) => cells[USER_ID_COLUMN]?.trim() === userId)
      .map((cells) => {
        const values: Record<string, string> = {};
        // Allow-list, not a copy of the row: a column you add to the tab for
        // your own notes stays out of what the user is shown until you also
        // add it to MATCH_COLUMNS.
        for (const column of RENDERED_COLUMNS) {
          const value = cells[column];
          if (value !== undefined && value !== "") values[column] = value;
        }
        return { userId, values };
      })
      .filter((match) => Object.keys(match.values).length > 0);
  }
}
