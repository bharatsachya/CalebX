# CLAUDE.md — CALEBX Project Intelligence

> This file describes the repo **as it actually exists today**, verified against the
> code and the test suite (last checked 2026-09-03, after the agent-engine build).
> Earlier versions described an aspirational HelixDB/BullMQ/Ollama architecture that was
> never built — see §8. The Neo4j persona graph that **CLAUDE1.md** proposed is now built,
> alongside a two-subagent router, an authorization layer, agent tracing, and the queue
> layer. `implementation_plan.md` is the design of record; `assumptions.md` lists every
> decision taken without an explicit answer.

---

## 0. The Core Idea (Never Lose Sight of This)

CALEBX is a **conversational persona engine**, not a search tool.

The original intent: a user opens Telegram (or WhatsApp) and talks to CALEBX like they
would talk to ChatGPT — naturally, messily, over multiple sessions. From that ongoing
conversation, CALEBX builds a living persona of who this person is: their vibe,
interests, location habits, frustrations, the kind of people they want to meet. Then it
surfaces:

- **Groups** that match their personality
- **People** they should know (2nd-degree social graph)
- **Places** that fit how they move through the world

No forms. No onboarding surveys. No profile pages. The conversation IS the product.

**This is still the vision, not the current feature set.** What's actually built today
is the conversational half (persona memory via mem0) — the recommendation half
(Groups/People/Places) has never been implemented. See §1.

---

## 0.1 Two Products Share This Monorepo

This is the single most important fact this file needs to convey, because it wasn't
true when the project started and every package now has to be read with it in mind.

- **CALEBX** — the conversational persona bot described above. `packages/agent`,
  `packages/telegram-bot` (the `telegram.ts` entry point), `packages/whatsapp-bot`,
  `packages/channel`.
- **A separate WhatsApp matchmaking product** — a Postgres-backed candidate/matching
  system with its own consent flow, onboarding form, and admin-curated matches. Not
  CALEBX, just sharing infrastructure and this repo. `packages/db` (Postgres),
  `packages/form`, `packages/sheets`, `packages/directory-import`, and the
  `form-bot.ts` entry point inside `packages/telegram-bot` (run side-by-side with
  CALEBX's own `telegram.ts` deliberately, to A/B a scripted-form UX against the
  open-conversation UX).

Both products share `packages/core`'s `IUserRepository` (implemented once, in
`packages/db`, against Postgres) and `packages/config`/`packages/errors`. They do not
share persona storage, consent copy, or domain logic. When you're asked to work on
"CALEBX," confirm which of the two you actually mean — the matchmaking product's own
README and rules.md still say "CalebX" too.

---

## 1. What's Actually Built

The real per-message flow today, for both `telegram.ts` and `whatsapp.ts`:

```
User sends message
        │
        ▼
Consent gate (file-backed) — blocks until /start → Accept. Unconsented text is
never queued and never logged.
        │
        ▼
Onboarding FSM (file-backed) — name/age/purpose, one question at a time
        │
        ▼
runTurn(deps, {userId, text, channel, command})  — packages/agent:
  1. agent_users.ensure()                → mode state (Postgres)
  2. if unassigned → classifyMode()      → master router, temp 0.1, one word
  3. mem0 search, keyed <userId>#<mode>  → recalled context
  4. subagent tool loop (max 4 rounds)   → matchmaker OR community tools
     …or the deterministic /recommendation path when one is asked for
  5. finalizeReply()                     → strips internals talk, one question max
  6. mem0 add, same namespaced key
        │
        ▼
Reply sent — inline through the SendPacer, or via the dispatch queue
        │
        ▼
ingest job (background, after the reply): extraction → FastEmbed → PersonaChunks
```

**Built and tested:** the master intent router and `/switch`; two domain packages with their
own tools and their own database; the Neo4j persona graph with vector search; pgvector
candidate search; an authorization layer gating every read and every query; agent tracing
with a CLI viewer; BullMQ queues with a rate-limited dispatch path; `/forget` across all five
stores.

