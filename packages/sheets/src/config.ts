import dotenv from "dotenv";

// Load standard .env if present.
dotenv.config();

export interface SheetsConfig {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
}

let cachedConfig: SheetsConfig | null = null;

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "" || value === `YOUR_${name}_HERE`) {
    throw new Error(
      `[sheets] Missing required environment variable: ${name}.\n` +
        `Set ${name} in your environment or .env file. See .env.example.`,
    );
  }
  return value.trim();
}

export function getSheetsConfig(): SheetsConfig {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    spreadsheetId: required("GOOGLE_SHEETS_SPREADSHEET_ID"),
    clientEmail: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    // A service-account key is multi-line PEM. Shells and .env files carry it as
    // a single line with literal backslash-n, so unescape before use — the JWT
    // signer rejects it silently otherwise, and the failure surfaces much later
    // as an opaque "invalid_grant".
    privateKey: required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  };
  return cachedConfig;
}
