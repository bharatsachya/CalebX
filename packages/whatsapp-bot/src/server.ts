import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { WhatsAppConfig } from "./config.ts";
import { MessageDedupe } from "./dedupe.ts";
import { UserQueue } from "./queue.ts";
import { readRawBody } from "./raw-body.ts";
import { verifySignature } from "./signature.ts";
import { parseInbound } from "./webhook.parse.ts";
import type { InboundMessage } from "./webhook.types.ts";

export interface ServerDeps {
  config: WhatsAppConfig;
  dedupe: MessageDedupe;
  queue: UserQueue;
  onMessage: (message: InboundMessage) => Promise<void>;
}

/**
 * The Cloud API webhook endpoint.
 *
 * Uses node:http rather than Bun.serve on purpose: @types/bun is not in the
 * lockfile, so Bun globals typecheck locally but fail in CI, which installs
 * with --frozen-lockfile.
 */
export function createWebhookServer(deps: ServerDeps): Server {
  return createServer((req, res) => handle(req, res, deps));
}

function handle(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): void {
  // req.url is path + query only, so URL needs a base to parse against.
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname !== deps.config.webhookPath) {
    res.writeHead(404).end();
    return;
  }

  if (req.method === "GET") {
    handleVerification(url, res, deps.config);
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }

  void handleDelivery(req, res, deps);
}

/**
 * Meta's subscription handshake. The challenge must be echoed back verbatim as
 * plain text — no JSON wrapper, no quotes, no trailing newline — or the
 * callback URL will not verify.
 */
function handleVerification(
  url: URL,
  res: ServerResponse,
  config: WhatsAppConfig,
): void {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === config.verifyToken && challenge) {
    res.writeHead(200, { "content-type": "text/plain" }).end(challenge);
    console.log("[whatsapp] webhook verified");
    return;
  }

  console.warn("[whatsapp] webhook verification rejected");
  res.writeHead(403).end();
}

async function handleDelivery(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const { config, dedupe, queue, onMessage } = deps;

  let raw: Buffer;
  try {
    raw = await readRawBody(req);
  } catch {
    res.writeHead(413).end();
    return;
  }

  // Verified against the raw bytes — see signature.ts.
  if (
    !verifySignature(raw, req.headers["x-hub-signature-256"], config.appSecret)
  ) {
    // 401, not 200: a bad signature means this isn't Meta, so there is no retry
    // storm to avoid, and the rejection should be visible in the logs.
    console.warn("[whatsapp] rejected delivery with an invalid signature");
    res.writeHead(401).end();
    return;
  }

  // ---- Acknowledge FIRST. Meta retries anything it doesn't see 200 for in
  // ~30s, and runAgent takes seconds. Everything below runs detached. ----
  res.writeHead(200, { "content-type": "text/plain" }).end("EVENT_RECEIVED");

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    // Signature was valid, so retrying yields the same unparseable bytes
    // forever. Already 200'd, which is what we want.
    console.warn("[whatsapp] unparseable body after a valid signature");
    return;
  }

  for (const message of parseInbound(payload)) {
    // Synchronous check-and-set: no await between the check and the mark, so
    // two concurrent deliveries of one wamid cannot both win.
    if (!dedupe.markIfNew(message.messageId)) {
      console.log(`[whatsapp] duplicate ${message.messageId}, skipping`);
      continue;
    }

    const ageSeconds = (Date.now() - message.timestampMs) / 1000;
    if (ageSeconds > config.maxMessageAgeSeconds) {
      console.log(
        `[whatsapp] stale message (${ageSeconds.toFixed(0)}s old), skipping`,
      );
      continue;
    }

    queue.run(message.userId, () => onMessage(message));
  }
}