**Still not built:** a real Group catalog beyond what an admin registers; a WhatsApp dispatch
worker; a Discord adapter; the web dashboard.

805 unit and integration tests cover it, none of which need a database, a model, or a
network — see §14.

---

## 2. Monorepo Structure

```
CalebX/
├── CLAUDE.md                    ← this file
├── CLAUDE1.md                   ← proposed Neo4j persona-graph design (not built)
├── rules/rules.md               ← coding conventions
├── packages/
│   ├── types/                   ← DEAD CODE. Duplicates the original HelixDB-era
│   │                               User/Place/Group/PersonaChunk shapes. Not imported
│   │                               by anything except its own package.json/tsconfig
│   │                               path alias. Don't add to it; `core/` is where
│   │                               entities actually live now.
│   ├── errors/                  ← Typed error hierarchy (BaseCalebxError → ...).
│   │                               Defined but NOT thrown or caught anywhere in the
│   │                               codebase today — actual error handling is ad-hoc
│   │                               try/catch + console.error. Real, but aspirational
│   │                               in practice; treat "use the typed hierarchy" as a
│   │                               direction to move in, not a rule already followed.
│   ├── logger/                  ← Pino JSON logger. Used in exactly one file
│   │                               (telegram-bot/src/observability.ts). console.log/
│   │                               error/warn is the actual norm across telegram-bot,
│   │                               whatsapp-bot, config, db, sheets, directory-import.
│   ├── config/                  ← Zod env schema, validated at boot via loadConfig().
│   │                               Still declares HELIX_URL, REDIS_URL, OLLAMA_URL,
│   │                               OLLAMA_CHAT_MODEL, OLLAMA_EMBED_MODEL — none of
│   │                               these are read by any other file in the repo.
│   ├── core/                    ← DOMAIN ONLY, zero infra imports. Today this is just
│   │   └── src/index.ts             `User { id?, userId }` and `IUserRepository
│   │                               { createUser, getUser }`. The richer entity/port
│   │                               set the original design described (Persona, Intent,
│   │                               Place, Group, Recommendation, IPersonaStore,
│   │                               IVectorSearch, IGraphTraversal) was never added.
│   ├── db/                      ← Postgres. Two jobs in one package:
│   │   │                           (1) `PostgresUserRepository` implementing
│   │   │                           `IUserRepository` — the only thing CALEBX's own
│   │   │                           bots (telegram.ts, whatsapp.ts) use it for, a
│   │   │                           minimal hashed-userId existence record.
│   │   │                           (2) the matchmaking product's real schema:
│   │   │                           candidates, contact_details, messages,
│   │   │                           partner_prefs, matches, photos — six tables, no
│   │   │                           ORM, numbered SQL migrations.
│   │   │                           HelixDB was dropped from this package entirely on
│   │   │                           2026-08-09 — see §8.
│   │   └── src/migrations/      ←   numbered .sql files, applied once each
│   ├── agent/                   ← CALEBX's actual conversational engine.
│   │   ├── llm.ts               ←   OpenRouter client (openai SDK), enforces the
│   │   │                             temp 0.1 / temp 0.7 stage split
│   │   ├── memory.ts            ←   mem0 client: searchMemories, addMemory
│   │   ├── system-prompt.ts     ←   CALEBX personality + extraction prompts
│   │   └── agent.ts             ←   runAgent() — the two-stage pipeline in §1
│   ├── channel/                 ← Shared between telegram-bot and whatsapp-bot only
│   │   │                           (not form-bot, not whatsapp matchmaking):
│   │   │                           namespaced user-id scheme (tg:/wa:), file-backed
│   │   │                           ConsentStore, file-backed onboarding FSM/store,
│   │   │                           user-facing copy.
│   ├── form/                    ← Matchmaking questionnaire as a pure domain package
│   │                               (field defs, FSM, validation, copy). No I/O.
│   ├── sheets/                  ← Google Sheets as the matchmaking product's storage,
│   │                               implementing the ports `packages/form` declares.
│   ├── directory-import/        ← One-shot CLI: imports biodata PDFs/photos into the
│   │                               matchmaking Sheet. Not a runtime dependency of
│   │                               any bot.
│   ├── telegram-bot/            ← TWO entry points on purpose:
│   │   ├── telegram.ts          ←   CALEBX: consent → onboarding → runAgent
│   │   └── form-bot.ts          ←   matchmaking form over Sheets, no model, no DB —
│   │                                 run side-by-side to A/B against telegram.ts
│   └── whatsapp-bot/            ← CALEBX's WhatsApp channel: same consent/onboarding/
│                                    runAgent pattern as telegram.ts, plus Meta webhook
│                                    signature verification, dedupe, and a send queue
│                                    local to this package (not the BullMQ one §5
│                                    used to describe — that queue never existed).
├── docs/architecture.md         ← STALE. A pre-monorepo HelixDB/Ollama blueprint doc,
│                                    ~770 lines, not updated since. Do not treat as
│                                    current; ask before relying on it for anything.
└── .env.example                 ← never commit .env
```

