# CLAUDE.md — CALEBX Project Intelligence

> This file is the authoritative source of truth for AI-assisted development on CALEBX.
> Read this entire file before writing a single line of code. Every architectural decision
> here exists for a specific reason. Do not deviate without explicit instruction.

---

## 0. The Core Idea (Never Lose Sight of This)

CALEBX is a **conversational persona engine**, not a search tool.

The original intent: a user opens Telegram and talks to CALEBX like they would talk
to ChatGPT — naturally, messily, over multiple sessions. From that ongoing conversation,
CALEBX builds a living persona of who this person is: their vibe, interests, location
habits, frustrations, the kind of people they want to meet. Then it surfaces:

- **Groups** that match their personality
- **People** they should know (2nd-degree social graph)
- **Places** that fit how they move through the world

No forms. No onboarding surveys. No profile pages. The conversation IS the product.

Every technical decision below serves this idea. If a piece of infrastructure
does not ultimately make the conversational experience richer or safer, question
whether it belongs here.

---

## 1. What You Are Building

```
User sends message
        │
        ▼
CALEBX responds like a conversational AI (think: curious friend, not a bot menu)
        │
        ▼
In the background, CALEBX is:
  - Extracting entities, intents, sentiments from every turn
  - Building and updating a persona graph for this user in HelixDB
  - Running GraphRAG: finding people/groups/places that match this persona
        │
        ▼
When the moment is right (or user asks), CALEBX surfaces a recommendation
```

The persona is **never complete**. It evolves every conversation. A user who talked
about hiking in January and now talks about cafes in April — CALEBX holds both,
weights recency, and understands the person is multi-dimensional.

---

## 2. Monorepo Structure

```
CalebX/
├── CLAUDE.md                    ← you are here
├── rules/
│   └── rules.md                 ← coding conventions (always read before contributing)
├── packages/
│   ├── types/                   ← shared TypeScript types, enums, branded types
│   ├── errors/                  ← typed error hierarchy (never throw raw Error)
│   ├── logger/                  ← structured JSON logger (Pino), no console.log
│   ├── config/                  ← environment variable schema (Zod), validated at boot
│   ├── core/                    ← DOMAIN ONLY. zero infrastructure imports.
│   │   ├── entities/            ←   User, Persona, Intent, Place, Group, Recommendation
│   │   ├── use-cases/           ←   ParseIntent, UpdatePersona, FindMatches, RankResults
│   │   └── ports/               ←   IPersonaStore, IVectorSearch, IGraphTraversal, ILLM
│   ├── db/                      ← HelixDB adapter. implements core ports.
│   │   ├── schema.hx            ←   HelixQL schema (nodes, edges, vectors)
│   │   ├── queries.ts           ←   compiled AST query bundles
│   │   └── helix.adapter.ts     ←   IPersonaStore + IVectorSearch + IGraphTraversal impl
│   ├── inference/               ← LLM + embedding adapter. implements ILLM port.
│   │   ├── ollama.client.ts     ←   Ollama HTTP wrapper (conversation + extraction)
│   │   └── fastembed.client.ts  ←   local embedding generation
│   ├── queue/                   ← BullMQ setup, job definitions, typed payloads
│   │   ├── jobs/
│   │   │   ├── ingest.job.ts    ←   chunk → embed → upsert persona
│   │   │   ├── retrieval.job.ts ←   query persona → GraphRAG → rank
│   │   │   └── dispatch.job.ts  ←   throttled Telegram outbound
│   │   └── workers/             ←   worker process entry points
│   └── telegram-bot/            ← GramIO adapter. thin boundary only.
│       ├── handlers/            ←   message, /start, callback handlers
│       ├── middleware/          ←   consent gate, rate-guard, payload validator
│       └── bot.ts               ←   wires ports → adapters, starts polling
├── docker-compose.yml           ← Redis, MinIO, HelixDB, Ollama
├── helix.toml                   ← HelixDB project config (port 6969 default)
└── .env.example                 ← never commit .env
```

### Monorepo rules

- Packages import each other by workspace alias (`@calebx/types`), never by relative path
  across package boundaries.
- `core/` has zero imports from `db/`, `telegram-bot/`, `inference/`, or `queue/`.
  Violation = architectural failure. The domain must not know its infrastructure exists.
- `types/` and `errors/` are the only packages that `core/` may import.
- Every package has its own `README.md`. The pre-commit hook enforces this.

---

## 3. Data Architecture

### 3.1 HelixDB Schema (db/schema.hx)

