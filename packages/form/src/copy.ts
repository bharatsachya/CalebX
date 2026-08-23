/**
 * Every user-facing string the form bot can produce.
 *
 * Same discipline as `packages/channel/src/copy.ts` (CLAUDE.md rule 11): the bot
 * package renders, it does not author. A literal appearing in
 * `telegram-bot/src/form/` is a bug.
 *
 * Markup is HTML, not Markdown, and every interpolated value goes through
 * `escapeHtml`. Telegram rejects malformed entities with a 400, which the user
 * experiences as the bot saying nothing at all — and Markdown breaks on any
 * answer containing an underscore or asterisk, which a real name or address
 * eventually will.
 */

import { FORM_FIELDS } from "./fields.ts";
import { MATCH_COLUMNS, MATCH_REASON_COLUMN } from "./sheet.ts";
import type { FormField, Match } from "./types.ts";

/** Escapes the three characters Telegram's HTML parser treats as markup. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const COMMANDS = {
  start: "/start",
  update: "/update",
  match: "/match",
  skip: "/skip",
  forget: "/forget",
} as const;

export const WELCOME = [
  "Hi — I'll take you through a few questions so a matchmaker can get a proper picture of you.",
  "",
  `It's ${FORM_FIELDS.length} questions. You can stop any time and pick up where you left off with ${COMMANDS.start}.`,
  `Optional questions can be passed with ${COMMANDS.skip}.`,
].join("\n");

/**
 * This bot's own consent copy — deliberately not `@calebx/channel`'s. That
 * copy describes CALEBX's persona engine ("I get to know you through our
 * conversation... suggest people, places, and communities"), which is the
 * wrong pitch for a marriage-matchmaking questionnaire. Same principle as
 * `whatsapp-bot/src/copy.ts`: no sibling channel to stay in parity with, so
 * the framing lives here instead of being borrowed from a different product.
 */
export const NEEDS_CONSENT_NUDGE =
  "Before we start, I need your okay to store what you share.";

export const PRIVACY_NOTICE = [
  "Hi — I'll take you through a short questionnaire so a matchmaker can put together suggestions for you.",
  "",
  "Before we start:",
  "• I store what you tell me — biodata, family details, contact info, and what you're looking for — so a matchmaker can review it.",
  "• Your contact details are kept separate and are never shown to anyone you're matched with. They're shared only if both sides are interested, and only by hand.",
  `• You're in control: send ${COMMANDS.forget} anytime to erase everything and revoke this.`,
  "",
  "Tap below to continue.",
].join("\n");

export const RESUMING = "Picking up where we left off.";

export const RESUMING_PARTIAL =
  "We already have some of your information. Let's complete the remaining details.";

export const REQUEST_PHONE_PROMPT =
  "To find your profile and complete your details, please share your phone number using the button below.";

export const REQUEST_PHONE_BUTTON = "📱 Share my phone number";

export const UNTRUSTED_CONTACT =
  'Please use the "Share my phone number" button below so we can verify your own Telegram account\'s number.';

export const NEW_PROFILE_CREATED =
  "We've created a new profile for you! Let's get started with a few questions.";

export const PHONE_NOT_FOUND =
  "We couldn't find an existing profile matching that phone number. Please contact our team so we can assist you.";

export const PHONE_AMBIGUOUS =
  "We found multiple matching profiles for this number. Please contact our team so we can resolve this safely.";

export const IDENTITY_CONFLICT =
  "This profile is already linked to another Telegram account, or your Telegram account is linked elsewhere. Please contact support.";

export const ALREADY_COMPLETE = [
  "You're all set — I have everything I need.",
  "",
  `${COMMANDS.update} — change any answer`,
  `${COMMANDS.match} — see your matches`,
].join("\n");

export function completed(name: string): string {
  return [
    `Thanks${name ? `, ${escapeHtml(name)}` : ""} — that's everything.`,
    "",
    "A matchmaker will go through your profile and put suggestions together by hand. There's no algorithm doing this bit.",
    "",
    `${COMMANDS.match} — check for suggestions`,
    `${COMMANDS.update} — change an answer`,
  ].join("\n");
}

/** Prefix that gives the user a sense of how much is left. */
export function progress(position: number, sectionLabel: string): string {
  return `Question ${position} of ${FORM_FIELDS.length} · ${sectionLabel}`;
}

export function question(
  field: FormField,
  position: number,
  sectionLabel: string,
): string {
  const lines = [
    `<i>${escapeHtml(progress(position, sectionLabel))}</i>`,
    "",
    `<b>${escapeHtml(field.prompt)}</b>`,
  ];
  if (field.hint) lines.push(`<i>${escapeHtml(field.hint)}</i>`);
  return lines.join("\n");
}