### Monorepo rules (still enforced / still good practice)

- Packages import each other by workspace alias (`@calebx/core`), never by relative
  path across package boundaries.
- `core/` has zero imports from `db/`, `agent/`, `telegram-bot/`, `whatsapp-bot/`.
  Violation = architectural failure. The domain must not know its infrastructure
  exists. (This one genuinely holds today — `core/src/index.ts` has no imports at
  all.)
- Every package has its own `README.md` (root + `src/`). The pre-commit hook checks
  for this — it does not check that the README is accurate, so some are stale (see
  §8).

---

## 3. Data Architecture (Current State)

Four stores, each owning one thing.

### 3.1 Neo4j — the persona graph (`packages/graph`)

`User`, `PersonaChunk`, `Place`, `Group`, joined by `HAS_CHUNK` / `KNOWS` / `VISITED` /
`MEMBER_OF`. A 384-dimension cosine vector index on `PersonaChunk.embedding`.

- **Chunks are immutable.** A contradiction writes a new chunk; the old one stays and simply
  weighs less. Decay is computed at read time from `createdAt` with a 90-day half-life — no
  stored weight, no cron, no drift.
- **`Place` holds `placeId` and our own tags only.** No name, no coordinates, no `Point`:
  Google's terms permit storing `place_id` indefinitely and little else, so geo filtering
  happens in Nearby Search and everything user-visible is hydrated live.
- **Every query is scoped or explicitly bulk.** `scopedCypher` refuses a statement that
  neither binds `$ownerId` nor carries `// authz:bulk`, and a test asserts that _every_
  statement in `cypher.ts` satisfies one of the two.
- **Vector search is constrained to the owner.** The index is probed wider than `limit` and
  then narrowed to the user — never an unconstrained ANN handed to somebody.

### 3.2 Postgres — mode state, matchmaking, review queue (`packages/db`)

Migration `009_agent_modes_and_community.sql` adds `agent_users` (`active_mode` +
`enrolled_modes`), `mode_consent` (keyed by user _and_ mode), `review_tasks`,
`cohort_groups`, and `candidates.interest_embedding vector(384)` with an HNSW index.

Candidate search is hard SQL filters plus pgvector over interest text only — age, city,
community and diet are constraints, not hints for cosine to weigh.

### 3.3 mem0 — conversational recall (`packages/agent`)

Unchanged in kind, but **keyed `<userId>#<mode>`**. mem0's `user_id` space is flat and
`search` has no filter, so sharing one key would surface matrimonial memories inside a
community reply. `deleteAll` on both keys plus the legacy bare key backs `/forget`.