```
Nodes:
  N::User {
    telegram_id: I64 @unique @index
    username: String
    consent_granted: Bool
    created_at: I64          // unix ms
    last_active: I64
  }

  N::Place {
    name: String
    city: String
    lat: F64
    lng: F64
    category: String         // "cafe" | "workspace" | "gym" | etc.
  }

  N::Group {
    telegram_id: I64 @unique
    name: String
    description: String
    category: String
    member_count: I64
  }

Edges:
  E::KNOWS { strength: F64 }          // User → User (social graph, weighted)
  E::VISITED { count: I64 }           // User → Place
  E::MEMBER_OF { joined_at: I64 }     // User → Group
  E::SIMILAR_TO { score: F64 }        // User → User (derived from vector similarity)

Vectors:
  V::PersonaChunk {
    user_id: I64             // FK to User.telegram_id
    text: String             // raw extracted fact/interest/intent
    embedding: [F32; 1024]   // FastEmbed nomic-embed-text-v1.5
    category: String         // "interest" | "location" | "social" | "sentiment"
    created_at: I64
    decay_weight: F64        // starts at 1.0, decays over time, recency matters
  }
```

**Critical schema rules:**

- Embeddings live on top-level nodes/vectors only. Never nested objects.
- `telegram_id` is always `I64`. Never pass a string — you will get Error E622 at query compile time.
- `PersonaChunk` vectors are immutable once written. Updates mean new nodes with updated `decay_weight`.
  The old chunk is not deleted — the temporal trail is the persona history.

### 3.2 Persona Model

The persona is not a single record. It is a **weighted collection of PersonaChunk vectors**
connected to a User node. Each chunk captures one extracted fact from the conversation:

```
"I love working from cafes but hate it when they play loud music"
→ chunk 1: { category: "preference", text: "prefers cafes for work", decay: 1.0 }
→ chunk 2: { category: "sentiment",  text: "dislikes loud environments", decay: 1.0 }
```

When a user contradicts an old chunk, do not delete it. Write a new chunk and reduce the
old chunk's `decay_weight`. The LLM context for retrieval should weight chunks by
`(vector_score * decay_weight)` so recent facts dominate without erasing history.

### 3.3 GraphRAG Query Pattern

For every recommendation query, execute in this order:

```
1. Embed the user's current message (FastEmbed)
2. Traverse graph: User → all PersonaChunks (constrained subgraph)
3. Run ANN within that subgraph (hybrid: vector score + BM25 keyword)
4. Traverse from top chunks → Place/Group nodes via VISITED/MEMBER_OF edges
5. Filter: geo-radius if location context present, 2nd-degree KNOWS if social context
6. Rank: Reciprocal Rank Fusion (RRF) merging vector score + graph proximity
7. Return top-k results with explanation snippets for the LLM to narrate
```

Never run a global ANN across all users. Always traverse from the specific User node first.
This is both a performance requirement and a privacy requirement.

---

## 4. Conversational Layer

### 4.1 The Bot's Personality

CALEBX is not a command bot. It does not have menus or `/help` trees.
It is a curious, warm, city-smart conversational agent.

Prompting principles:

- Respond naturally to whatever the user says, even off-topic.
- Ask one follow-up question per turn at most. Never interrogate.
- When surfacing a recommendation, frame it as a suggestion, not a result set.
- Never reveal internal mechanics to the user ("I'm now searching the vector database...").

System prompt skeleton (in `inference/prompts/system.ts`):

```
You are CALEBX, a city-smart conversational companion on Telegram.
You talk like a knowledgeable local friend, not a search engine.
Your job is to understand who this person is through conversation, and
occasionally — when it feels natural — connect them with people, places,
or communities that match their vibe.

Rules:
- Never ask more than one question per message.
- Never mention databases, vectors, AI, or internal systems.
- When you don't have enough context to recommend, keep talking. Build the picture.
- Surface a recommendation only when you have ≥3 PersonaChunks with score > 0.75.
```

### 4.2 Two-Stage LLM Pipeline Per Turn

Every incoming message runs two Ollama calls in sequence:

**Stage 1 — Extraction (fast, structured output):**

```
Model: llama3 (or mistral-7b)
Task: Extract structured facts from this message turn.
Output: JSON { intents: [], entities: [], sentiment: string, location_hint: string | null }
Temperature: 0.1  ← low, we want deterministic extraction
```

**Stage 2 — Response (warm, conversational):**

