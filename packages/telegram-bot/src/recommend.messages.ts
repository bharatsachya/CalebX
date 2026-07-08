import { InlineKeyboard } from "gramio";
import type { RecommendationView } from "@calebx/types";

export const REC_HI_PREFIX = "rec:hi:";
export const REC_SKIP_PREFIX = "rec:skip:";

/** Anonymised card: first name, age, city, shared interests. No @username, no photo. */
export function recommendationCard(view: RecommendationView): string {
  const { name, age, city } = view.other;
  const lines = [
    `✨ I think you two would click.`,
    ``,
    `${name || "Someone"}${age ? `, ${age}` : ""}${city ? ` · ${city}` : ""}`,
  ];
  if (view.shared.length > 0) {
    lines.push(`You both mentioned: ${view.shared.join(", ")}`);
  }
  lines.push(``, `Want to say hi? If you both do, I'll introduce you.`);
  return lines.join("\n");
}

export function recommendationKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("👋 Say hi", `${REC_HI_PREFIX}${id}`)
    .text("Skip", `${REC_SKIP_PREFIX}${id}`);
}

export const REC_WAITING = `Nice — I've let them know someone's keen. If they say hi back, I'll connect you.`;

export const REC_SKIPPED = `No worries, skipped. I'll keep looking for a better fit.`;

/** Shown to each side once BOTH have accepted. Includes @username to start a DM. */
export function revealMessage(view: RecommendationView): string {
  const handle = view.reveal?.username
    ? `@${view.reveal.username}`
    : "(no username set — ask me and I'll nudge them)";
  const shared =
    view.shared.length > 0
      ? ` You both mentioned: ${view.shared.join(", ")}.`
      : "";
  return `🎉 You're both in! Say hi to ${view.other.name || "them"} — ${handle}.${shared}`;
}

export const NO_MATCHES_YET = `No introductions yet — keep chatting with me and I'll find people who fit. I refresh matches once a day.`;
