import type { Bot } from "gramio";
import type { IRecommendationStore } from "@calebx/core";
import type { RecommendationView } from "@calebx/types";
import {
  NO_MATCHES_YET,
  recommendationCard,
  recommendationKeyboard,
  REC_HI_PREFIX,
  REC_SKIP_PREFIX,
  REC_SKIPPED,
  REC_WAITING,
  revealMessage,
} from "./recommend.messages.ts";

const HI_RE = new RegExp(`^${REC_HI_PREFIX}(.+)$`);
const SKIP_RE = new RegExp(`^${REC_SKIP_PREFIX}(.+)$`);

/** DMs one recipient the reveal (message + counterpart photo if present). */
async function sendReveal(
  bot: Bot,
  chatId: number,
  view: RecommendationView,
): Promise<void> {
  await bot.api
    .sendMessage({ chat_id: chatId, text: revealMessage(view) })
    .catch(() => undefined);
  if (view.reveal?.photoFileId) {
    await bot.api
      .sendPhoto({ chat_id: chatId, photo: view.reveal.photoFileId })
      .catch(() => undefined);
  }
}

/** The other party's own view of the same edge (edge-gated: their perspective). */
async function counterpartView(
  store: IRecommendationStore,
  id: string,
  otherTelegramId: number,
): Promise<RecommendationView | null> {
  const list = await store.listForUser(otherTelegramId);
  return list.find((v) => v.id === id) ?? null;
}

export function registerRecommendationHandlers(
  bot: Bot,
  store: IRecommendationStore,
): void {
  // "Say hi" — record acceptance; if now mutual, reveal to BOTH sides.
  bot.callbackQuery(HI_RE, async (context) => {
    const telegramId = context.from?.id;
    const id = context.queryData?.[1];
    if (telegramId === undefined || !id) return context.answer();

    const view = await store.accept(id, telegramId);
    if (view === null) return context.answer("That introduction has expired.");

    await context.answer();
    if (view.status !== "revealed") {
      await context.editText(REC_WAITING).catch(() => undefined);
      return;
    }
    // Mutual: reveal to the acceptor here, and DM the other party their own view.
    await context.editText(revealMessage(view)).catch(() => undefined);
    if (view.reveal?.photoFileId) {
      await context.sendPhoto(view.reveal.photoFileId).catch(() => undefined);
    }
    const other = await counterpartView(store, id, view.other.telegramId);
    if (other !== null) await sendReveal(bot, view.other.telegramId, other);
  });

  // "Skip" — decline (silent to the other side).
  bot.callbackQuery(SKIP_RE, async (context) => {
    const telegramId = context.from?.id;
    const id = context.queryData?.[1];
    if (telegramId === undefined || !id) return context.answer();
    await store.decline(id, telegramId);
    await context.answer();
    await context.editText(REC_SKIPPED).catch(() => undefined);
  });

  // /matches — re-show this user's pending/revealed introductions.
  bot.command("matches", async (context) => {
    const telegramId = context.from.id;
    const views = await store.listForUser(telegramId);
    if (views.length === 0) return context.send(NO_MATCHES_YET);
    for (const view of views) {
      if (view.status === "revealed") {
        await context.send(revealMessage(view));
      } else if (view.youAccepted) {
        await context.send(REC_WAITING);
      } else {
        await context.send(recommendationCard(view), {
          reply_markup: recommendationKeyboard(view.id),
        });
      }
    }
  });
}
