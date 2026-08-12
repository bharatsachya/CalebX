import { runAgent, addMemory } from "@calebx/agent";
import { FileConsentStore, FileOnboardingStore } from "@calebx/channel";
import { HelixUserRepository } from "@calebx/db";
import { WhatsAppClient } from "./client.ts";
import { config } from "./config.ts";
import { MessageDedupe } from "./dedupe.ts";
import { handleMessage } from "./handler.ts";
import { UserQueue } from "./queue.ts";
import { createWebhookServer } from "./server.ts";

const client = new WhatsAppClient(config);
const consent = new FileConsentStore(config.consentStorePath);
const onboarding = new FileOnboardingStore(config.onboardingStorePath);
const users = new HelixUserRepository();

const dedupe = new MessageDedupe();
const queue = new UserQueue();

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
      addMemory,
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
