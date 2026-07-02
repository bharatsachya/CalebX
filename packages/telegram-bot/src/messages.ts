import { InlineKeyboard } from "gramio";

// --- Consent ---

export const CONSENT_ACCEPT = "consent:accept";
export const CONSENT_DECLINE = "consent:decline";

export const PRIVACY_NOTICE = `👋 Hi, I'm CALEBX.

I get to know you through our conversation, and over time I can suggest people, places, and communities that fit you.

Before we start, here's the deal:
• I store interests and topics I pick up from our chats — not your raw messages.
• I use them only to make suggestions inside CALEBX.
• You're in control: send /forget anytime to erase everything I've learned and revoke this.

Tap below to continue.`;

export const consentKeyboard = new InlineKeyboard()
  .text("✓ I agree — let's talk", CONSENT_ACCEPT)
  .row()
  .text("Not now", CONSENT_DECLINE);

export const ACCEPTED_MESSAGE = `Great — let me ask you a few quick things first.`;

export const DECLINED_MESSAGE = `No problem — I won't store anything. If you change your mind, just send /start.`;

export const WELCOME_BACK = `Welcome back. Pick up wherever you like — what's new?`;

export const FORGOTTEN_MESSAGE = `Done. I've erased what I'd learned and revoked your consent. Send /start if you ever want to begin again.`;

export const NEEDS_CONSENT_NUDGE = `Before I can chat, I need your okay to learn from our conversation.`;

// --- Onboarding ---

export const ONBOARDING_NAME_QUESTION = `What should I call you?`;

export const onboardingCityQuestion = (name: string) =>
  `Nice to meet you, ${name}! Which city are you based in?`;

export const ONBOARDING_AGE_QUESTION = `And roughly how old are you?`;

export const ONBOARDING_PURPOSE_QUESTION = `Last one — what brings you to CALEBX?`;

export const onboardingComplete = (name: string, purpose: string): string => {
  const snippet = purposeWelcomeSnippet(purpose);
  return `Perfect, ${name}! ${snippet} What's been on your mind lately?`;
};

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

// Onboarding callback IDs
export const ONBOARDING_AGE_OPTIONS = [
  "18-24",
  "25-34",
  "35-44",
  "45+",
] as const;
export type AgeOption = (typeof ONBOARDING_AGE_OPTIONS)[number];

export const ONBOARDING_PURPOSE_MEET = "onboarding:purpose:meet";
export const ONBOARDING_PURPOSE_PLACES = "onboarding:purpose:places";
export const ONBOARDING_PURPOSE_COMMUNITIES = "onboarding:purpose:communities";
export const ONBOARDING_PURPOSE_ALL = "onboarding:purpose:all";

// Onboarding keyboards
export const ageKeyboard = new InlineKeyboard()
  .text("18–24", "onboarding:age:18-24")
  .text("25–34", "onboarding:age:25-34")
  .row()
  .text("35–44", "onboarding:age:35-44")
  .text("45+", "onboarding:age:45+");

export const purposeKeyboard = new InlineKeyboard()
  .text("Meet people", ONBOARDING_PURPOSE_MEET)
  .row()
  .text("Discover places", ONBOARDING_PURPOSE_PLACES)
  .row()
  .text("Find communities", ONBOARDING_PURPOSE_COMMUNITIES)
  .row()
  .text("All of the above ✨", ONBOARDING_PURPOSE_ALL);
