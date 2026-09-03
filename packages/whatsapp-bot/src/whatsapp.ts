import { addMemory } from "@calebx/agent";
import { buildAgentDeps, createInlineRunner } from "@calebx/queue";
import { initTracing } from "@calebx/trace";
import { parseUserId } from "@calebx/channel";
import { FileConsentStore, FileOnboardingStore } from "@calebx/channel";
import { PostgresUserRepository } from "@calebx/db";
import { WhatsAppClient } from "./client.ts";
import { config } from "./config.ts";
import { MessageDedupe } from "./dedupe.ts";
import { handleMessage } from "./handler.ts";
import { UserQueue } from "./queue.ts";
import { createWebhookServer } from "./server.ts";

initTracing("whatsapp");

const client = new WhatsAppClient(config);
const consent = new FileConsentStore(config.consentStorePath);
const onboarding = new FileOnboardingStore(config.onboardingStorePath);
const users = new PostgresUserRepository();

const dedupe = new MessageDedupe();
const queue = new UserQueue();

const agentDeps = await buildAgentDeps();

/**
 * WhatsApp always runs the turn inline.
 *
 * The queued path exists for Telegram, whose 30/s global limit needs a single
 * dispatch worker. WhatsApp's Cloud API has its own per-number limits and its
 * own send path here, and this package already serialises per user through
 * `UserQueue` — routing it through the Telegram dispatch worker would buy
 * nothing and break the acknowledgement contract Meta expects.
 */
const runner = createInlineRunner(agentDeps);

const runAgent = async (
  userId: string,
  message: string,
  channel?: string,
): Promise<string> => {
  const outbound = await runner.run({
    userId,
    chatId: parseUserId(userId)?.nativeId ?? userId,
    text: message,
    channel: channel ?? "WhatsApp",
  });
  return outbound.map((entry) => entry.text).join("\n\n");
};

const rememberTurn = (
  userId: string,
  message: string,
  response: string,
): Promise<void> =>
  addMemory(userId, null, message, response).then(() => undefined);

const server = createWebhookServer({
  config,
  dedupe,
  queue,
  onMessage: (message) =>
    handleMessage(message, {
      client,
      consent,
      onboarding,
      users,
      runAgent,
      addMemory: rememberTurn,
    }),
});

server.listen(config.port, () => {
  const mode = config.dryRun ? " [DRY RUN — sends are logged, not sent]" : "";
  console.log(
    `✨ CALEBX WhatsApp webhook listening on :${config.port}${config.webhookPath}${mode}`,
  );
});

// Meta keeps retrying anything we drop, so finish in-flight work before exiting.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[whatsapp] ${signal} received, draining…`);
    server.close(() => {
      void queue.drain().then(() => process.exit(0));
    });
  });
}

export default server;
