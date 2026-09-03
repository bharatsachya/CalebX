import { dataPath, env } from "@calebx/config";

// Importing @calebx/config is what loads the root .env — it finds the monorepo
// root itself, so nothing here depends on this file's depth or on the cwd.
const e = env("telegram");

export const config = {
  telegramBotToken: e.requiredOrExit("TELEGRAM_BOT_TOKEN"),
  // Where the consent ledger is persisted. Defaults to a gitignored file at repo root.
  consentStorePath: e.optional("CONSENT_STORE_PATH", dataPath("consent.json")),
  onboardingStorePath: e.optional(
    "ONBOARDING_STORE_PATH",
    dataPath("onboarding.json"),
  ),
  /**
   * Where human-review escalations are announced. Optional: without it the
   * tasks are still recorded in Postgres, they just are not pushed to anyone.
   */
  adminChatId: e.optional("ADMIN_CHAT_ID", "") || null,
} as const;
