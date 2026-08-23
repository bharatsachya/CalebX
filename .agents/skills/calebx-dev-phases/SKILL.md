---
name: calebx-dev-phases
description: CALEBX development roadmap — the four-phase build plan, per-phase owner split, tasks, and exit criteria (Foundation, Ingestion & Consent, Persona & Recommendations, Dispatch & Hardening). Read when planning what to build next, checking a phase's exit criteria, or setting up the workspace tooling (strict TS, Husky hooks).
user-invocable: false
metadata:
  internal: true
---

## Development Phases & Ownership Split

### Phase 1 — Foundation (both devs, 1–2 days)

Owner A:

- Initialize Bun workspace with `strict: true`, `noUncheckedIndexedAccess: true`, no `any`
- Create `types/`, `errors/`, `logger/`, `config/` packages
- Write `docker-compose.yml`, validate all services start cleanly
- Write `db/schema.hx`, run `helix compile` and confirm zero errors

Owner B:

- Set up Husky hooks (pre-commit: prettier + gitleaks + README check; pre-push: tsc + lint)
- Scaffold `core/` with entity types and port interfaces (no implementations yet)
- Write `db/queries.ts` stub with `defineQueries` DSL — no logic, just the shape
- Confirm `helix start --disk` connects to MinIO and survives a restart

Exit criteria: `docker compose up` starts all services. `bun run build` succeeds across
all packages. `helix compile db/schema.hx` outputs zero errors.

---

### Phase 2 — Ingestion & Consent (2–3 days)

Owner A (Telegram boundary):

- Build GramIO bot with consent middleware as the first and only middleware
- Implement `/start` → privacy notice → inline keyboard → write `consent_granted: true`
- Implement `/forget` → delete all PersonaChunks for this user
- On consent, push message to `ingest-queue` and send an acknowledgment reply

Owner B (Ingestion worker):

- Build `ingest-queue` worker: receive message → call Ollama Stage 1 extraction
  → call FastEmbed → write PersonaChunk to HelixDB
- Write integration test: send a test message, confirm PersonaChunk appears in DB
- Set up Redis session store: read/write last 20 turns per user

Exit criteria: User sends a message. After consent, a PersonaChunk appears in
HelixDB with a non-null embedding. Raw message text is not stored anywhere on disk.

---

### Phase 3 — Persona & Recommendations (3–4 days)

Owner A (GraphRAG retrieval):

- Implement `retrieval-queue` worker with the 7-step GraphRAG pattern from §3.3
- Build the RRF fusion ranker
- Write the geo-radius post-filter (lat/lng from PersonaChunks → Place node proximity)

Owner B (Conversational LLM layer):

- Implement Ollama Stage 2 (conversation) call with persona summary injection
- Build the persona summarizer background job (every 5 turns → new PersonaChunks)
- Implement the `InsufficientContextError` path: when fewer than 3 chunks score > 0.75,
  keep conversing without surfacing a recommendation

Exit criteria: User has a 10-turn conversation about interests. CALEBX surfaces
one relevant Group or Person recommendation. The recommendation makes sense given
the conversation.

---

### Phase 4 — Dispatch & Hardening (2 days)

Owner A (dispatch worker):

- Build `dispatch-queue` worker with rate-limit enforcement and jitter
- Implement `retry_after` handling (re-queue on 429, do not retry inline)
- Load test: simulate 50 concurrent users, confirm no 429 errors escape

Owner B (resilience):

- Add dead-letter queue handling and user-facing fallback messages
- Add structured logging with correlation IDs across all three queues
- Write end-to-end test: full message → persona → recommendation → dispatch flow

Exit criteria: Bot handles 50 concurrent users without a Telegram API ban.
All failures produce a graceful user-visible message within 30 seconds.
