#!/usr/bin/env bun
/**
 * Once-a-day matchmaking run. Flushes stale chat sessions into summaries, scores all
 * matchable users, creates new RECOMMENDED edges, and DMs both sides an anonymised card.
 *
 *   bun run recommend:daily
 *
 * Cron it later; for the MVP it's a manual invocation.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bot } from "gramio";
import { config } from "@calebx/config";
import {
  Neo4jUserRepository,
  Neo4jSummaryStore,
  Neo4jRecommendationStore,
  closeDriver,
} from "@calebx/db";
import { FileSessionStore } from "../packages/telegram-bot/src/session.store.ts";
import { runDailyRecommend } from "../packages/telegram-bot/src/recommend.job.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sessionPath =
  process.env.SESSION_STORE_PATH ??
  path.resolve(__dirname, "../.data/sessions.json");

const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

try {
  const created = await runDailyRecommend({
    bot,
    session: new FileSessionStore(sessionPath),
    userRepo: new Neo4jUserRepository(),
    summaryStore: new Neo4jSummaryStore(),
    recStore: new Neo4jRecommendationStore(),
    minScore: config.MIN_MATCH_SCORE,
    summarizeMinTurns: config.SUMMARIZE_MIN_TURNS,
  });
  console.log(
    `✓ Daily recommend complete — ${created} new introduction(s) sent.`,
  );
} catch (error) {
  console.error("✗ Daily recommend failed:", error);
  process.exitCode = 1;
} finally {
  await closeDriver();
}
