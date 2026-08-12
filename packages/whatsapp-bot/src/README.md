# packages/whatsapp-bot/src

WhatsApp Cloud API adapter. Zero runtime dependencies beyond `dotenv` — the
HTTP server is `node:http` and the Graph client is global `fetch`.

**Transport**

- `config.ts` — env reads from the root `.env`; dry-run relaxes Graph credentials
- `server.ts` — `node:http` endpoint: GET verify handshake, POST
  verify-signature → ack 200 → dedupe → staleness → enqueue
- `signature.ts` — `X-Hub-Signature-256` HMAC over the raw bytes
- `raw-body.ts` — size-capped `Buffer` collector (never string-joined)
- `webhook.types.ts` — inbound payload shapes, all fields optional
- `webhook.parse.ts` — payload → `InboundMessage[]`; drops `statuses`/`errors`
- `dedupe.ts` — synchronous TTL+LRU `wamid` map
- `queue.ts` — per-user serial chain, concurrent across users
- `client.ts` — Graph POST, text chunking, read receipt + typing, dry run
- `render.ts` — `Prompt` → buttons (≤3 options) or list (>3), plus numbered text

**Conversation**

- `keywords.ts` — `start` / `forget` / `stop` matching
- `consent.flow.ts` — privacy notice, accept/decline by button or typed reply
- `onboarding.flow.ts` — drives the shared FSM; adds the typed-answer fallback
- `handler.ts` — routing: unsupported → forget → consent → start → onboarding → agent
- `whatsapp.ts` — entry point; builds dependencies and listens
