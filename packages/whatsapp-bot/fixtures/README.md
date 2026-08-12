# packages/whatsapp-bot/fixtures

Recorded-shape WhatsApp Cloud API webhook bodies, used to exercise the endpoint
without a Meta account. Post one with `bun run scripts/wa-post.ts <name>`, which
signs it with `WHATSAPP_APP_SECRET` exactly as Meta would.

| Fixture             | Shape                         | Expected behaviour                         |
| ------------------- | ----------------------------- | ------------------------------------------ |
| `text.json`         | plain text message            | routed to the handler, one reply           |
| `button_reply.json` | interactive reply button tap  | consent accept                             |
| `list_reply.json`   | interactive list row tap      | advances an onboarding choice step         |
| `status.json`       | delivery receipt              | **ignored** — no reply, no agent call      |
| `image.json`        | image message                 | "text only" reply, never reaches the agent |
| `stale.json`        | text, timestamp two hours old | dropped by the staleness filter            |

`stale.json` carries a fixed past timestamp on purpose. Every other fixture uses
a timestamp far enough in the future to stay inside the freshness window; the
posting script rewrites it to "now" before signing, so fixtures never rot.
