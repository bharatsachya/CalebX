import type { Bot } from "gramio";
import type { IUserRepository, ISummaryStore } from "@calebx/core";
import { runAgent, summarizeSession } from "@calebx/agent";
import type { SessionTurn } from "@calebx/types";
import type { SessionStore } from "./session.store.ts";
import type { OnboardingStore } from "./onboarding.store.ts";
import { DAILY_CAP_MESSAGE, PHOTO_SAVED } from "./messages.ts";

const RECENT_TURNS_CONTEXT = 10;
const SUMMARY_LOOKBACK = 5;

export interface ChatDeps {
  session: SessionStore;
  onboarding: OnboardingStore;
  summaryStore: ISummaryStore;
  userRepo: IUserRepository;
  maxDailyMessages: number;
}

/** Distills the session buffer into a stored Summary node, then clears the buffer. */
async function flushSummary(
  telegramId: number,
  turns: SessionTurn[],
  summaryStore: ISummaryStore,
): Promise<void> {
  const summary = await summarizeSession(turns);
  if (summary !== null && summary.summary.trim() !== "") {
    await summaryStore.addSummary(
      telegramId,
      summary.summary,
      summary.interests,
    );
  }
}

export function registerChatHandlers(bot: Bot, deps: ChatDeps): void {
  bot.on("message", async (context) => {
    const telegramId = context.from.id;

    // Photo → store the largest size's file_id (Telegram hosts the bytes).
    if (context.hasAttachmentType("photo")) {
      await deps.userRepo.setPhoto(
        telegramId,
        context.attachment.bigSize.fileId,
      );
      return context.send(PHOTO_SAVED);
    }

    const text = typeof context.text === "string" ? context.text : "";
    if (text.startsWith("/") || text.trim() === "") return;

    const record = await deps.session.get(telegramId);

    // Daily cap reached — no LLM call, gentle nudge to return tomorrow.
    if (record.dailyCount >= deps.maxDailyMessages) {
      return context.send(DAILY_CAP_MESSAGE);
    }

    const onboardingRecord = await deps.onboarding.get(telegramId);
    const profile = {
      name: onboardingRecord.name ?? "",
      city: onboardingRecord.city ?? "",
      purpose: onboardingRecord.purpose ?? "",
    };
    const summaries = await deps.summaryStore.getSummaries(
      telegramId,
      SUMMARY_LOOKBACK,
    );
    const recentTurns = record.turns.slice(-RECENT_TURNS_CONTEXT);

    const reply = await runAgent(profile, summaries, recentTurns, text);

    const now = Date.now();
    const turns: SessionTurn[] = [
      ...record.turns,
      { role: "user", text, at: now },
      { role: "assistant", text: reply, at: now },
    ];
    const dailyCount = record.dailyCount + 1;

    if (dailyCount >= deps.maxDailyMessages) {
      // Hit the cap this turn: summarize the whole session, then clear the buffer.
      await flushSummary(telegramId, turns, deps.summaryStore);
      await deps.session.set(telegramId, {
        turns: [],
        dailyCount,
        day: record.day,
      });
      await context.send(reply);
      return context.send(DAILY_CAP_MESSAGE);
    }

    await deps.session.set(telegramId, { turns, dailyCount, day: record.day });
    return context.send(reply);
  });
}
