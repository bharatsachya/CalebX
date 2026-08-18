import { env } from "@calebx/config";

const e = env("sheets");

export interface SheetsConfig {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
}

let cachedConfig: SheetsConfig | null = null;

export function getSheetsConfig(): SheetsConfig {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    spreadsheetId: e.required("GOOGLE_SHEETS_SPREADSHEET_ID"),
    clientEmail: e.required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    // A service-account key is multi-line PEM. Shells and .env files carry it as
    // a single line with literal backslash-n, so unescape before use — the JWT
    // signer rejects it silently otherwise, and the failure surfaces much later
    // as an opaque "invalid_grant".
    privateKey: e.required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  };
  return cachedConfig;
}
