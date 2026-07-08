import type { Bot } from "gramio";
import {
  pickRecommendations,
  type IRecommendationStore,
  type ISummaryStore,
  type IUserRepository,
} from "@calebx/core";
import { summarizeSession } from "@calebx/agent";
import type { MatchableUser } from "@calebx/types";
import type { SessionStore } from "./session.store.ts";
import {
  recommendationCard,
  recommendationKeyboard,
} from "./recommend.messages.ts";

export interface DailyRecommendDeps {
  bot: Bot;
  session: SessionStore;
  userRepo: IUserRepository;
  summaryStore: ISummaryStore;
  recStore: IRecommendationStore;
  minScore: number;
  summarizeMinTurns: number;
  /** Max new recommendations per user in one run. */
  maxPerUser?: number;
}

/**
 * The once-a-day batch: flush any un-summarized sessions into Summary nodes, score all
 * matchable users, create RECOMMENDED edges for the best new pairs, and DM both sides
 * an anonymised card. Idempotent-ish: pairs already recommended are never repeated.
 * Returns the number of new recommendations created.
 */
export async function runDailyRecommend(
  deps: DailyRecommendDeps,
): Promise<number> {
  // 1. Flush stale session buffers so today's chats feed matching.
  const ids = await deps.session.allIds();
  for (const id of ids) {
    const record = await deps.session.get(id);
    if (record.turns.length >= deps.summarizeMinTurns) {
      const summary = await summarizeSession(record.turns);
      if (summary !== null && summary.summary.trim() !== "") {
        await deps.summaryStore.addSummary(
          id,
          summary.summary,
          summary.interests,
        );
      }
      await deps.session.set(id, {
        turns: [],
        dailyCount: record.dailyCount,
        day: record.day,
      });
    }
  }

  // 2. Score + pick new pairs.
  const users: MatchableUser[] = await deps.userRepo.listMatchable();
  const existing = await deps.recStore.existingPairKeys();
  const picks = pickRecommendations(users, {
    minScore: deps.minScore,
    existingPairs: existing,
    maxPerUser: deps.maxPerUser ?? 1,
  });

  // 3. Persist edges + notify both sides with anonymised cards.
  for (const pick of picks) {
    const rec = await deps.recStore.create(
      pick.aTelegramId,
      pick.bTelegramId,
      pick.score,
      pick.shared,
    );
    await notify(deps.bot, deps.recStore, rec.id, pick.aTelegramId);
    await notify(deps.bot, deps.recStore, rec.id, pick.bTelegramId);
  }
  return picks.length;
}

/** Sends one user their edge-gated card for a freshly created recommendation. */
async function notify(
  bot: Bot,
  recStore: IRecommendationStore,
  id: string,
  telegramId: number,
): Promise<void> {
  const views = await recStore.listForUser(telegramId);
  const view = views.find((v) => v.id === id);
  if (view === undefined) return;
  await bot.api
    .sendMessage({
      chat_id: telegramId,
      text: recommendationCard(view),
      reply_markup: recommendationKeyboard(view.id),
    })
    .catch(() => undefined);
}