```
Model: llama3
Task: Continue the conversation naturally. If recommendation_context is provided,
      weave it into the response.
Input: conversation history (last 10 turns) + persona summary + recommendation_context
Temperature: 0.7  ← higher, we want personality
```

Do not merge these into one call. Extraction and conversation generation have
conflicting temperature requirements.

### 4.3 Conversation History Management

- Store the last **20 message turns** per user session in Redis (TTL: 24h).
- This is the short-term working memory. It feeds Stage 2.
- The long-term memory lives in HelixDB as PersonaChunks.
- After every 5 turns, run a background summarization job that distills the session
  into new PersonaChunks. This keeps the HelixDB persona growing without re-processing
  every single message.

---

## 5. Queue Architecture

Three isolated BullMQ queues. They never block each other.

```
┌─────────────────────────────────────────────────────┐
│  ingest-queue                                       │
│  Job payload: { userId, messageText, sessionId }    │
│  Worker does: extract → embed → upsert PersonaChunk │
│  Concurrency: 5                                     │
│  Retries: 3, exponential backoff                    │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  retrieval-queue                                    │
│  Job payload: { userId, promptVector, chatId }      │
│  Worker does: GraphRAG → rank → Ollama Stage 2      │
│  Concurrency: 3  (LLM calls are expensive)          │
│  Retries: 2                                         │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  dispatch-queue                                     │
│  Job payload: { chatId, text, parseMode }           │
│  Worker does: send to Telegram API (throttled)      │
│  Concurrency: 1  (rate limit is global)             │
│  Retries: 5, respects retry_after                   │
└─────────────────────────────────────────────────────┘
```

The flow across queues per user message:

```
GramIO handler → ingest-queue
ingest-queue completes → retrieval-queue
retrieval-queue completes → dispatch-queue
dispatch-queue → Telegram sendMessage
```

Jobs in each queue are completely independent. If retrieval fails, the ingest result
is preserved. The user gets an error reply via dispatch-queue regardless.

---

## 6. Telegram Compliance (Non-Negotiable)

### 6.1 Consent Gate

This must run **before any data touches HelixDB**. No exceptions.

```typescript
// packages/telegram-bot/middleware/consent.gate.ts

// On every incoming message, check User.consent_granted in HelixDB.
// If null or false:
//   1. Send the privacy notice (inline keyboard with Accept / Decline)
//   2. Drop the message. Do not queue it. Do not log the text.
// If true:
//   Pass to next middleware.
```

The privacy notice must explain in plain language:

- What data is stored (conversation-derived interests, not raw messages)
- How to revoke (`/forget` command deletes all PersonaChunks for this user)
- That data is used to power recommendations within CALEBX only

### 6.2 Dispatch Rate Limits

Hard limits enforced in `dispatch-queue` worker:

```
Global:     ≤ 30 messages/second across all chats
Per chat:   ≤ 1 message/second
Groups:     ≤ 20 messages/minute per group chat
```

Implementation pattern:

```typescript
// Before every sendMessage:
await sleep(35 + jitter(0, 15)); // 35–50ms global floor with jitter

// Catch HTTP 429:
if (err.status === 429) {
  const retryAfter = err.parameters?.retry_after ?? 30;
  await sleep(retryAfter * 1000);
  // re-queue the job, do not retry inline
}
```

The `jitter()` call is mandatory. Perfectly uniform intervals trigger Telegram's
timing analysis heuristics and degrade the bot's Contributor Quality Score (CQS).

### 6.3 What You Must Never Do

- Never use MTProto / userbot libraries (Telethon, Pyrogram, TDLib in user mode).
  Use the HTTP Bot API only. This is both a ToS requirement and an architectural one.
- Never scrape public groups or channels for training data. Section 4.3 of the
  Bot Developer Terms explicitly prohibits this.
- Never store raw message text in HelixDB. Store only extracted facts/intents.
  Raw text in Redis session cache is acceptable (TTL-bounded, never persisted to disk).
- Never initiate a DM to a user who has not started a conversation first.
- Never operate in Telegram Secret Chats (the Bot API blocks this by design).

---

## 7. Infrastructure & Config

Docker-compose services (Redis, MinIO, HelixDB, Ollama) and the Zod env var schema
live in the **calebx-infra-config** skill. Load-bearing invariant: HelixDB needs the
`--disk` flag + MinIO backing anywhere beyond unit tests, or PersonaChunks are wiped
on restart. Env vars are validated at boot with Zod; a missing/mistyped var exits early.

---