/** Shown when the user starts the sensitive section, so the ask isn't a surprise. */
export const CONTACT_SECTION_NOTICE = [
  "Next few are your contact details.",
  "",
  "These are kept separate from the rest of your profile and are never shown to anyone you're matched with. A matchmaker shares them only if both sides are interested, and only by hand.",
].join("\n");

// ── Validation ───────────────────────────────────────────────────────

export const INVALID_CHOICE =
  "Pick one of the options above — tap a button, or reply with its number.";
export const INVALID_DATE =
  "I need that as DD/MM/YYYY — for example 14/03/1996.";
export const INVALID_INTEGER = "That should be a whole number.";
export const REQUIRED_FIELD = "This one I do need — could you fill it in?";
export const CANNOT_SKIP_REQUIRED = "This one's required, so I can't skip it.";
export const NOTHING_TO_SKIP = `Nothing to skip right now. ${COMMANDS.start} to begin.`;

export function outOfRange(min: number, max: number): string {
  return `That should be between ${min} and ${max}.`;
}

/**
 * `002_candidates.sql` has a CHECK constraint rejecting a married candidate, and
 * `packages/db/src/candidates.repo.ts` mirrors it. The option is never offered,
 * so this only fires if someone types it.
 */
export const MARRIED_NOT_ELIGIBLE =
  "Matchmaking is only for people who aren't currently married, so I can't take that. Pick one of the options above.";

export const AGE_RANGE_INVERTED =
  "That's below the youngest age you gave me — could you give me a higher number?";

// ── /update ──────────────────────────────────────────────────────────

export const UPDATE_PICK_SECTION = "Which part would you like to change?";
export const UPDATE_PICK_FIELD = "Which answer?";
export const UPDATE_CANCELLED = "No changes made.";
export const UPDATE_NOTHING_YET = `You haven't answered anything yet — ${COMMANDS.start} to begin.`;
export const UPDATE_CANCEL_LABEL = "Cancel";
export const UPDATE_BACK_LABEL = "‹ Back";

export function updateAsk(field: FormField): string {
  const lines = [`<b>${escapeHtml(field.prompt)}</b>`];
  if (field.hint) lines.push(`<i>${escapeHtml(field.hint)}</i>`);
  return lines.join("\n");
}

export function updated(field: FormField, value: string): string {
  const label = escapeHtml(field.prompt.replace(/\?$/, ""));
  return `Updated — ${label}: <b>${escapeHtml(value)}</b>`;
}

export function currentValue(value: string): string {
  return `<i>Currently: ${escapeHtml(value)}</i>`;
}

// ── /match ───────────────────────────────────────────────────────────

export const NO_MATCHES = [
  "Nothing yet.",
  "",
  "Matches here are put together by a person, not a program, so they take a little while. I'll have something for you soon.",
].join("\n");

export const MATCH_INCOMPLETE_PROFILE = [
  "Your profile isn't finished yet, so there's nothing to match on.",
  "",
  `${COMMANDS.start} to carry on where you left off.`,
].join("\n");

/**
 * Renders the curated suggestions.
 *
 * Only iterates `MATCH_COLUMNS` and `MATCH_REASON_COLUMN`. There is no branch
 * that could reach a contact field — the `Match` it receives was read from a tab
 * that has no such column.
 */
export function formatMatches(matches: readonly Match[]): string {
  const header =
    matches.length === 1
      ? "One suggestion for you:"
      : `${matches.length} suggestions for you:`;

  const blocks = matches.map((match, index) => {
    const name = match.values["matched_name"]?.trim();
    const heading = name
      ? `<b>${index + 1}. ${escapeHtml(name)}</b>`
      : `<b>${index + 1}.</b>`;
    const lines = [heading];

    for (const column of MATCH_COLUMNS) {
      if (column.id === "matched_name") continue; // already the heading
      const value = match.values[column.id]?.trim();
      if (value) {
        lines.push(`${escapeHtml(column.label)}: ${escapeHtml(value)}`);
      }
    }

    const reason = match.values[MATCH_REASON_COLUMN]?.trim();
    if (reason) lines.push("", `<i>${escapeHtml(reason)}</i>`);

    return lines.join("\n");
  });

  return [header, "", blocks.join("\n\n")].join("\n");
}

// ── Errors ───────────────────────────────────────────────────────────

/** A failed turn still owes the user a reply (CLAUDE.md rule 13). */
export const STORAGE_UNAVAILABLE =
  "I couldn't save that just now — give it another go in a moment.";

export const FORGOTTEN = [
  "Done — your answers and contact details are wiped.",
  "",
  `${COMMANDS.start} if you'd like to begin again.`,
].join("\n");
