/**
 * Every user-facing string, in one place. This bot has no sibling channel to
 * stay in parity with (unlike CALEBX's telegram-bot/whatsapp-bot pair), so
 * there is no shared @calebx/channel package here — the copy just lives next
 * to the one bot that renders it.
 */

export const START_WORD = "START";
export const FORGET_WORD = "FORGET";

export const CONSENT_ACCEPT = "consent:accept";
export const CONSENT_DECLINE = "consent:decline";

// WhatsApp caps reply-button titles at 20 characters.
export const CONSENT_ACCEPT_LABEL = "✓ I agree";
export const CONSENT_DECLINE_LABEL = "Not now";

export const PRIVACY_NOTICE = `👋 Hi! This is CALEBX Matchmaking.

A quick note before we begin:
• We store the details you (or your family) share here — age, education, city, community, and similar — to find suitable matches.
• We never share your contact details with anyone without your permission. A match only happens when both sides say yes, and even then contact is shared manually, not automatically.
• You're in control: send ${FORGET_WORD} anytime to withdraw and revoke this consent.

Tap below to continue.`;

export const ACCEPTED_MESSAGE =
  "Thank you! Let's get started — we'll ask a few questions to build the profile.";

export const DECLINED_MESSAGE = `No problem — we won't store anything. If you change your mind, just send ${START_WORD}.`;

export const FORGOTTEN_MESSAGE = `Done — your consent has been withdrawn. Send ${START_WORD} if you'd like to begin again.`;

export const NEEDS_CONSENT_NUDGE =
  "Before we continue, we need your okay to store your details.";

/** Shown when a typed answer doesn't match any offered option. */
export const CHOICE_NOT_UNDERSTOOD =
  "Sorry, we didn't catch that — please tap an option below.";

/** Sent when a user shares media before we ask for one. */
export const UNSUPPORTED_MESSAGE =
  "We can only read text for now — please reply with a message.";

/** Placeholder until the biodata signup flow (a later PR) replaces it. */
export const SIGNUP_COMING_SOON =
  "We're setting up your profile questions — we'll message you shortly with the next step.";