Raw message text still goes to mem0. That remains a real divergence from the original
privacy design — state it accurately when describing what CALEBX stores.

### 3.4 Redis — queues, cache, typing bus (`packages/queue`)

Only in `AGENT_EXECUTION=queue` mode. See §5.

### 3.5 The embedding dimension is a single constant

`EMBEDDING_DIMENSIONS = 384` (`bge-small-en-v1.5`) lives in `packages/embed/src/dimensions.ts`
and is imported by the Neo4j index, the Postgres column, and a migration test. A mismatch
fails a unit test rather than silently returning garbage neighbours.

---

## 4. Conversational Layer

### 4.1 One router, two subagents

The master router (`packages/agent/src/router.ts`) classifies the first substantive message
into `matchmaker` or `community_connector` at temperature 0.1, in one word. It defaults to
`community_connector` when unsure — that side asks less and collects less, so a wrong guess
there is a mildly odd conversation, while a wrong guess the other way opens with questions
about marriage.

Assignment is **not one-way**. `/switch` moves between modes; entering a mode for the first
time asks for that mode's own consent, because the two collect genuinely different data. The
earlier one-way lock was dropped because a misclassified first message would otherwise strand
someone in the wrong product permanently.

### 4.2 The tool loop

Four rounds maximum (`tool-runner.ts`). Not a cost control — a correctness one: a model that
has called `search` three times with slightly different arguments is flailing, and the user
is watching a typing indicator while it does. When the budget runs out the loop asks once
more with tools withheld, forcing prose from what it already has.

Hallucinated tool names, malformed JSON arguments, and thrown tools are all normal results
fed back to the model, never crashes.

### 4.3 Recommendations are pull, and deterministic

`/recommendation` — and any plain-language ask, which the agent recognises itself and never
answers with "type /recommendation" — runs the retrieval tools **from code**, then hands the
real results to the model to narrate. Leaving retrieval to the model means a turn where it
forgets, or narrates a recommendation it never fetched. When nothing is found, the model is
not called at all.

### 4.4 Extraction

Still a separate call at temperature 0.1, still never merged with the reply — but it now runs
in the **ingest job after the reply is sent**, so nobody waits on it. Its output finally has
somewhere to go: `PersonaChunk` writes in community mode. In matchmaker mode it writes
nothing, because preferences are only ever saved through the tool that makes the user confirm
first.

### 4.5 Every reply is post-processed

`finalizeReply` strips sentences that narrate internals ("let me search the database") and
enforces at most one question — dropping later interrogative sentences while keeping the
statements between them. The prompts ask for both; this guarantees them.

---

## 5. Queue Architecture

`packages/queue`, with two execution modes that share one code path (`handleAgentJob`) —
see `assumptions.md` A13:

- `AGENT_EXECUTION=inline` (default): the bot runs the turn in-process; ingestion is
  fire-and-forget once the reply is decided.
- `AGENT_EXECUTION=queue`: the bot enqueues, and three workers do the rest.

| Queue             | Concurrency | Retries                  | Work                                   |
| ----------------- | ----------- | ------------------------ | -------------------------------------- |
| `agent-execution` | 5           | 3, exponential           | router → subagent → outbound           |
| `ingest`          | 5           | 3, exponential           | extraction → embedding → PersonaChunks |
| `dispatch`        | **1**       | 5, honours `retry_after` | the throttled send path                |
| `cohort`          | 1           | 1                        | tag cohorts, then Louvain              |

Dispatch is single-threaded because the 30/s Telegram limit is global; a second worker would
pace against its own state. A 429 is **re-queued, never retried inline** — sleeping through
`retry_after` inside the one dispatch worker holds every other chat hostage.

Job payloads are validated on the way _out_ of the queue, because a payload written before a
deploy is read back by the new worker.