## 9. Error Handling

Never throw raw `Error`. Use the typed hierarchy in `packages/errors/`.

```
BaseCalebxError
├── InfrastructureError
│   ├── HelixDBError        (query failures, type mismatches)
│   ├── RedisError          (queue, session failures)
│   └── TelegramApiError    (HTTP 429, network failures)
├── DomainError
│   ├── ConsentRequiredError
│   ├── PersonaNotFoundError
│   └── InsufficientContextError  (not enough chunks to recommend yet)
└── ValidationError             (Zod parse failures at boundaries)
```

Every worker job must catch errors, log them with structured context, and either:

- Re-queue with backoff if the error is transient (`InfrastructureError`)
- Dead-letter the job if the error is permanent (`DomainError`, `ValidationError`)

Dead-lettered jobs must trigger a dispatch-queue job that sends the user a
graceful fallback message. The user should never see a silent failure.

---

## 10. Development Phases & Ownership Split

The four-phase build plan (Foundation → Ingestion & Consent → Persona &
Recommendations → Dispatch & Hardening), with per-phase owner split, tasks, and exit
criteria, lives in the **calebx-dev-phases** skill.

---

## 11. What Claude Should Always Do

When generating code for this project:

1. **Check the port before implementing.** If you are writing a new DB operation,
   look at `core/ports/` first. Implement the existing interface, do not create a new one.

2. **Never import infrastructure into core.** If you are in `core/` and feel the urge
   to import from `db/` or `telegram-bot/`, stop. You are doing it wrong.

3. **All external I/O goes through the queue.** No direct Telegram API calls from
   handlers. No direct HelixDB calls from the bot. Everything is a queue job.

4. **`telegram_id` is always `I64`.** If you see it as a string anywhere, fix it.
   HelixDB will throw Error E622 at query compile time and it will cost you an hour.

5. **Jitter is not optional.** Every sleep in the dispatch worker gets a random component.

6. **No `console.log`.** Use `packages/logger/`. Every log entry is JSON with a
   `correlationId`, `userId`, `jobId`, and `phase`.

7. **Extraction and conversation are two separate Ollama calls.** Never combine them.
   Different temperature requirements. Different failure modes.

8. **PersonaChunks are immutable.** Never UPDATE a chunk. Write a new one, decay the old.

9. **Test the consent gate first on any new handler.** No exceptions to this rule.

10. **When in doubt about HelixDB schema, run `helix compile` before assuming it works.**
    The TypeScript SDK catches type mismatches at query bundle generation time, not runtime.

11. **Anything a user reads or answers belongs in `packages/channel`, not in a bot.**
    Copy, option ids, persisted option values, the onboarding FSM. A bot package may only
    hold transport and rendering. If you are about to write a user-facing string inside
    `telegram-bot/` or `whatsapp-bot/`, you are creating drift between the channels.

12. **User ids are namespaced (`tg:123`, `wa:16505551234`), never raw platform ids.**
    Build them with `telegramUserId()` / `whatsappUserId()`. mem0 has a single flat
    `user_id` space — a bare WhatsApp number can collide with a Telegram id and merge two
    people's personas. This is also the groundwork for federated identity (§13).

13. **A failed turn still owes the user a reply.** Memory writes are best-effort and must
    not swallow a user-visible message; a thrown `runAgent` falls back to
    `copy.AGENT_UNAVAILABLE`. Silence is indistinguishable from a dead bot.

---

## 12. Key Risks & Mitigations

The risk register (Telegram 429 cascade, HelixDB E622, persona drift, LLM
hallucination, MinIO data loss, platform ban) and its mitigations live in the
**calebx-risks** skill.

---

## 13. Future Work (Post-MVP)

- ~~**WhatsApp adapter**~~ — shipped, on the official Meta Cloud API (`packages/whatsapp-bot`).
  Baileys was rejected: it drives a real user account, which is the WhatsApp equivalent of the
  MTProto userbots §6.3 bans for Telegram.
- **Discord adapter** — identical pattern, different `packages/discord-bot/`
- **mem0 integration** — sits between workers and HelixDB; handles contradiction resolution,
  deduplication, and decay scoring automatically. Removes custom decay logic from Phase 3.
- **Web dashboard** — read-only view of your own persona graph (transparency feature)
- **Federated identity** — link Telegram + WhatsApp accounts into a single persona graph
- **Group memory** — when CALEBX is added to a group, build a collective group persona
  separate from individual user personas, with strict cross-context privacy boundaries
