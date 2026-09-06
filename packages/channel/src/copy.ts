import type { OnboardingRecord } from "./onboarding.store.ts";

/**
 * Every user-facing string, in one place, so the channels cannot drift.
 *
 * Strings that mention a command are functions taking the channel's hint for
 * that command — Telegram passes `"/forget"`, WhatsApp passes `"FORGET"` — so
 * the same copy reads correctly on a platform without slash commands.
 */

/** How a channel spells its two always-available commands. */
export interface CommandHints {
  start: string;
  forget: string;
}

export const TELEGRAM_HINTS: CommandHints = {
  start: "/start",
  forget: "/forget",
};

export const WHATSAPP_HINTS: CommandHints = {
  start: "START",
  forget: "FORGET",
};

// --- Consent ---

export const CONSENT_ACCEPT = "consent:accept";
export const CONSENT_DECLINE = "consent:decline";

export const CONSENT_ACCEPT_LABEL = "✓ I agree — let's talk";
export const CONSENT_DECLINE_LABEL = "Not now";

/**
 * WhatsApp caps reply-button titles at 20 characters, and the full accept label
 * is 22 — it would arrive visibly clipped. Telegram has no such limit and keeps
 * the long labels above.
 */
export const CONSENT_ACCEPT_LABEL_SHORT = "✓ I agree";
export const CONSENT_DECLINE_LABEL_SHORT = "Not now";

export const privacyNotice = (
  hints: CommandHints,
): string => `👋 Hi, I'm Bettle.

I'm your matchmaking platform designed to help you find your ideal partner.

We're currently in our onboarding phase to gather your details, preferences, and what you value in a partner before matching goes live.

Before we start:
• We store your details and preferences securely.
• They are used solely to curate and identify the best matches for you.
• You're in control: send ${hints.forget} anytime to erase your details and revoke this.

Tap below to start your onboarding.`;

export const ACCEPTED_MESSAGE = `Great — let me ask you a few quick things first.`;

export const declinedMessage = (hints: CommandHints): string =>
  `No problem — I won't store anything. If you change your mind, just send ${hints.start}.`;

export const WELCOME_BACK = `Welcome back. Pick up wherever you like — what's new?`;

export const forgottenMessage = (hints: CommandHints): string =>
  `Done. I've erased what I'd learned and revoked your consent. Send ${hints.start} if you ever want to begin again.`;

export const NEEDS_CONSENT_NUDGE = `Before I can chat, I need your okay to learn from our conversation.`;

// --- Onboarding ---

export const ONBOARDING_NAME_QUESTION = `What should I call you?`;

export const onboardingCityQuestion = (name: string): string =>
  `Nice to meet you, ${name}! Which city are you based in?`;

export const ONBOARDING_AGE_QUESTION = `And roughly how old are you?`;

export const ONBOARDING_PURPOSE_QUESTION = `Last one — what kind of connection are you looking for on Bettle?`;

export const onboardingComplete = (name: string, _purpose?: string): string =>
  `You're all set, ${name}! 🎉 We've saved your profile and partner preferences.\n\nDirect chatting and matching aren't open quite yet, but we're actively reviewing profiles and will notify you as soon as your best matches are ready. Stay tuned!`;

export const onboardingSummary = (record: OnboardingRecord): string =>
  `My name is ${record.name ?? "friend"}, I'm ${record.age ?? "unknown age"} years old, based in ${record.city ?? "unknown city"}. I joined Bettle to: ${record.purpose ?? "find a partner"}.`;

export const ONBOARDING_SUMMARY_ACK = `Got it — I'll keep that in mind.`;

// --- Channels without tappable UI (WhatsApp) ---

/** Shown when a typed answer doesn't match any offered option. */
export const CHOICE_NOT_UNDERSTOOD = `Sorry, I didn't catch that — tap an option below, or reply with its number.`;

/** Renders the options as a numbered list, for clients that render lists poorly. */
export const numberedOptions = (labels: readonly string[]): string =>
  labels.map((label, index) => `${index + 1}. ${label}`).join("\n");

/** Sent when a user shares media. We only ingest text. */
export const UNSUPPORTED_MESSAGE = `I can only read text for now — send me a message and I'll pick it up from there.`;

/**
 * Shown when the conversation pipeline fails. The user should never be left
 * staring at silence wondering whether their message arrived.
 */
export const AGENT_UNAVAILABLE = `Sorry — I glitched for a second there. Say that again?`;