A failed turn still owes the user a reply: on the final attempt the agent worker queues
`copy.AGENT_UNAVAILABLE` itself.

---

## 6. Telegram & WhatsApp Compliance (Non-Negotiable)

### 6.1 Consent

Two layers now:

- **Channel consent**, file-backed, unchanged: runs before onboarding, before anything
  reaches the agent. Unconsented text is never queued and never logged.
- **Per-mode consent**, in `mode_consent`: the mode the router assigns is covered by the
  grant made at `/start` (assumptions.md A14), but `/switch` into the second mode asks
  separately and names what that mode collects.
- **Discoverability** is its own opt-in (`/findme`), off by default. Nobody is described to
  anyone without it, and even then only as interests plus a rough area behind an opaque
  handle.

`/forget` is a two-step confirmation and now erases mem0 (both mode keys), the Neo4j subgraph
including every chunk and edge, `agent_users`/`mode_consent`, open review tasks, and the
channel stores. A partial failure is reported honestly and files a review task.

### 6.2 Dispatch Rate Limits — implemented

`SendPacer`: 30/s globally, 1/s per chat, 20/min per group, with 35–50ms of jitter on every
send. The jitter is mandatory — uniform intervals are a machine signature. A 429 is
re-queued after `retry_after`, never retried inline. `sendChatAction` draws from the same
budget, because chat actions count against the same limits.

### 6.3 What You Must Never Do

- Never use MTProto/userbot libraries. HTTP Bot API only.
- **Never try to create a Telegram group from the bot.** There is no Bot API method; group
  creation needs a user account. An admin creates it, adds the bot, and runs
  `/register_group` — then the bot mints invite links itself (assumptions.md A2).
- Never scrape public groups or channels for training data.
- Never initiate a DM to a user who has not started a conversation first. This is why person
  recommendations are anonymised and gated on the _other_ person's opt-in.
- Never operate in Telegram Secret Chats.
- **Never cache Google Places data beyond `place_id`.**
- Describe CALEBX's data practices as they are: mem0 stores raw message and reply pairs, not
  only extracted facts.

---

## 7. Infrastructure & Config

No `docker-compose.yml` yet. Local dev runs against real services: Postgres with **pgvector**
(`DATABASE_URL`), hosted **Neo4j AuraDB** (`NEO4J_URI`/`NEO4J_PASSWORD`), mem0, OpenRouter,
an embedding service (`EMBED_SERVICE_URL`, or `EMBED_PROVIDER=hash` offline), Redis for the
queued mode, and Google Places (optional — without a key the community subagent still runs
and simply cannot suggest venues).

Env vars are declared per package through `env("<scope>")`, so a process is never required to
supply a variable it has no use for. `HELIX_URL`, `OLLAMA_*` and `PERSONA_CHUNK_THRESHOLD`
were removed on 2026-09-03 — nothing read them.

Setup:

```bash
bun install
bun run db:migrate         # through 009_agent_modes_and_community.sql
bun run graph:schema       # Neo4j constraints + the 384-dim vector index
bun run bot:telegram
```

---

## 8. What Happened to HelixDB

Worth knowing so you don't go looking for it: `packages/db` had a `HelixUserRepository`
mock from the initial scaffolding (2026-06-28) that, per the commit that removed it,
"nobody actually ran... against a real HelixDB instance." On 2026-08-09 it was
repurposed entirely to Postgres for the matchmaking product; `helix.toml` and
`schema.hx` were deleted as unused. Separately, on 2026-06-30, CALEBX's actual
persona memory was built on mem0 instead. The two changes were independent — mem0
wasn't chosen _to replace_ HelixDB, HelixDB just never got past being a mock, and
mem0 solved the "remember things about this user" problem on its own track.

