/**
 * `bun run --cwd packages/queue worker:dispatch`
 *
 * The only process that talks to Telegram's send API, and the only one that may:
 * the 30/s limit is global, so a second dispatch worker would pace against its
 * own state and know nothing of the first one's sends. Concurrency is 1 for the
 * same reason.
 *
 * It also owns the typing indicator: chat actions expire after ~5s and count
 * against the same budget as replies, so the repeat loop belongs on the same
 * side of the pacer as the sends.
 */
import { Worker } from "bullmq";
import { Bot } from "gramio";
import { env } from "@calebx/config";
import { initTracing, withTrace } from "@calebx/trace";
import { dispatchOnce, type Sender } from "../dispatch.ts";
import { SendPacer } from "../limiter.ts";
import { CONCURRENCY, QUEUE_NAMES, parseDispatchJob } from "../payloads.ts";
import { createSubscriber, enqueueDispatch, getConnection } from "../queues.ts";
import { TYPING_CHANNEL, TypingLoop, decodeTypingEvent } from "../typing.ts";

initTracing("dispatch-worker");

const e = env("dispatch");
const bot = new Bot(e.requiredOrExit("TELEGRAM_BOT_TOKEN"));

const pacer = new SendPacer();
const typing = new TypingLoop({ pacer });

const telegram: Sender = {
  async send(job) {
    await bot.api.sendMessage({
      chat_id: Number(job.chatId),
      text: job.text,
      parse_mode: job.parseMode,
    });
  },
};

/**
 * WhatsApp is not sent from here yet — its Cloud API has its own per-number
 * limits and its own send path in `packages/whatsapp-bot`. Declaring it
 * explicitly beats silently dropping the job.
 */
const whatsapp: Sender = {
  async send(job) {
    throw new Error(
      `WhatsApp dispatch is not handled by this worker (chat ${job.chatId})`,
    );
  },
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

new Worker(
  QUEUE_NAMES.dispatch,
  async (job) => {
    const payload = parseDispatchJob(job.data);
    return withTrace(
      "job.dispatch",
      { jobId: job.id, traceId: payload.traceId },
      { kind: "dispatch" },
      async () => {
        const result = await dispatchOnce(
          {
            senders: { tg: telegram, wa: whatsapp },
            pacer,
            sleep,
            requeue: (requeued, delayMs) => enqueueDispatch(requeued, delayMs),
          },
          payload,
        );
        if (result.kind === "failed") throw result.error;
        return result;
      },
    );
  },
  {
    connection: getConnection(),
    concurrency: CONCURRENCY[QUEUE_NAMES.dispatch],
  },
);

// --- typing indicator ---

const subscriber = createSubscriber();
await subscriber.subscribe(TYPING_CHANNEL);
subscriber.on("message", (_channel: string, message: string) => {
  const event = decodeTypingEvent(message);
  if (event) typing.apply(event);
});

setInterval(() => {
  for (const { chatId, delayMs } of typing.due()) {
    setTimeout(() => {
      void bot.api
        .sendChatAction({ chat_id: Number(chatId), action: "typing" })
        // A failed chat action is cosmetic; never let it take down the worker.
        .catch(() => undefined);
    }, delayMs);
  }
}, 500);

process.stdout.write("[dispatch-worker] listening\n");
