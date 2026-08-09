# @calebx/whatsapp-bot

WhatsApp delivery adapter for the **matchmaking product**, on the official
Meta Cloud API. This is a separate product from CALEBX sharing this
monorepo. CALEBX's own WhatsApp presence used to live in this package; it has
been repurposed, and CALEBX continues on Telegram only
(`packages/telegram-bot`).

A thin boundary: it receives webhooks, verifies them, and translates between
WhatsApp's wire format and `@calebx/db`'s Postgres-backed matchmaking domain.
Consent and (eventually) the biodata signup flow live in this package's own
`copy.ts`/`consent.gate.ts` — there's no sibling channel to keep in parity
with, so unlike CALEBX there is no shared `@calebx/channel` dependency here.

## Running it

```bash
WHATSAPP_DRY_RUN=true bun run bot:whatsapp
```

Dry run logs outbound payloads instead of calling Graph, so the full
consent → onboarding → agent flow can be exercised **with no Meta account**.
Only `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` are required in that
mode (the webhook is a public endpoint either way, so it always verifies).

Exercise it without a tunnel using the signing helper:

```bash
bun run scripts/wa-post.ts text          # a normal message
bun run scripts/wa-post.ts status        # a delivery receipt (must be ignored)
bun run scripts/wa-post.ts --list        # all fixtures
```

## Connecting a real number

1. Expose the port: `cloudflared tunnel --url http://localhost:8787`
   (Meta requires HTTPS with a valid certificate.)
2. Meta App → WhatsApp → Configuration → Callback URL `https://<tunnel>/webhook`,
   Verify token = your `WHATSAPP_VERIFY_TOKEN` → **Verify and Save**.
3. Webhook fields → subscribe to **`messages` only**. Never subscribe to
   `smb_message_echoes`: it feeds our own outbound messages back in as inbound
   and the bot will talk to itself forever.

Two things that cost people an afternoon: the test number's access token
expires after **24 hours** (create a System User token instead), and a dev
number can only message up to 5 pre-registered recipients.

## Things the platform makes you get right

- **Signatures are computed over the raw bytes.** Re-serialising parsed JSON
  will not reproduce Meta's escaping, and the HMAC will never match. The key is
  the app secret, not the access token.
- **Acknowledge before processing.** Meta retries anything it doesn't see a 200
  for within ~30s, and a turn takes seconds. The server 200s first and processes
  detached.
- **Retries are re-deliveries, not new messages.** They are deduped by `wamid`,
  and anything older than `WHATSAPP_MAX_MESSAGE_AGE_SECONDS` is dropped —
  in-memory dedupe is lost on restart, and Meta retries for up to 7 days.
- **Delivery receipts arrive on the `messages` webhook field**, carrying a
  `statuses` array instead of a `messages` array. They must not be treated as
  inbound messages.
- **Reply to the exact `wa_id` from the payload.** For some countries (+52
  Mexico, +54 Argentina) it differs from the number the user dialled from.
- **The 24-hour customer-service window.** This bot is purely reactive, so every
  send happens inside it and no message templates are needed. That holds only as
  long as the bot never initiates a conversation — adding a nudge or a digest
  would require an approved template and a separate opt-in.
- **Meta does not intercept "stop".** Opt-out keywords are our responsibility;
  `FORGET`/`STOP` are handled here.