**Leftover references you'll still find** (harmless, not wired to anything):
`HELIX_URL` default in `packages/config/src/schema.ts`, a `HelixDBError` class in
`packages/errors/src/index.ts`, a stale comment in
`packages/channel/src/consent.store.ts` ("When the HelixDB layer lands..."), and
the entire unused `packages/types` package. `docs/architecture.md` and the root
`README.md` are both still written as if HelixDB/Ollama/BullMQ are live — they are
not; treat them as historical, not current.

The Group/Place/recommendation graph HelixDB was meant to power was never built by
anyone, in any form. See **CLAUDE1.md** for the current proposal (Neo4j) to build it.

---

## 9. Error Handling

`packages/errors` is now used, not merely declared. `ForbiddenError` is thrown by the
authorization layer on every denial and carries a machine-readable `reason` that tests assert
on; `Neo4jError`, `PostgresError`, `EmbeddingError`, `ExternalApiError`, `ValidationError`,
`ModeNotEnrolledError` and `ReviewPendingError` are thrown at their boundaries.
`HelixDBError` remains only as a deprecated alias.

Two rules that hold everywhere:

- **A failed turn still owes the user a reply.** Every path — inline catch, worker `failed`
  handler, dead-lettered job — ends in a visible message.
- **A denial is never explained to the user.** `ForbiddenError.reason` is deliberately
  non-identifying, and the tool runner replaces it with a flat refusal before the model ever
  sees it, because the model repeats what it is given.

---

## 10. Development Phases & Ownership Split

The **calebx-dev-phases** skill's four-phase plan (Foundation → Ingestion & Consent
→ Persona & Recommendations → Dispatch & Hardening) describes the original
HelixDB-based build order and is not what actually happened — Phase 1's own exit
criteria (`docker compose up`, `helix compile`) were never met, yet Phase 2-shaped
work (consent, onboarding, mem0 integration) shipped anyway, on a different
foundation. Read it for the shape of what recommendations/dispatch work remains,
not as a status report.

---

## 11. What Claude Should Always Do

1. **Never read or write user data without a `Principal`.** Every repository and store method
   takes one as its first argument. If you are adding a method that does not, you are adding
   a hole — and its test will say so.

2. **Never hand-write a `WHERE user_id = …`.** Use `scopedSql` / `scopedCypher`; they refuse
   an unscoped statement. A cross-user query needs an explicit `/* authz:bulk */` marker
   _and_ a system principal, or `/* authz:discoverable */` _and_ a `discoverable = true`
   predicate.

3. **A decision is not a boolean.** `authorize` returns a projection too; apply it with
   `project()`. "Allowed, but anonymized" is the most common answer in this system.

4. **Mode before ownership.** A cross-mode access is denied even for your own data. Do not
   route around it.

5. **Never import infrastructure into `core/`.** Still holds; `core` has no imports at all.

6. **Extraction and conversation stay separate calls** at 0.1 and 0.7. Extraction now runs in
   the ingest job, after the reply.

7. **PersonaChunks are immutable.** Write a new one; decay handles the rest. There is no
   `UPDATE` path and there should not be.

8. **User ids are namespaced (`tg:123`), never raw platform ids.** The Postgres hash goes on
   the principal as an alias, not as a second identity.

9. **Anything a user reads or answers belongs in `packages/channel`.** Bot packages hold
   transport and rendering only.

10. **A failed turn still owes the user a reply.** Memory and persona writes are best-effort
    and must never swallow a user-visible message.

11. **Never let a tool payload reach the model unscanned** in matchmaker mode. The model
    repeats what it is given.

12. **Don't assume; write it down.** If you make a judgement call the user did not specify,
    add it to `assumptions.md` with what to change if it is wrong.

13. **Run `bun test` and `bun run typecheck`.** Both are fast and neither needs a network.

---

## 12. Key Risks & Mitigations

