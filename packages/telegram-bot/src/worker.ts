import { Bot, webhookHandler } from "gramio";
import { loadConfig } from "@calebx/config";
import type { Env, ExecutionContext, ScheduledEvent } from "./env.ts";
import { buildDeps, createBot, type BotDeps } from "./bot.ts";
import { runDailyRecommend } from "./recommend.job.ts";

interface Ready {
  bot: Bot;
  deps: BotDeps;
  handler: (request: Request) => Response | Promise<Response>;
}

// Memoized per isolate. The first request builds the bot, initialises it (getMe),
// and constructs the webhook handler; subsequent requests reuse it.
let ready: Promise<Ready> | null = null;

function getReady(env: Env): Promise<Ready> {
  if (ready === null) {
    ready = (async () => {
      const config = loadConfig(env);
      const deps = buildDeps(env);
      const bot = createBot(deps);
      // getMe populates bot.info for @mention command matching; tolerate failure.
      await bot.init().catch(() => undefined);
      // shouldWait makes the handler async (awaits handleUpdate, then returns the
      // Response) though gramio types it as sync — cast through unknown.
      const handler = webhookHandler(bot, "cloudflare", {
        secretToken: config.TELEGRAM_WEBHOOK_SECRET,
        shouldWait: true, // Workers kill un-awaited work; await handling before 200
      }) as unknown as (request: Request) => Response | Promise<Response>;
      return { bot, deps, handler };
    })();
  }
  return ready;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      loadConfig(env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      return new Response(`Config error:\n${message}`, { status: 500 });
    }

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }
    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const { handler } = await getReady(env);
    try {
      return await handler(request);
    } catch (error) {
      // Swallow to 200 so Telegram does not retry a poisoned update forever.
      console.error("webhook handler error", error);
      return new Response("ok", { status: 200 });
    }
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const config = loadConfig(env);
    const { bot, deps } = await getReady(env);
    ctx.waitUntil(
      runDailyRecommend({
        bot,
        session: deps.session,
        userRepo: deps.userRepo,
        summaryStore: deps.summaryStore,
        recStore: deps.recStore,
        minScore: config.MIN_MATCH_SCORE,
        summarizeMinTurns: config.SUMMARIZE_MIN_TURNS,
      }).catch((error) => {
        console.error("daily recommend failed", error);
      }),
    );
  },
};
