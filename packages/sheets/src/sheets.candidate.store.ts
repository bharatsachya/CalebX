/**
 * `CandidateStore` over the `Candidates` tab.
 *
 * Holds biodata, family, and partner preferences — everything except contact
 * details, which live in their own tab (`sheets.contact.store.ts`).
 */

import {
  PUBLIC_FIELDS,
  SHEET_TABS,
  USER_ID_COLUMN,
  type CandidateProfile,
  type CandidateStore,
} from "@calebx/form";
import { SheetTable, type Cells } from "./table.ts";

const CREATED_AT = "created_at";
const UPDATED_AT = "updated_at";
const CONSENT_GRANTED = "consent_granted";

export class SheetsCandidateStore implements CandidateStore {
  private readonly table = new SheetTable(SHEET_TABS.candidates);

  async get(userId: string): Promise<CandidateProfile | null> {
    const cells = await this.table.read(userId);
    if (!cells) return null;

    return {
      userId,
      createdAt: cells[CREATED_AT] ?? "",
      updatedAt: cells[UPDATED_AT] ?? "",
      consentGranted: cells[CONSENT_GRANTED] === "TRUE",
      answers: readAnswers(cells),
    };
  }

  async set(userId: string, profile: CandidateProfile): Promise<void> {
    const cells: Cells = {
      [USER_ID_COLUMN]: userId,
      [CREATED_AT]: profile.createdAt,
      [UPDATED_AT]: profile.updatedAt,
      [CONSENT_GRANTED]: profile.consentGranted ? "TRUE" : "FALSE",
    };

    for (const field of PUBLIC_FIELDS) {
      const answer = profile.answers[field.id];
      if (answer !== undefined) cells[field.id] = answer;
    }

    await this.table.write(userId, cells);
  }

  async delete(userId: string): Promise<void> {
    await this.table.remove(userId);
  }
}

/**
 * Reads the question columns back out.
 *
 * An empty cell is omitted rather than stored as `""`, because the FSM treats a
 * missing key as "not asked yet" — see `nextField()`. A skipped question holds
 * the literal `SKIPPED` marker, which is a real value and is kept.
 */
function readAnswers(cells: Cells): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const field of PUBLIC_FIELDS) {
    const value = cells[field.id];
    if (value !== undefined && value !== "") answers[field.id] = value;
  }
  return answers;
}
