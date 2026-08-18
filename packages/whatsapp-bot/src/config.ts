import { dataPath, env } from "@calebx/config";

const e = env("whatsapp");

/**
 * Dry run lets the full consent → onboarding → agent flow be exercised with no
 * Meta account at all: outbound payloads are logged instead of sent. In that
 * mode the Graph credentials are not required, so they fall back to a
 * placeholder rather than exiting the process.
 */
const dryRun = e.boolean("WHATSAPP_DRY_RUN");
const graphCredential = (name: string): string =>
  dryRun ? e.optional(name, `dry-run-${name}`) : e.requiredOrExit(name);

export const config = {
  // The verify token and app secret are always needed — the webhook is a public
  // endpoint even in dry-run, and an unverified one would accept anything.
  verifyToken: e.requiredOrExit("WHATSAPP_VERIFY_TOKEN"),
  appSecret: e.requiredOrExit("WHATSAPP_APP_SECRET"),

  accessToken: graphCredential("WHATSAPP_ACCESS_TOKEN"),
  phoneNumberId: graphCredential("WHATSAPP_PHONE_NUMBER_ID"),

  graphBase: e.optional("WHATSAPP_GRAPH_BASE", "https://graph.facebook.com"),
  // Never use an unversioned Graph URL — it resolves to the OLDEST supported version.
  graphVersion: e.optional("WHATSAPP_GRAPH_VERSION", "v25.0"),

  port: e.number("WHATSAPP_PORT", 8787),
  webhookPath: e.optional("WHATSAPP_WEBHOOK_PATH", "/webhook"),

  /**
   * Webhook events older than this are dropped. Meta retries a failed delivery
   * for up to 7 days; replaying one a day later would answer outside the 24-hour
   * customer-service window and fail with error 131047. This also covers the
   * window where the in-memory dedupe map has been lost to a restart.
   */
  maxMessageAgeSeconds: e.number("WHATSAPP_MAX_MESSAGE_AGE_SECONDS", 300),

  dryRun,

  consentStorePath: e.optional("CONSENT_STORE_PATH", dataPath("consent.json")),
  onboardingStorePath: e.optional(
    "ONBOARDING_STORE_PATH",
    dataPath("onboarding.json"),
  ),
} as const;

export type WhatsAppConfig = typeof config;
