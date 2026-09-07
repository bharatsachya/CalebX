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

// --- Conversational Layer-1 Onboarding Questions ---

export const ONBOARDING_NAME_QUESTION = `What should we call you?`;

export const onboardingCityQuestion = (name: string): string =>
  `Nice to meet you, ${name}! Which city are you based in?`;

export const ONBOARDING_AGE_QUESTION = `And roughly how old are you?`;

export const ONBOARDING_PURPOSE_QUESTION = `Last one — what kind of connection are you looking for on Bettle?`;

// Layer-1 Matchmaking Question Conversational Prompts
export const OWNER_TYPE_QUESTION = `Who are you filling this profile for?`;
export const GENDER_QUESTION = `What is your gender?`;
export const DOB_QUESTION = `What is your date of birth?`;
export const CITY_QUESTION = `Which city are you based in?`;
export const HEIGHT_QUESTION = `What is your height, in centimetres?`;
export const MARITAL_STATUS_QUESTION = `What is your marital status?`;
export const OCCUPATION_QUESTION = `What do you do?`;
export const EDUCATION_QUESTION = `What is your highest level of education?`;
export const INCOME_QUESTION = `What is your personal annual income?`;
export const FAMILY_BACKGROUND_QUESTION = `Tell us a little about your family background.`;
export const AGE_RANGE_QUESTION = `What age range are you looking for?`;
export const LOCATION_PREF_QUESTION = `Where would you be comfortable with your partner being based?`;
export const COMMUNITY_EXCLUSION_QUESTION = `Are there any communities or regions you would not consider?`;
export const PARTNER_INCOME_QUESTION = `Is there a minimum income you would prefer for your partner?`;
export const PARTNER_EDUCATION_QUESTION = `Is there an education level you prefer in your partner?`;
export const PARTNER_DIET_QUESTION = `Do you have a preference regarding your partner's diet?`;
export const PHONE_QUESTION = `Best phone number to reach you on?`;
export const EMAIL_QUESTION = `And an email address?`;

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
