/**
 * `ContactStore` over the `Contacts` tab. SENSITIVE.
 *
 * `003_contact_details.sql`: these values "must never appear in any candidate or
 * match payload sent to another user — released only on mutual interest, and
 * that release is a manual admin step, never automatic."
 *
 * Kept in a separate tab and behind a separate port so the `/match` path — which
 * is only ever handed a `MatchStore` — has no way to reach a phone number. Set a
 * protected range on this tab in the Sheets UI as well.
 */

import {
  SENSITIVE_FIELDS,
  SHEET_TABS,
  USER_ID_COLUMN,
  type ContactRecord,
  type ContactStore,
} from "@calebx/form";
import { SheetTable, type Cells } from "./table.ts";

const UPDATED_AT = "updated_at";

export class SheetsContactStore implements ContactStore {
  private readonly table = new SheetTable(SHEET_TABS.contacts);

  async get(userId: string): Promise<ContactRecord | null> {
    const cells = await this.table.read(userId);
    if (!cells) return null;

    const answers: Record<string, string> = {};
    for (const field of SENSITIVE_FIELDS) {
      const value = cells[field.id];
      if (value !== undefined && value !== "") answers[field.id] = value;
    }

    return { userId, answers };
  }

  async set(userId: string, record: ContactRecord): Promise<void> {
    const cells: Cells = {
      [USER_ID_COLUMN]: userId,
      [UPDATED_AT]: new Date().toISOString(),
    };

    for (const field of SENSITIVE_FIELDS) {
      const answer = record.answers[field.id];
      if (answer !== undefined) cells[field.id] = answer;
    }

    await this.table.write(userId, cells);
  }

  async delete(userId: string): Promise<void> {
    await this.table.remove(userId);
  }
}
