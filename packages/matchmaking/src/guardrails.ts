import { ForbiddenError } from "@calebx/errors";

/**
 * The last line of defence before a tool result reaches the model.
 *
 * Contact details are only ever revealed by a human coordinator, so a phone
 * number or email in a tool payload means something upstream is wrong — a
 * projection was skipped, a new column was added to a SELECT, a free-text field
 * happens to contain a number someone typed into their biodata. Any of those is
 * a leak once the model sees it, because the model will helpfully repeat it.
 *
 * Scanning the serialised payload rather than named fields is deliberate: the
 * fields that leak are the ones nobody thought to check.
 */

/** +91 98765 43210, 9876543210, (080) 4123-4567 — 8+ digits with separators. */
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;

/** t.me/+abc, wa.me/91…, chat.whatsapp.com/… */
const CONTACT_LINK =
  /(?:t\.me\/|wa\.me\/|chat\.whatsapp\.com\/|@[A-Za-z]\w{4,})/;

export interface LeakCheckOptions {
  /**
   * Set once a coordinator advanced the match to `contact_shared`. Only then may
   * a payload legitimately carry contact details.
   */
  contactUnlocked?: boolean;
  /** Fields allowed to contain digit runs (ages, incomes, counts). */
  allowNumericFields?: string[];
}

function scrubAllowedNumbers(
  serialized: string,
  payload: unknown,
  allowed: string[],
): string {
  if (typeof payload !== "object" || payload === null) return serialized;
  let out = serialized;
  for (const field of allowed) {
    const value = (payload as Record<string, unknown>)[field];
    if (typeof value === "number" || typeof value === "string") {
      out = out.split(String(value)).join("<num>");
    }
  }
  return out;
}

/**
 * Throws `ForbiddenError` if the payload appears to contain contact details.
 *
 * Deliberately fails closed. A false positive is a tool result the agent has to
 * rephrase; a false negative is a stranger's phone number in a chat message.
 */
export function assertNoContactLeak(
  payload: unknown,
  options: LeakCheckOptions = {},
): void {
  if (options.contactUnlocked === true) return;

  const serialized = JSON.stringify(payload ?? null);
  const scanned = scrubAllowedNumbers(
    serialized,
    payload,
    options.allowNumericFields ?? [],
  );

  if (EMAIL.test(scanned)) {
    throw new ForbiddenError(
      "tool payload contains an email address",
      "leak:email",
    );
  }
  if (CONTACT_LINK.test(scanned)) {
    throw new ForbiddenError(
      "tool payload contains a contact link",
      "leak:link",
    );
  }
  if (PHONE.test(scanned)) {
    throw new ForbiddenError(
      "tool payload contains a phone number",
      "leak:phone",
    );
  }
}

/**
 * Topics the matchmaker mode declines.
 *
 * Declining is done in persona by the model; this exists so the *tools* cannot
 * be used for it — a matchmaker tool asked for a cafe should refuse rather than
 * quietly search candidates with a nonsense query.
 */
export const OFF_MODE_HINTS = [
  "cafe",
  "coffee shop",
  "coworking",
  "co-working",
  "hangout",
  // Both spellings: people write "hang out" far more often than "hangout",
  // and a hint list that only matches the compound word matches almost nothing.
  "hang out",
  "meetup",
  "meet up",
  "gym",
  "nightlife",
  "restaurant",
  "join a group",
] as const;

export function looksOffMode(text: string): boolean {
  const lower = text.toLowerCase();
  return OFF_MODE_HINTS.some((hint) => lower.includes(hint));
}
