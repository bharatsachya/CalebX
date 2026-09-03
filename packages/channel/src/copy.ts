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
): string => `👋 Hi, I'm CALEBX.

I get to know you through our conversation, and over time I can suggest people, places, and communities that fit you.

Before we start, here's the deal:
• I store interests and topics I pick up from our chats — not your raw messages.
• I use them only to make suggestions inside CALEBX.
• You're in control: send ${hints.forget} anytime to erase everything I've learned and revoke this.

Tap below to continue.`;

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

export const ONBOARDING_PURPOSE_QUESTION = `Last one — what brings you to CALEBX?`;

export const onboardingComplete = (name: string, purpose: string): string =>
  `Perfect, ${name}! ${purposeWelcomeSnippet(purpose)} What's been on your mind lately?`;

function purposeWelcomeSnippet(purpose: string): string {
  if (purpose.includes("meet people") && purpose.includes("discover"))
    return "I'll help you connect with people, uncover great spots, and find your communities.";
  if (purpose.includes("meet people"))
    return "I'll keep an eye out for people worth knowing.";
  if (purpose.includes("discover places"))
    return "I'll steer you toward spots that match your vibe.";
  if (purpose.includes("communities")) return "I'll help you find your people.";
  return "I'm here to help you explore.";
}

/**
 * The first-person summary written to long-term memory when onboarding finishes.
 *
 * Byte-identical to the string this project has always written. Existing
 * memories were stored in this exact shape; changing it would make the same
 * fact read two different ways to the model.
 */
export const onboardingSummary = (record: OnboardingRecord): string =>
  `My name is ${record.name ?? "friend"}, I'm ${record.age ?? "unknown age"} years old, based in ${record.city ?? "unknown city"}. I joined CALEBX to: ${record.purpose ?? "explore"}.`;

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

// --- Modes ---

/**
 * Mode-facing copy. The two modes are separate products with separate data
 * practices, so switching into one for the first time asks for its own consent
 * rather than reusing the grant made at /start.
 */
export type ModeName = "matchmaker" | "community_connector";

export const MODE_TITLES: Record<ModeName, string> = {
  matchmaker: "matchmaking",
  community_connector: "places & people",
};

export const MODE_SWITCH_ACCEPT = "mode:accept";
export const MODE_SWITCH_DECLINE = "mode:decline";

export const MODE_SWITCH_ACCEPT_LABEL = "✓ Yes, switch";
export const MODE_SWITCH_DECLINE_LABEL = "Stay here";

export const switchedMessage = (mode: ModeName): string =>
  mode === "matchmaker"
    ? `Switched to matchmaking. Tell me a bit about who you're hoping to meet.`
    : `Switched. So — what part of town are you in these days?`;

export const alreadyInModeMessage = (mode: ModeName): string =>
  `We're already on ${MODE_TITLES[mode]}. What's on your mind?`;

/**
 * Asked before entering a mode for the first time. It names what that mode
 * collects, because that is the thing that differs between them — a general
 * "I agree" made at /start cannot stand in for it.
 */
export const modeConsentRequest = (mode: ModeName): string =>
  mode === "matchmaker"
    ? `Matchmaking works a bit differently.

To find matches I'd keep a matrimonial profile for you — the things you tell me about what you're looking for, and how to reach you when both sides say yes. Contact details are only ever passed on by a person here, never automatically.

Shall we switch over?`
    : `The places-and-people side works a bit differently.

There I'd keep track of the interests, areas and communities you mention, so I can suggest spots and groups that fit. If you ever want to be introduced to someone, I'll ask you separately first — nobody sees anything about you until you say so.

Shall we switch over?`;

export const modeConsentDeclined = `No problem — we'll stay where we are.`;

/** Recommendation ran and found nothing. Honest rather than apologetic. */
export const NOTHING_TO_RECOMMEND = `Nothing worth passing on just yet — I don't know enough about you. Tell me one thing you'd do on a free evening?`;

// --- Discoverability (community mode) ---

export const DISCOVERABLE_ACCEPT = "discoverable:accept";
export const DISCOVERABLE_DECLINE = "discoverable:decline";

export const DISCOVERABLE_REQUEST = `One thing before I introduce anyone.

If you're up for it, I can mention you to people you already share a connection with — just what you're into and roughly where you are. No name, no number, no photo, and nothing more unless you both agree.

Want to be findable that way?`;

export const discoverableSet = (on: boolean): string =>
  on
    ? `Done — I'll keep you in mind when someone's a good fit.`
    : `Understood — I'll keep you out of it.`;

// --- /forget ---

export const forgetConfirmRequest = (hints: CommandHints): string =>
  `Just so we're clear: this erases everything I've learned about you — interests, matches, groups, all of it — across both sides of CALEBX. It cannot be undone.

Send ${hints.forget} again to confirm, or anything else to carry on.`;

export const FORGET_CONFIRM_ACCEPT = "forget:accept";
export const FORGET_CONFIRM_DECLINE = "forget:decline";

export const FORGET_ACCEPT_LABEL = "Delete everything";
export const FORGET_DECLINE_LABEL = "Cancel";

/**
 * Partial failure is reported honestly. Telling someone their data is gone when
 * one store still holds it is worse than admitting the gap.
 */
export const forgetPartialFailure = `I removed most of it, but part didn't clear. I've flagged it for someone here to finish — nothing new is being stored in the meantime.`;

// --- Admin ---

export const REGISTER_GROUP_USAGE = `Usage: /register_group <cohort-key>  — run this inside the group, with the bot as an admin.`;

export const registerGroupDone = (cohortKey: string): string =>
  `Registered this group for ${cohortKey}. Invite link stored.`;

export const REGISTER_GROUP_NOT_ADMIN = `I need to be an admin here before I can create an invite link.`;
