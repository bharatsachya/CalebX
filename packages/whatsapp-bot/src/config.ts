import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env lives at the monorepo root (three levels up from packages/whatsapp-bot/src).
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "" || value === `YOUR_${name}_HERE`) {
    // Fatal boot error. (A structured logger is a future `@calebx/logger` concern;
    // for a process-exiting boot failure, stderr is fine.)
    console.error(
      `[whatsapp] Missing required environment variable: ${name}.\n` +
        `Copy .env.example to .env and fill it in.`,
    );
    process.exit(1);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const parsed = Number(optional(name, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Dry run lets the full consent → onboarding → agent flow be exercised with no
 * Meta account at all: outbound payloads are logged instead of sent. In that
 * mode the Graph credentials are not required, so they fall back to a
 * placeholder rather than exiting the process.
 */
const dryRun = optional("WHATSAPP_DRY_RUN", "false").toLowerCase() === "true";
const graphCredential = (name: string): string =>
  dryRun ? optional(name, `dry-run-${name}`) : required(name);

export const config = {
  // The verify token and app secret are always needed — the webhook is a public
  // endpoint even in dry-run, and an unverified one would accept anything.
  verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
  appSecret: required("WHATSAPP_APP_SECRET"),

  accessToken: graphCredential("WHATSAPP_ACCESS_TOKEN"),
  phoneNumberId: graphCredential("WHATSAPP_PHONE_NUMBER_ID"),

  graphBase: optional("WHATSAPP_GRAPH_BASE", "https://graph.facebook.com"),
  // Never use an unversioned Graph URL — it resolves to the OLDEST supported version.
  graphVersion: optional("WHATSAPP_GRAPH_VERSION", "v25.0"),

  port: optionalNumber("WHATSAPP_PORT", 8787),
  webhookPath: optional("WHATSAPP_WEBHOOK_PATH", "/webhook"),

  /**
   * Webhook events older than this are dropped. Meta retries a failed delivery
   * for up to 7 days; replaying one a day later would answer outside the 24-hour
   * customer-service window and fail with error 131047. This also covers the
   * window where the in-memory dedupe map has been lost to a restart.
   */
  maxMessageAgeSeconds: optionalNumber("WHATSAPP_MAX_MESSAGE_AGE_SECONDS", 300),

  dryRun,
} as const;

export type WhatsAppConfig = typeof config;
