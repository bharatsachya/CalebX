# @calebx/telegram-bot

GramIO Telegram adapter for CALEBX. Thin boundary: consent gate → onboarding → chat
(single free-tier LLM reply per message, 20-message daily cap that triggers a session
summary), plus double-opt-in people recommendations.

## Run

```bash
bun run db:migrate      # once, against your Neo4j
bun run bot:start       # start polling
bun run recommend:daily # once a day: match users + send introduction cards
```

Requires `.env` (see `.env.example`): `TELEGRAM_BOT_TOKEN`, `NEO4J_URI`,
`NEO4J_USERNAME`, `NEO4J_PASSWORD`, `OPENROUTER_API_KEY`.
