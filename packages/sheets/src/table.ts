/**
 * Header-mapped row access for a user-keyed tab.
 *
 * Both writable stores need the same three things: read the header row, find a
 * user's row, and upsert it. This holds that logic once so
 * `sheets.candidate.store.ts` and `sheets.contact.store.ts` stay declarative.
 *
 * Columns are addressed by header name, never by position, so reordering
 * columns in the sheet by hand cannot corrupt anyone's data. A header the code
 * doesn't recognise is left untouched on write — that is what lets you keep your
 * own notes columns alongside the bot's.
 */

import { TELEGRAM_USER_ID_COLUMN, USER_ID_COLUMN } from "@calebx/form";
import { appendRow, deleteRow, getValues, updateRow } from "./client.ts";

/** A row's cells keyed by header name. */
export type Cells = Record<string, string>;

interface Snapshot {
  headers: string[];
  /** user_id → 1-based sheet row number. */
  rowNumbers: Map<string, number>;
  /** telegram_user_id → 1-based sheet row number. */
  telegramRowNumbers: Map<string, number>;
}

export class SheetTable {
  private snapshot: Snapshot | null = null;

  constructor(private readonly tab: string) {}

  /**
   * Reads and indexes the tab.
   *
   * Cached because a single bot turn touches the table two or three times and
   * Sheets allows only 60 reads/minute. Any write invalidates it.
   */
  private async load(): Promise<Snapshot> {
    if (this.snapshot) return this.snapshot;

    const rows = await getValues(this.tab);
    const headers = rows[0] ?? [];
    const userIdColumn = headers.indexOf(USER_ID_COLUMN);
    const telegramIdColumn = headers.indexOf(TELEGRAM_USER_ID_COLUMN);

    const rowNumbers = new Map<string, number>();
    const telegramRowNumbers = new Map<string, number>();

    for (let index = 1; index < rows.length; index++) {
      const row = rows[index];
      if (!row) continue;

      if (userIdColumn !== -1) {
        const key = row[userIdColumn]?.trim();
        if (key && !rowNumbers.has(key)) rowNumbers.set(key, index + 1);
      }

      if (telegramIdColumn !== -1) {
        const tgKey = row[telegramIdColumn]?.trim();
        if (tgKey && !telegramRowNumbers.has(tgKey)) {
          telegramRowNumbers.set(tgKey, index + 1);
        }
      }
    }

    this.snapshot = { headers, rowNumbers, telegramRowNumbers };
    return this.snapshot;
  }

  private invalidate(): void {
    this.snapshot = null;
  }

  async headers(): Promise<string[]> {
    return (await this.load()).headers;
  }

  /** A user's row by Telegram user ID as header→cell, or null if unlinked. */
  async readByTelegramId(telegramUserId: string): Promise<Cells | null> {
    const { headers, telegramRowNumbers } = await this.load();
    const rowNumber = telegramRowNumbers.get(telegramUserId.trim());
    if (rowNumber === undefined) return null;

    const rows = await getValues(this.tab);
    const row = rows[rowNumber - 1];
    if (!row) return null;

    const cells: Cells = {};
    headers.forEach((header, index) => {
      cells[header] = row[index] ?? "";
    });
    return cells;
  }

  /** A user's row as header→cell, or null if they have none. */
  async read(userId: string): Promise<Cells | null> {
    const { headers, rowNumbers } = await this.load();
    const rowNumber = rowNumbers.get(userId);
    if (rowNumber === undefined) return null;

    // Re-read rather than cache row bodies: the point of this sheet is that you
    // edit it by hand, and a stale body would silently overwrite your edit.
    const rows = await getValues(this.tab);
    const row = rows[rowNumber - 1];
    if (!row) return null;

    const cells: Cells = {};
    headers.forEach((header, index) => {
      cells[header] = row[index] ?? "";
    });
    return cells;
  }

  /**
   * Upserts a user's row.
   *
   * Merges over whatever is already there, so a partial write leaves unrelated
   * columns — including any you added by hand — intact.
   */
  async write(userId: string, cells: Cells): Promise<void> {
    const { headers, rowNumbers } = await this.load();
    if (headers.length === 0) {
      throw new Error(
        `[sheets] Tab "${this.tab}" has no header row. Run: bun run sheets:init`,
      );
    }

    const existing = (await this.read(userId)) ?? {};
    const merged: Cells = { ...existing, ...cells, [USER_ID_COLUMN]: userId };
    const row = headers.map((header) => merged[header] ?? "");

    const rowNumber = rowNumbers.get(userId);
    if (rowNumber === undefined) {
      await appendRow(this.tab, row);
    } else {
      await updateRow(this.tab, rowNumber, row);
    }
    this.invalidate();
  }

  /** Removes a user's row. No-op if they have none. */
  async remove(userId: string): Promise<void> {
    const { rowNumbers } = await this.load();
    const rowNumber = rowNumbers.get(userId);
    if (rowNumber === undefined) return;

    await deleteRow(this.tab, rowNumber);
    // Every row below just shifted up; the whole index is stale.
    this.invalidate();
  }

  /** Every data row, header-mapped. Used by the read-only Matches tab. */
  async readAll(): Promise<Cells[]> {
    const rows = await getValues(this.tab);
    const headers = rows[0] ?? [];
    if (headers.length === 0) return [];

    return rows.slice(1).map((row) => {
      const cells: Cells = {};
      headers.forEach((header, index) => {
        cells[header] = row[index] ?? "";
      });
      return cells;
    });
  }
}
