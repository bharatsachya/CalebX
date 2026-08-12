/**
 * WhatsApp has no slash commands, so the two always-available actions are
 * matched as plain-text keywords.
 *
 * Meta does NOT intercept "stop" on the Cloud API — that is a BSP/marketing
 * convention. The message arrives at our webhook like any other, and honouring
 * it is our obligation.
 */

const START_WORDS = new Set(["start", "restart", "begin"]);

const FORGET_WORDS = new Set([
  "forget",
  "stop",
  "unsubscribe",
  "opt out",
  "optout",
  "delete my data",
]);

export type Keyword = "start" | "forget";

/**
 * Note what is deliberately absent: greetings. Mapping "hi"/"hello" to start
 * would mean a returning user saying hi gets the welcome-back message instead
 * of a real reply. A brand-new user's first message already triggers the
 * privacy notice via the consent gate, so no greeting keyword is needed.
 */
export function matchKeyword(text: string): Keyword | null {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (START_WORDS.has(normalized)) return "start";
  if (FORGET_WORDS.has(normalized)) return "forget";
  return null;
}
