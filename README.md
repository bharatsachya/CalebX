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
[![HelixDB](https://img.shields.io/badge/DB-HelixDB-a855f7?style=flat-square)](https://github.com/HelixDB/helix-db)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

</div>

---

## What is CALEBX?

CALEBX is a Telegram bot you talk to like ChatGPT. From that ongoing conversation — across days, sessions, topics — it builds a living persona of who you are: your interests, your city habits, the kind of people you want to meet.

When the picture is clear enough, it surfaces matches:

- **People** you should know (filtered by 2nd-degree social proximity)
- **Groups** that fit your personality
- **Places** that match how you move through your city

No forms. No profile to fill out. The conversation is the product.

```
You:     "honestly just want to find people building stuff in Bangalore,
           tired of big-company folks who just talk about scaling"

CALEBX:  "That frustration makes sense. Are you more in the product/design
           space or closer to engineering?"

You:     "product, but I write code when I need to. ex-Swiggy"

          — background, silently —
          persona chunks written: ["indie builder", "Bangalore", "product-eng",
                                   "frustrated with corporate", "ex-Swiggy"]
          GraphRAG: 3 people in your 2nd-degree network match all 5 chunks

CALEBX:  "There's a small weekly meetup called Maker's Table in Indiranagar —
           a few ex-Flipkart and ex-Cred folks who ship side projects. Want me
           to send the link?"
```

CALEBX doesn't ask for your interests. It listens until it knows them.

---

## How It Works

### The Persona

Every message you send is processed in the background:

```
Your message
     │
     ▼  Stage 1 — Extraction (Ollama, temp 0.1)
     │  { intent, entities, sentiment, location_hint }
     │
     ▼  Embedding (nomic-embed-text)
     │  [1024-dimensional float vector]
     │
     ▼  Written to HelixDB as a PersonaChunk
        { text, embedding, category, decay_weight: 1.0, created_at }
        connected via edge: User ──[HAS_MEMORY]──► PersonaChunk
```

Chunks accumulate over time. When you update or contradict an old one, a new chunk is written and the old one's `decay_weight` is reduced — not deleted. The temporal trail of who you _were_ vs. who you _are now_ is what makes recommendations improve.

### The Recommendation

When CALEBX has enough context (≥ 3 chunks scoring above threshold), it runs a GraphRAG query:

```
1. Embed your current message
2. Traverse graph: User → all PersonaChunks  (your subgraph only, never global)
3. ANN search within subgraph               (vector score + BM25 hybrid)
4. Traverse outward: chunks → Place / Group nodes
5. Filter: 2nd-degree KNOWS edges, optional geo-radius
6. Rank: Reciprocal Rank Fusion (vector score × decay_weight + graph proximity)
7. Top-k results → Stage 2 LLM call → conversational reply
```

Stage 2 is a separate Ollama call at temperature 0.7. Extraction and conversation generation have different requirements — they are never merged into one call.

---

## Architecture

CALEBX is a **Bun monorepo** following the Ports & Adapters (Hexagonal) pattern. The domain core never imports from infrastructure. Every external dependency is injected through a typed port interface.

```
packages/
├── types/           # Shared TypeScript types, enums, branded types
├── errors/          # Typed error hierarchy — never throw raw Error
├── logger/          # Structured JSON logger (Pino). No console.log.
├── config/          # Zod-validated env schema. Process exits on missing vars.
│
├── core/            # DOMAIN ONLY. Zero infrastructure imports.
│   ├── entities/    #   User, Persona, Intent, Place, Group, Recommendation
│   ├── use-cases/   #   ParseIntent, UpdatePersona, FindMatches, RankResults
│   └── ports/       #   IPersonaStore, IVectorSearch, IGraphTraversal, ILLM
│
├── db/              # HelixDB adapter — implements core ports
│   ├── schema.hx    #   HelixQL schema: nodes, edges, vectors
│   ├── queries.ts   #   Compiled AST query bundles (defineQueries DSL)
│   └── helix.adapter.ts
│
├── inference/       # LLM + embedding adapter — implements ILLM port
│   ├── ollama.client.ts     # Extraction (temp 0.1) + conversation (temp 0.7)
│   └── fastembed.client.ts  # Local embedding generation
│
├── queue/           # BullMQ job definitions and worker entry points
│   └── jobs/
│       ├── ingest.job.ts    # chunk → embed → upsert PersonaChunk
│       ├── retrieval.job.ts # GraphRAG → rank → LLM Stage 2
│       └── dispatch.job.ts  # throttled Telegram outbound
│
├── channel/         # Platform-agnostic conversation logic. Zero deps.
│   ├── user-id.ts        #   namespaced ids: tg:123, wa:16505551234
│   ├── copy.ts           #   every user-facing string, in one place
│   ├── options.ts        #   age/purpose choices + typed-answer matching
│   ├── onboarding.fsm.ts #   pure (state, input) → (state, prompts, memory)
│   └── *.store.ts        #   consent + onboarding ports and JSON ledgers
│
├── telegram-bot/    # GramIO adapter — thin boundary only
│   ├── consent.gate.ts    #   consent middleware
│   ├── onboarding.gate.ts #   translates GramIO ↔ the shared FSM
│   ├── keyboards.ts       #   InlineKeyboards built FROM the shared options
│   └── telegram.ts        #   wires ports → adapters, starts polling
│
└── whatsapp-bot/    # Meta Cloud API adapter — thin boundary only
    ├── server.ts          #   node:http webhook: verify → ack → enqueue
    ├── signature.ts       #   X-Hub-Signature-256 over the raw bytes
    ├── webhook.parse.ts   #   payload → messages (drops delivery receipts)
    ├── dedupe.ts / queue.ts #  retry dedupe + per-user serialisation
    ├── client.ts / render.ts #  Graph sends; buttons (≤3) or lists (>3)
    └── whatsapp.ts        #   wires ports → adapters, starts listening
```

**The hard rule:** `core/` has zero imports from `db/`, `telegram-bot/`, `whatsapp-bot/`, `inference/`, or `queue/`. Swapping HelixDB for another store, or adding a Discord adapter, touches only the relevant package — the domain is untouched.

**How a second chat platform stays honest:** everything a user actually sees or
answers — the privacy notice, the four onboarding questions, the option values
that get persisted, the summary written to memory — lives once, in
`packages/channel`. Each bot only renders those prompts in its own idiom
(Telegram inline keyboards, WhatsApp interactive lists) and translates its wire
format to and from the shared FSM. `bun run scripts/verify-channel-parity.ts`
asserts the shared strings byte-for-byte, and runs on every push.

Users are addressed by a namespaced id (`tg:…`, `wa:…`) rather than a raw
platform id. mem0 has one flat `user_id` space, so without the namespace a
WhatsApp phone number could collide with a Telegram id and merge two strangers'
personas. Ledgers written before this migrate their bare-numeric keys to `tg:`
automatically on first read.

---

## Data Model

```
Nodes            Edges                           Vectors
─────────────    ──────────────────────────────  ──────────────────────────────────
User             User ──[KNOWS { strength }]──► User      PersonaChunk
Place            User ──[VISITED { count }]────► Place       .user_id    I64
Group            User ──[MEMBER_OF]────────────► Group       .text       String
                 User ──[HAS_MEMORY]───────────► PersonaChunk .embedding [F32; 1024]
                 User ──[SIMILAR_TO { score }]─► User        .category   String
                                                             .decay_weight F64
                                                             .created_at   I64
```

All embeddings are first-class properties on top-level nodes — never nested objects — so HelixDB's ANN index applies directly.

`telegram_id` is always `I64`. Passing a string causes Error E622 at query compile time.

---

## Three Queues, No Blocking

All processing is asynchronous. The Telegram handler never waits for LLM inference.

```
ingest-queue    chunk → embed → write PersonaChunk    concurrency: 5
retrieval-queue GraphRAG → rank → Ollama Stage 2      concurrency: 3
dispatch-queue  send to Telegram API (throttled)      concurrency: 1
```

The dispatch worker enforces Telegram's rate limits hard:

```
Global ceiling:  ≤ 30 messages / second
Per chat:        ≤ 1 message / second
On HTTP 429:     pause for exact retry_after duration, then re-queue
Between sends:   35–50 ms base delay + random jitter
```

Jitter is not cosmetic. Perfectly uniform dispatch intervals trigger Telegram's heuristic timing analysis and degrade the bot's Contributor Quality Score.

---

## Privacy

CALEBX processes no data before explicit consent.

- On first message, the bot sends a plain-language privacy notice with an Accept / Decline keyboard.
- Until Accept is tapped, every incoming message is silently discarded — not queued, not logged.
- Raw message text is never written to disk. Only extracted facts (interests, intents, sentiments) are stored as PersonaChunks in HelixDB.
- `/forget` deletes all PersonaChunks for your account. Consent is revocable at any time.

This satisfies Section 4.3 of the Telegram Bot Developer Terms, which prohibits automated data collection without individual, explicit, active, and revocable consent.

---

## Tech Stack

| Layer          | Technology              | Why                                                                        |
| -------------- | ----------------------- | -------------------------------------------------------------------------- |
| Runtime        | **Bun**                 | Native TypeScript, fast cold starts, built-in test runner                  |
| Language       | **TypeScript** `strict` | `noUncheckedIndexedAccess`, no `any`, across all packages                  |
| Bot framework  | **GramIO**              | Middleware-first Telegram SDK, full type coverage                          |
| Database       | **HelixDB**             | One engine for graph traversal + ANN vector search — no Pinecone, no Neo4j |
| LLM inference  | **Ollama**              | Local, private, no external API dependency                                 |
| Task queue     | **BullMQ + Redis**      | Typed jobs, retries, dead-letter, independent concurrency per queue        |
| Object storage | **MinIO**               | S3-compatible HelixDB persistence, self-hosted                             |
| Monorepo       | **Bun workspaces**      | Zero-config package linking                                                |

---

## Local Development

### Prerequisites

- [Bun](https://bun.sh/) `>= 1.1`
- [Docker](https://www.docker.com/) (for Redis, MinIO, HelixDB, Ollama)
- A Telegram Bot token from [@BotFather](https://t.me/BotFather)

### Setup

```bash
# 1. Clone
git clone https://github.com/bharatsachya/CalebX.git
cd CalebX

# 2. Install workspace dependencies
bun install

# 3. Environment
cp .env.example .env
# Fill in TELEGRAM_BOT_TOKEN at minimum. All other vars have defaults.

# 4. Start infrastructure
docker compose up -d

# 5. Pull LLM models (first run only — ~5 GB)
docker exec calebx-ollama ollama pull llama3
docker exec calebx-ollama ollama pull nomic-embed-text

# 6. Compile HelixDB schema and query bundles
bun run db:compile

# 7. Build all packages in dependency order
bun run build

# 8. Start the bot
bun run bot:start
```

Send any message to your bot on Telegram. You'll see the consent prompt first, then the conversation begins.

### Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=""

# Defaults (override as needed)
HELIX_URL="http://localhost:6969"
REDIS_URL="redis://localhost:6379"
OLLAMA_URL="http://localhost:11434"
OLLAMA_CHAT_MODEL="llama3"
OLLAMA_EMBED_MODEL="nomic-embed-text"
PERSONA_CHUNK_THRESHOLD="0.75"   # min score before surfacing a recommendation
MAX_SESSION_TURNS="20"           # turns kept in Redis short-term memory
```

---

## Code Quality

Every commit goes through automated gates via **Husky**.

**Pre-commit** (`git commit`):

- Prettier formats all staged `.ts` files
- `gitleaks` scans for accidentally committed secrets
- Validates that all `packages/*/` directories contain a `README.md`
- Blocks files over the size limit

**Pre-push** (`git push`):

- `tsc --noEmit` across all packages
- Prettier compliance check
- ESLint

For naming conventions, package boundaries, and PR guidelines see [`rules/rules.md`](rules/rules.md).
For the full architecture rationale and Claude-specific coding instructions see [`CLAUDE.md`](CLAUDE.md).

---

## Roadmap

- [ ] Telegram adapter (GramIO)
- [ ] Conversational LLM layer (Ollama, two-stage pipeline)
- [ ] Persona graph (HelixDB PersonaChunks + decay weighting)
- [ ] GraphRAG retrieval (ANN + BM25 hybrid + RRF fusion)
- [ ] Consent gate + `/forget` command
- [ ] Rate-limited dispatch queue with jitter
- [x] WhatsApp adapter (official Meta Cloud API)
- [ ] Discord adapter
- [ ] Persona transparency dashboard (read-only web view of your own graph)
- [ ] Federated identity (link Telegram + WhatsApp into one persona)
- [ ] Group memory (collective persona when added to a group chat)
- [ ] mem0 integration (automatic contradiction resolution + decay)

---

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">
  <sub>Built with Bun · HelixDB · GramIO · Ollama</sub>
</div>
