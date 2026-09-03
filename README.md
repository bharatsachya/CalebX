<div align="center">

```
  ██████╗ █████╗ ██╗     ███████╗██████╗ ██╗  ██╗
 ██╔════╝██╔══██╗██║     ██╔════╝██╔══██╗╚██╗██╔╝
 ██║     ███████║██║     █████╗  ██████╔╝ ╚███╔╝
 ██║     ██╔══██║██║     ██╔══╝  ██╔══██╗ ██╔██╗
 ╚██████╗██║  ██║███████╗███████╗██████╔╝██╔╝ ██╗
  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚═════╝ ╚═╝  ╚═╝
```

**Conversational Persona Engine**

_Talk naturally. CALEBX learns who you are, then connects you with people, places, and communities that fit._

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Runtime-Bun-fbf0df?style=flat-square&logo=bun&logoColor=black)](https://bun.sh/)
[![GramIO](https://img.shields.io/badge/Bot-GramIO-26A5E4?style=flat-square&logo=telegram&logoColor=white)](https://gramio.dev/)
[![Neo4j](https://img.shields.io/badge/Graph-Neo4j-018BFF?style=flat-square&logo=neo4j&logoColor=white)](https://neo4j.com/)
[![Postgres](https://img.shields.io/badge/Relational-Postgres%20%2B%20pgvector-336791?style=flat-square&logo=postgresql&logoColor=white)](https://github.com/pgvector/pgvector)
[![Tests](https://img.shields.io/badge/tests-805%20passing-22c55e?style=flat-square)](#verification)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

</div>

---

## What is CALEBX?

CALEBX is a chat bot you talk to like ChatGPT, on Telegram or WhatsApp. From that ongoing conversation — across days, sessions, topics — it builds a living persona of who you are: your interests, your city habits, the kind of people you want to meet.

When the picture is clear enough, it surfaces matches:

- **People** you should know, reached through mutual connections
- **Groups** that fit your personality
- **Places** that match how you move through your city

No forms. No profile to fill out. The conversation is the product.

```
You:     "honestly just want to find people building stuff in Bangalore,
           tired of big-company folks who just talk about scaling"

CALEBX:  "That frustration makes sense. Are you more in the product/design
           space or closer to engineering?"

You:     "product, but I write code when I need to. ex-Swiggy"

          — background, after the reply has already been sent —
          persona chunks written to Neo4j:
            "builds side projects" · "is around Bangalore" · "works in product"
          traversal: 4 friends-of-friends, 1 has opted in to being found

CALEBX:  "There's a small weekly thing in Indiranagar — a few people who ship
           side projects on the side of a day job. Want the invite?"
```

CALEBX doesn't ask for your interests. It listens until it knows them.

> **Two products share this monorepo.** CALEBX is the conversational engine described here.
> A separate WhatsApp matchmaking product — a form-driven, admin-curated candidate system —
> lives alongside it in `packages/form`, `packages/sheets`, `packages/directory-import` and
> the `form-bot.ts` entry point, sharing infrastructure but not domain logic. When someone
> says "CALEBX", check which one they mean.

---

## How it works

### One router, two subagents

Your first substantive message is classified once, and that decides which product you are talking to.

```
                        ┌─────────────────────────────┐
   message ─────────────▶  master router (temp 0.1)   │  one word, once per user
                        └──────────┬──────────────────┘
                                   │
             ┌─────────────────────┴─────────────────────┐
             ▼                                           ▼
     💍 matchmaker                              🌐 community connector
     Postgres + pgvector                        Neo4j + Places API
     partner preferences, candidates,           persona chunks, friends-of-friends,
     mutual interest, coordinator review        cohorts, groups, venues
```

The assignment is **not one-way** — `/switch` moves between them, and entering a mode for the first time asks for that mode's own consent, because the two collect genuinely different data. A misclassified first message should never strand someone in the wrong product.

The boundary is enforced, not assumed: a cross-mode read is denied **even for your own data**, and mem0 is keyed `tg:1001#matchmaker` so one mode's memories cannot surface in the other's replies.

### One turn

```
consent gate          unconsented text is never queued and never logged
   ▼
onboarding FSM        name, age, purpose — one question at a time
   ▼
mode resolution       Postgres; the router runs only if unassigned
   ▼
recall                mem0, keyed by user AND mode
   ▼
subagent tool loop    max 4 rounds, then answer with what you have
   ▼
reply                 internals-talk stripped, at most one question
   ▼
ingest (background)   extraction → embeddings → immutable PersonaChunks
```

Extraction is still its own call at temperature 0.1, still never merged with the conversation — but it now runs **after** the reply is sent, so nobody waits on an embedding pass to be answered.

### Recommendations are pull, and deterministic

`/recommendation` — or any plain-language ask, which the agent recognises itself and never answers with "type /recommendation" — runs the retrieval tools **from code**, then hands the real results to the model to narrate.

Leaving retrieval to the model means a turn where it forgets, calls the wrong tool, or narrates a recommendation it never fetched. When nothing is found, the model is not called at all.

---

## Architecture

A **Bun monorepo** following Ports & Adapters. The domain core never imports infrastructure; every external dependency is injected.

```
packages/
├── core/            # DOMAIN ONLY. Zero imports of any kind.
│                    #   User, AgentMode, UserModeState, the tool contract
├── authz/           # ★ Authorization. No data is read without a Principal.
│   ├── policy.ts    #   deny-by-default decisions + projections
│   ├── scope.ts     #   makes an unscoped SQL/Cypher statement unrunnable
│   └── projection.ts#   anonymised peer cards, PII stripping
├── trace/           # ★ Agent tracing: spans, redaction, CLI tree viewer
├── embed/           # bge-small-en-v1.5 @ 384 dims. HTTP · FastEmbed · hash
├── graph/           # ★ Neo4j persona graph + a complete in-memory twin
├── db/              # Postgres: mode state, matchmaking, review queue, cohorts
├── matchmaking/     # ★ Matchmaker subagent — tools, persona, guardrails
├── community/       # ★ Community subagent — tools, decay, cohorts, Places
├── queue/           # ★ BullMQ, send pacer, typing bus, workers, pipeline
├── agent/           # Router, /switch, tool loop, recommendation, /forget
├── channel/         # Every user-facing string + the onboarding FSM
├── telegram-bot/    # GramIO adapter — transport and rendering only
├── whatsapp-bot/    # Meta Cloud API adapter — transport and rendering only
├── config/ errors/ logger/
├── types/           # dead code — superseded by core/, kept only to avoid churn
└── form/ sheets/ directory-import/    # the separate matchmaking product
```

**The hard rule:** `core/` imports nothing. Adding a Discord adapter, or swapping Neo4j, touches only the relevant package.

**How a second chat platform stays honest:** everything a user actually sees or answers — the privacy notice, the onboarding questions, the option values that get persisted, the mode-consent copy — lives once, in `packages/channel`. Each bot only renders those prompts in its own idiom (Telegram inline keyboards, WhatsApp interactive lists) and translates its wire format to and from the shared FSM. `bun run scripts/verify-channel-parity.ts` asserts the shared strings byte-for-byte on every push.

Users are addressed by a namespaced id (`tg:…`, `wa:…`) rather than a raw platform id. mem0 has one flat `user_id` space, so without the namespace a WhatsApp phone number could collide with a Telegram id and merge two strangers' personas.

---

## Data model

Four stores, each owning one thing.

### Neo4j — the persona graph

```
(:User { userId: "tg:1001", discoverable, communityId, createdAt, lastActive })
(:PersonaChunk { chunkId, text, category, embedding[384], createdAt })
(:Place { placeId, ourTags, cachedAt })
(:Group { groupId, title, cohortKey, inviteLink, category, memberCount })

(User)-[:HAS_CHUNK]->(PersonaChunk)     (User)-[:VISITED { count }]->(Place)
(User)-[:KNOWS { strength }]->(User)    (User)-[:MEMBER_OF { joinedAt }]->(Group)
```

Three things worth knowing:

- **Chunks are immutable.** A contradiction writes a new chunk; the old one stays and simply weighs less. Decay is computed at read time from `createdAt` with a 90-day half-life — no stored weight, no cron job, no window where the number disagrees with the clock.
- **`Place` holds identity and our own tags only.** No name, no coordinates. Google's terms permit storing `place_id` and little else, so the geo filter lives in Nearby Search and everything user-visible is hydrated live.
- **There is no `SIMILAR_TO` edge.** Person ranking is a live chunk-to-chunk comparison over the small friends-of-friends set. A maintained similarity edge would need a batch job that returns nothing until the graph is large.

### Postgres — mode state, matchmaking, review queue

`agent_users` (`active_mode` + `enrolled_modes`), `mode_consent` (keyed by user **and** mode), `review_tasks`, `cohort_groups`, and `candidates.interest_embedding vector(384)` with an HNSW index.

Candidate search is hard SQL filters **plus** pgvector over interest text only. Age, city, community and diet are constraints, not hints for cosine to weigh — a user who says "must be in Bengaluru" means it, and embedding that alongside their free text produces a confident-looking suggestion in Pune.

### mem0 — conversational recall · Redis — queues, cache, typing bus

The embedding dimension lives in exactly one constant, imported by the Neo4j index, the Postgres column, and a migration test. A mismatch fails a unit test instead of silently returning garbage neighbours.

---

## Guardrails

### Nobody reads anyone else's data

Two independent layers, because they catch different failures.

**Policy** decides whether a caller may do this at all. A decision is not a boolean — `authorize()` returns a projection too, because "allowed, but anonymised" is the most common answer in this system and collapsing it to `true` is how a phone number escapes.

**Query scope** decides whether the _query_ may leave one user's subgraph. This is the layer that catches the failure which actually leaks data: a `SELECT` that forgot its `WHERE`.

```sql
✗ SELECT * FROM candidates
    → unscoped SQL: no owner predicate, and no bulk marker

✗ SELECT * FROM candidates WHERE user_id = 'tg:1001'
    → owner column compared to a literal; bind it as a parameter

✓ SELECT * FROM candidates WHERE user_id = $1
✓ /* authz:discoverable */ … WHERE discoverable = true    -- cross-user, consent-bounded
✓ /* authz:bulk */ …                                      -- system principal only
```

A unit test asserts that **every** statement in `packages/graph/src/cypher.ts` is either `$ownerId`-scoped or explicitly bulk-marked, so a new query cannot be added without being checked.

Three kinds of principal: a **user** (own records, discoverable peers anonymised), an **admin** coordinator (matchmaking records and contact details, but _not_ community persona chunks), and a named **system** job (bulk graph reads, anonymised, and nothing else — a clustering job has no business seeing a phone number).

### Contact details never reach the model

Every matchmaking tool payload is scanned for phone numbers, emails, invite links and handles before it goes back to the model, and fails closed. The model repeats what it is given, and the fields that leak are the ones nobody thought to check.

Mutual interest files a coordinator review; nothing unlocks until a human advances the stage.

### Introducing people needs the other person's consent

People discovery is opt-in via `/findme`, off by default. Even then, you see interests and a rough area behind an opaque handle — never a name, username or photo. A bot may not DM someone who has not started a conversation, so the other side has to agree first.

---

## Outbound, and not getting banned

```
Global ceiling:  ≤ 30 messages / second      one dispatch worker, concurrency 1
Per chat:        ≤ 1 message / second
Per group:       ≤ 20 messages / minute
Between sends:   35–50 ms + random jitter    mandatory, on every send
On HTTP 429:     re-queued after retry_after — never retried inline
```

Jitter is not cosmetic: perfectly uniform intervals are a machine signature, and Telegram's timing analysis feeds the bot's Contributor Quality Score.

Dispatch runs single-threaded because the 30/s limit is **global** — a second worker would pace against its own state and know nothing of the first one's sends. And a 429 is re-queued rather than slept through, because sleeping inside the one dispatch worker holds every other chat hostage for the same window. Typing indicators draw from the same budget, since chat actions count against the same limits.

---

## Queues, or not

Two execution modes that share one code path:

| Mode                               | What runs where                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `AGENT_EXECUTION=inline` (default) | The bot runs the turn in-process; ingestion is fire-and-forget once the reply is decided. No Redis needed. |
| `AGENT_EXECUTION=queue`            | The bot enqueues; `agent-execution`, `ingest` and `dispatch` workers do the rest.                          |

Both call the same `handleAgentJob`, so inline is a deployment choice rather than a second implementation that can drift. Requiring Redis and three worker processes before a fresh checkout can answer a message makes the thing hard to run and hard to demo.

Job payloads are validated on the way **out** of the queue, because a payload written before a deploy is read back by the new worker.

---

## Privacy

CALEBX processes nothing before explicit consent.

- On first contact, a plain-language privacy notice with Accept / Decline. Until Accept, every incoming message is discarded — not queued, not logged.
- **Per-mode consent.** Switching into matchmaking asks separately, and names what that mode collects.
- **`/forget` is a two-step confirmation** and erases mem0 (both mode keys), the Neo4j subgraph including every chunk and edge, `agent_users` / `mode_consent`, open review tasks, and the channel stores. Each store is attempted independently, and a partial failure is **reported honestly** and filed for a human — telling someone their data is gone when one store still holds it is worse than admitting the gap.
- Trace attributes are redacted by default: message text becomes `[redacted:42:1a2b3c4d]`, and a namespaced id is masked to `wa:***234`, because a WhatsApp id _is_ a phone number.

One thing stated plainly rather than glossed: **mem0 stores raw message and reply pairs**, not only extracted facts. The Neo4j graph stores only extracted facts. Describe it that way to users.

---

## Commands

| Command           | Does                                                                             |
| ----------------- | -------------------------------------------------------------------------------- |
| `/start`          | Privacy notice, then onboarding                                                  |
| `/switch [mode]`  | Move between matchmaking and community; asks for consent the first time          |
| `/recommendation` | Manual shortcut to the retrieval path the agent also triggers itself             |
| `/findme`         | Opt in to (or out of) being suggested to people you share a connection with      |
| `/forget`         | Erase everything, everywhere. Two-step, irreversible                             |
| `/register_group` | **Admin.** Run inside a group with the bot as admin, to register it for a cohort |

`/register_group` exists because **a bot cannot create a Telegram group** — there is no Bot API method, and group creation needs a user account, which is the MTProto path the Bot Developer Terms rule out. So a human creates the group, adds the bot, and the bot mints and stores the invite link itself.

---

## Tech stack

| Layer         | Technology                        | Why                                                                   |
| ------------- | --------------------------------- | --------------------------------------------------------------------- |
| Runtime       | **Bun**                           | Native TypeScript, fast cold starts, built-in test runner             |
| Language      | **TypeScript** `strict`           | No `any`, across every package                                        |
| Bot framework | **GramIO** · **Meta Cloud API**   | Middleware-first Telegram SDK; official WhatsApp API, never a userbot |
| Graph         | **Neo4j** (AuraDB)                | Traversal plus a native vector index in one engine                    |
| Relational    | **Postgres + pgvector**           | Hard filters and similarity in the same query                         |
| Memory        | **mem0**                          | Conversational recall, contradiction handling, keyed per mode         |
| Inference     | **OpenRouter**                    | One endpoint, swappable models                                        |
| Embeddings    | **FastEmbed** `bge-small-en-v1.5` | 384 dims — cheap in both indexes, ample for short facts               |
| Clustering    | **graphology** Louvain            | In-process; hosted AuraDB ships no GDS library                        |
| Queue         | **BullMQ + Redis**                | Typed jobs, retries, independent concurrency                          |

---

## Local development

### Prerequisites

- [Bun](https://bun.sh/) `>= 1.1`
- Postgres with `CREATE EXTENSION vector` available (Neon, Supabase and RDS all work)
- A [Neo4j AuraDB](https://neo4j.com/cloud/aura/) instance (the free tier is enough)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

Redis is only needed for `AGENT_EXECUTION=queue`.

### Setup

```bash
git clone https://github.com/bharatsachya/CalebX.git
cd CalebX
bun install

cp .env.example .env          # fill in the required block below

bun run db:migrate            # Postgres, through 009
bun run graph:schema          # Neo4j constraints + the 384-dim vector index

bun run bot:telegram          # inline execution, no Redis required
```

Send any message to your bot. You'll see the consent prompt first, then the conversation begins.

Running it queued instead:

```bash
AGENT_EXECUTION=queue bun run bot:telegram
bun run worker:agent
bun run worker:ingest
bun run worker:dispatch
```

No embedding service to hand? `EMBED_PROVIDER=hash` uses a deterministic local embedder. It captures lexical overlap only — fine for development and tests, never for real data, which is why it has to be asked for explicitly.

### Environment variables

```bash
# Required — the bot will not boot without these
TELEGRAM_BOT_TOKEN=""
OPENROUTER_API_KEY=""
MEM0_API_KEY=""
DATABASE_URL="postgres://localhost:5432/calebx"   # must support `CREATE EXTENSION vector`

# Required for the community subagent (hosted Neo4j AuraDB)
NEO4J_URI="neo4j+s://xxxx.databases.neo4j.io"
NEO4J_PASSWORD=""
NEO4J_USER="neo4j"                # default
NEO4J_DATABASE="neo4j"            # default

# Embeddings — bge-small-en-v1.5, 384 dims (see packages/embed)
EMBED_PROVIDER="http"             # http | fastembed | hash
EMBED_SERVICE_URL=""              # required when EMBED_PROVIDER=http

# Queues, cache, and the typing bus — only for AGENT_EXECUTION=queue
AGENT_EXECUTION="inline"          # inline | queue
REDIS_URL="redis://localhost:6379"

# Human review queue (assumptions.md A1)
ADMIN_CHAT_ID=""

# Optional
OPENROUTER_MODEL="meta-llama/llama-3.1-8b-instruct:free"
GOOGLE_PLACES_API_KEY=""          # without it, places recommendations are stubbed
AUTHZ_HANDLE_SALT=""              # per deployment; salts opaque peer handles
TRACE="on"                        # off disables agent tracing
TRACE_STDOUT="false"              # also emit spans as JSON lines
DISPATCH_JITTER_MAX_MS="15"
```

Each package declares what it needs through `env("<scope>")`, so a process is never required to supply a variable it has no use for. `HELIX_URL`, `OLLAMA_*` and `PERSONA_CHUNK_THRESHOLD` were removed on 2026-09-03 — nothing read them.

---

## Verification

```bash
bun test           # 805 tests
bun run typecheck  # tsc --noEmit across every package
```

**None of the tests need a database, a model, or a network.** That is deliberate: the parts worth testing are pure or take injected ports, so a fake can drive them. `MemoryGraphStore` runs the same traversals _and the same authorization checks_ as the Neo4j store — a fake that is more permissive than the real thing turns every passing test into a false negative. `FakeSqlExecutor` records the SQL each repository issues, so "did this query carry its owner predicate?" is a test rather than a code-review habit. A scripted model makes "what happens when it hallucinates a tool name?" answerable in milliseconds.

Where to look first:

| Question                                           | File                                                 |
| -------------------------------------------------- | ---------------------------------------------------- |
| Can one user reach another's data?                 | `authz/policy.test.ts` · `queue/integration.test.ts` |
| Can an unscoped query run at all?                  | `authz/scope.test.ts` · `graph/cypher.test.ts`       |
| Does the mode boundary hold, and can it be undone? | `agent/modes.test.ts` · `queue/integration.test.ts`  |
| Do the anti-ban limits hold?                       | `queue/limiter.test.ts`                              |
| Can a contact detail escape?                       | `matchmaking/guardrails.test.ts`                     |
| Does `/forget` really erase, and report honestly?  | `agent/forget.test.ts` · `queue/integration.test.ts` |

### Seeing what the agent did

```bash
bun run trace:view agent              # last 5 traces + the slowest span names
bun run trace:view agent <traceId>    # one trace, as a tree
```

```
trace 4f2ac9d1…  7 spans  912ms
· agent.turn  912ms (self 21ms)  [mode=matchmaker userId=tg:***596]
   ├─ ◇ mem0.search  120ms
   ├─ ▸ tool.search_matrimonial_candidates  310ms
   │  ├─ ◇ embed.query  40ms
   │  └─ ▪ db.candidate_search  260ms  [rows=4]
   └─ ◆ llm.turn  461ms  [iteration=2]
```

---

## Code quality

Every commit goes through automated gates via **Husky**.

**Pre-commit** (`git commit`):

- Prettier formats all staged files
- `gitleaks` scans for accidentally committed secrets
- Every directory containing code has a `README.md`
- No source file over 300 lines

**Pre-push** (`git push`):

- `tsc --noEmit` across all packages
- Prettier compliance
- Channel parity between the Telegram and WhatsApp copy

| Document                                           | What it holds                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`CLAUDE.md`](CLAUDE.md)                           | Current state of the repo, and the rules for working in it                                 |
| [`implementation_plan.md`](implementation_plan.md) | The agent engine's design of record                                                        |
| [`assumptions.md`](assumptions.md)                 | 17 judgement calls made without an explicit answer, each with what to change if it's wrong |
| [`CLAUDE1.md`](CLAUDE1.md)                         | Rejected designs, kept on purpose — the ideas most likely to be reinvented                 |
| [`rules/rules.md`](rules/rules.md)                 | Naming, package boundaries, PR guidelines                                                  |

---

## Roadmap

- [x] Telegram adapter (GramIO)
- [x] WhatsApp adapter (official Meta Cloud API)
- [x] Conversational LLM layer, two-stage pipeline
- [x] Consent gate + `/forget` across every store
- [x] mem0 persona memory, namespaced per mode
- [x] Master intent router + `/switch` with per-mode consent
- [x] Neo4j persona graph with read-time decay
- [x] Matchmaking search (hard filters + pgvector)
- [x] Authorization layer — policy plus query-scope enforcement
- [x] Agent tracing with a CLI viewer
- [x] Rate-limited dispatch queue with jitter
- [x] Tag cohorts + in-process Louvain clustering
- [ ] A real group catalog — venues come from the Places API, but a group only exists once an admin creates one
- [ ] Sheets → Postgres sync, so `form-bot` signups reach the matchmaker
- [ ] WhatsApp dispatch worker (WhatsApp runs inline today)
- [ ] Review reminders for tasks nobody has picked up
- [ ] Discord adapter
- [ ] Persona transparency dashboard (read-only web view of your own graph)
- [ ] Federated identity (link Telegram + WhatsApp into one persona)
- [ ] Group memory (collective persona when added to a group chat)

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">
  <sub>Built with Bun · Neo4j · Postgres · mem0 · GramIO</sub>
</div>
