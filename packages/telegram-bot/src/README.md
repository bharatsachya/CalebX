# Telegram Bot Source

GramIO adapter. Handler registration order matters (consent → onboarding → chat).

- `telegram.ts` — entry point: wires stores, registers gates/handlers in order, starts polling.
- `consent.gate.ts` — consent chokepoint (registered first).
- `onboarding.gate.ts` / `onboarding.store.ts` — name/city/age/purpose capture.
- `session.store.ts` — file-backed short-term buffer + daily message counter.
- `chat.handlers.ts` — message handler (single LLM reply, 20/day cap → summarize) + photo handler.
- `recommend.messages.ts` — anonymised card, keyboards, reveal text.
- `recommend.handlers.ts` — "Say hi" / "Skip" callbacks (double-opt-in reveal) + `/matches`.
- `recommend.job.ts` — the once-a-day matchmaking batch (invoked by `scripts/daily-recommend.ts`).
- `config.ts` — bot token + file store paths.
