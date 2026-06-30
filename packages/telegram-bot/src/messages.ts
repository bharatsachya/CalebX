import { InlineKeyboard } from "gramio";

/** Callback-data payloads for the consent buttons. */
export const CONSENT_ACCEPT = "consent:accept";
export const CONSENT_DECLINE = "consent:decline";

export const PRIVACY_NOTICE = `👋 Hi, I'm CALEBX.

I get to know you through our conversation, and over time I can suggest people, places, and communities that fit you.

Before we start, here's the deal:
• I store interests and topics I pick up from our chats — not your raw messages.
• I use them only to make suggestions inside CALEBX.
• You're in control: send /forget anytime to erase everything I've learned and revoke this.

Tap below to continue.`;

/** Two stacked buttons: agree / not now. */
export const consentKeyboard = new InlineKeyboard()
  .text("✓ I agree — let's talk", CONSENT_ACCEPT)
  .row()
  .text("Not now", CONSENT_DECLINE);

export const ACCEPTED_MESSAGE = `Great — thanks. Tell me a bit about what's on your mind lately, and we'll take it from there.`;

export const DECLINED_MESSAGE = `No problem — I won't store anything. If you change your mind, just send /start.`;

export const WELCOME_BACK = `Welcome back. Pick up wherever you like — what's new?`;

export const FORGOTTEN_MESSAGE = `Done. I've erased what I'd learned and revoked your consent. Send /start if you ever want to begin again.`;

export const NEEDS_CONSENT_NUDGE = `Before I can chat, I need your okay to learn from our conversation.`;
