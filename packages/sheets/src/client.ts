/**
 * Thin Google Sheets v4 client — the analogue of the connection pool in
 * `packages/db/src/db.ts`.
 *
 * Deliberately not the `googleapis` package: that is tens of megabytes of
 * generated surface for the five REST calls below. `google-auth-library` mints
 * the JWT (and caches/refreshes the access token internally); `fetch` does the
 * rest.
 */

import { JWT } from "google-auth-library";
import { getSheetsConfig } from "./config.ts";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export type Row = string[];

let cachedJwt: JWT | null = null;

function getJwt(): JWT {
  if (cachedJwt) return cachedJwt;
  const config = getSheetsConfig();
  cachedJwt = new JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: SCOPES,
  });
  return cachedJwt;
}

/** Only exported for tests — drops the cached client so config can be re-read. */
export function resetClient(): void {
  cachedJwt = null;
}

async function request<T>(
  path: string,
  init: { method: string; body?: unknown } = { method: "GET" },
): Promise<T> {
  const { spreadsheetId } = getSheetsConfig();
  const token = await getJwt().getAccessToken();

  const response = await fetch(`${BASE}/${spreadsheetId}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token.token}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!response.ok) {
    // Google returns a JSON error envelope; fall back to raw text if it doesn't.
    const detail = await response.text();
    throw new Error(
      `[sheets] ${init.method} ${path} failed (${response.status}): ${detail}`,
    );
  }

  return (await response.json()) as T;
}

/** 0-based column index to an A1 letter: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let result = "";
  let remaining = index;
  while (remaining >= 0) {
    result = String.fromCharCode((remaining % 26) + 65) + result;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return result;
}

/** Quoted so tab names containing spaces or digits stay valid A1 notation. */
function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

function encodeRange(range: string): string {
  return encodeURIComponent(range);
}

/** Every row in a tab, header included. Empty when the tab has no data. */
export async function getValues(tab: string): Promise<Row[]> {
  const range = encodeRange(quoteTab(tab));
  const data = await request<{ values?: string[][] }>(`/values/${range}`);
  return data.values ?? [];
}

/**
 * Overwrites one row, 1-based including the header.
 *
 * `RAW` matters: `USER_ENTERED` would let Sheets reinterpret answers, turning a
 * phone number into a float and a name beginning with `=` into a formula.
 */
export async function updateRow(
  tab: string,
  rowNumber: number,
  row: Row,
): Promise<void> {
  const end = columnLetter(Math.max(row.length - 1, 0));
  const range = encodeRange(
    `${quoteTab(tab)}!A${rowNumber}:${end}${rowNumber}`,
  );
  await request(`/values/${range}?valueInputOption=RAW`, {
    method: "PUT",
    body: { values: [row] },
  });
}

/** Appends a row after the last populated row in the tab. */
export async function appendRow(tab: string, row: Row): Promise<void> {
  await appendRows(tab, [row]);
}

/**
 * Appends many rows in a single request.
 *
 * A bulk import writes hundreds of rows; one `appendRow` each would blow through
 * the 60-writes/minute quota and take minutes. Sheets appends the whole block in
 * one call, so this is one write no matter the count. A no-op on an empty list.
 */
export async function appendRows(tab: string, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const range = encodeRange(quoteTab(tab));
  await request(
    `/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: { values: rows } },
  );
}

/** Tab titles mapped to their numeric sheet ids. */
export async function listTabs(): Promise<Map<string, number>> {
  const data = await request<{
    sheets?: Array<{ properties?: { title?: string; sheetId?: number } }>;
  }>("?fields=sheets.properties(title,sheetId)");

  const tabs = new Map<string, number>();
  for (const sheet of data.sheets ?? []) {
    const { title, sheetId } = sheet.properties ?? {};
    if (typeof title === "string" && typeof sheetId === "number") {
      tabs.set(title, sheetId);
    }
  }
  return tabs;
}

/** Creates a tab. No-op if one with that title already exists. */
export async function ensureTab(tab: string): Promise<void> {
  const existing = await listTabs();
  if (existing.has(tab)) return;
  await request(":batchUpdate", {
    method: "POST",
    body: { requests: [{ addSheet: { properties: { title: tab } } }] },
  });
}

/**
 * Removes a row entirely, 1-based including the header.
 *
 * Used only by `/forget`. Every row below shifts up, so callers must drop any
 * cached row numbers afterwards.
 */
export async function deleteRow(tab: string, rowNumber: number): Promise<void> {
  const sheetId = (await listTabs()).get(tab);
  if (sheetId === undefined) {
    throw new Error(`[sheets] Cannot delete from unknown tab: ${tab}`);
  }

  await request(":batchUpdate", {
    method: "POST",
    body: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              startIndex: rowNumber - 1, // 0-based, inclusive
              endIndex: rowNumber, // exclusive
            },
          },
        },
      ],
    },
  });
}
