import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env lives at the monorepo root (three levels up from packages/telegram-bot/src).
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "" || value === `YOUR_${name}_HERE`) {
    // Fatal boot error. (A structured logger is a future `@calebx/logger` concern;
    // for a process-exiting boot failure, stderr is fine.)
    console.error(
      `Missing required environment variable: ${name}.\n` +
        `Copy .env.example to .env and fill it in.`,
    );
    process.exit(1);
  }
  return value;
}

export const config = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  // Where the consent ledger is persisted. Defaults to a gitignored file at repo root.
  consentStorePath:
    process.env.CONSENT_STORE_PATH ??
    path.resolve(__dirname, "../../../.data/consent.json"),
  onboardingStorePath:
    process.env.ONBOARDING_STORE_PATH ??
    path.resolve(__dirname, "../../../.data/onboarding.json"),
} as const;