| Risk                                       | Impact                                      | Mitigation today                                                                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Telegram 429 cascade                       | throttling, then a ban                      | `SendPacer` (30/s, 1/s per chat, 20/min per group) + mandatory 35–50ms jitter; 429s re-queued with `retry_after`                                                                                                         |
| One user's data reaching another           | the worst failure available                 | Two independent layers: the policy in `@calebx/authz`, and query-scope enforcement that makes an unscoped SQL or Cypher statement unrunnable. A test asserts every statement in `cypher.ts` is scoped or explicitly bulk |
| Contact details leaking through the model  | irreversible, real-world                    | `assertNoContactLeak` scans every matchmaking tool payload and fails closed                                                                                                                                              |
| Mode boundary blurring                     | matrimonial data in a social reply          | Mode is checked before ownership; mem0 is keyed `<userId>#<mode>`                                                                                                                                                        |
| Model inventing a recommendation           | plausible, wrong, unfalsifiable             | `/recommendation` retrieval is deterministic; the narration prompt forbids padding, and tools return "nothing found" as a normal result                                                                                  |
| Silent profile rewrite                     | stated preferences overwritten by inference | Preferences need explicit confirmation; background ingestion writes nothing in matchmaker mode                                                                                                                           |
| Cohort clustering on a sparse graph        | one blob, or all singletons                 | Tag cohorts ship first; Louvain is gated on a minimum component size                                                                                                                                                     |
| Places data going stale or breaching terms | ToS exposure                                | Only `place_id` is stored; everything user-visible is hydrated live                                                                                                                                                      |
| `/forget` half-succeeding                  | user told their data is gone when it is not | Each store attempted independently, failures reported honestly, and a partial wipe files a review task                                                                                                                   |

---

## 13. Future Work

- **Seeding a real group catalog** — venues come from the Places API, but a group exists only
  once an admin creates one and runs `/register_group`. This is the biggest gap between
  "works" and "useful".
- **Sheets → Postgres sync** — without it, `form-bot` signups stay invisible to the
  matchmaker (assumptions.md A3).
- **A WhatsApp dispatch worker** — WhatsApp runs inline only today (A16).
- **Review reminders** — a pending task sits open indefinitely; `listOpenOlderThan` exists
  for it (A11).
- **Discord adapter**, **web dashboard**, **federated identity**, **group memory** — as
  before, not started.

---

## 14. Tests

`bun test` — 805 tests, and **none of them need a database, a model, or a network.** That is
deliberate: the parts worth testing are pure or take injected ports, so a fake can drive
them. `MemoryGraphStore` runs the same traversals and the same authorization checks as the
Neo4j store, `FakeSqlExecutor` records SQL so a missing owner predicate fails a test, and
`ScriptedModel` makes "what happens when the model hallucinates a tool name?" a unit test.

Where to look first:

| Question                                       | File                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Can one user reach another's data?             | `packages/authz/src/policy.test.ts`, `packages/queue/src/integration.test.ts` |
| Can an unscoped query be run at all?           | `packages/authz/src/scope.test.ts`, `packages/graph/src/cypher.test.ts`       |
| Does the mode lock hold, and can it be undone? | `packages/agent/src/modes.test.ts`, `packages/queue/src/integration.test.ts`  |
| Do the anti-ban limits hold?                   | `packages/queue/src/limiter.test.ts`                                          |
| Can a contact detail escape?                   | `packages/matchmaking/src/guardrails.test.ts`                                 |
| Does `/forget` really erase?                   | `packages/agent/src/forget.test.ts`, `integration.test.ts`                    |

---

## 15. Tracing

`packages/trace`. Every turn is a trace; every LLM call, tool call, query and send is a span.

```bash
bun run trace:view agent              # last 5 traces + the slowest span names
bun run trace:view agent <traceId>    # one trace, as a tree
```

Attribute redaction is on by default: message text is replaced with
`[redacted:<len>:<hash8>]` and a namespaced id is masked to `wa:***234`, because a WhatsApp
`wa_id` is a phone number. mem0 already stores raw text; the trace log must not become a
second copy of it.
