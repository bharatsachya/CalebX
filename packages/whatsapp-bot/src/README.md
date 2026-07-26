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
- `render.ts` — buttons (≤3 options) or list (>3), plus numbered text

**Conversation**

- `copy.ts` — every user-facing string for this bot, in one place. No sibling
  channel to keep in parity with, so no shared `@calebx/channel` package here.
- `keywords.ts` — `start` / `forget` / `stop` matching
- `consent.gate.ts` — privacy notice, accept/decline by button or typed reply;
  reads/writes `candidates.consent_granted` via `@calebx/matchmaking`
- `handler.ts` — routing: unsupported → forget → find-or-create candidate →
  consent gate → log message → (signup flow lands in a later PR)
- `whatsapp.ts` — entry point; builds dependencies and listens

This package used to be CALEBX's own WhatsApp channel (shared onboarding FSM
with `telegram-bot` via `@calebx/channel`, a mock HelixDB user). It has been
repurposed to the WhatsApp matchmaking product — a separate product sharing
this monorepo, on Postgres via `@calebx/matchmaking`. CALEBX itself continues
on Telegram only (`packages/telegram-bot`).
