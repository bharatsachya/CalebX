# CLAUDE1.md — Proposed: Neo4j Persona Graph

> **Status: built, 2026-09-03.** The current state now lives in CLAUDE.md §3 and
> `implementation_plan.md`. This file is kept as the **record of rejected designs** — the
> reasoning below for why `SIMILAR_TO` edges, collaborative filtering, and a vector index on
> Place/Group were all turned down is worth more than the schema sketch, because those are
> the ideas most likely to be reinvented.
>
> Read the schema here as history. What actually shipped differs in four ways:
>
> 1. **`decayWeight` was dropped as a stored property.** Decay is computed at read time from
>    `createdAt` — no cron, no write amplification, no window where the stored weight
>    disagrees with the clock.
> 2. **`Place` lost its `Point`, `name` and `city`.** Google Places terms permit storing
>    `place_id` and little else, so the node holds identity plus our own tags and the
>    geo-radius filter moved into Nearby Search.
> 3. **`Group` gained `cohortKey` and `inviteLink`.** A bot cannot create a Telegram group,
>    so a human creates it and `/register_group` hands the bot its id and link.
> 4. **Cohorting was added.** Tag cohorts (`category + city`) ship first; Louvain runs
>    in-process via graphology, because hosted AuraDB has no GDS library.
>
> Everything under "Recommendation matching" was built as described.

---

## Why this exists, and why Neo4j instead of HelixDB

CLAUDE.md originally specced HelixDB for this. It turned out HelixDB was never
actually run against a real instance — it was a mock nobody exercised, removed
entirely on 2026-08-09 when `packages/db` got repurposed to Postgres for the
separate matchmaking product (see CLAUDE.md §8). The recommendation graph
(Group/Place/User, GraphRAG retrieval) was never built with HelixDB or with
anything else. This proposal replaces HelixDB with Neo4j as the target graph
database and, in the process, corrects two real design flaws in the original
`schema.hx`-era plan (below) rather than just swapping the database name.

**This does not touch mem0.** mem0 (`packages/agent/src/memory.ts`) already
handles conversational recall — `searchMemories`/`addMemory` — and does that job
well. It has no concept of Place/Group nodes or graph traversal and isn't being
asked to grow one. The Neo4j graph is a separate, purpose-built index for
recommendation, not a replacement for mem0.

---

## Proposed schema

**Nodes**

```
User          { userId: String @unique,       // "tg:123", "wa:4477..." — namespaced,
                                                // per @calebx/channel's existing scheme
                createdAt: Int, lastActive: Int }

PersonaChunk  { text: String,
                embedding: Float[],            // vector-indexed
                category: String,              // "interest" | "location" | "social" | "sentiment"
                createdAt: Int,
                decayWeight: Float }             // immutable once written

Place         { name: String, city: String,
                location: Point,               // Neo4j native spatial type
                category: String }

Group         { groupId: String @unique, name: String,
                description: String, category: String,
                memberCount: Int }
```

**Relationships**

```
(User)-[:HAS_CHUNK]->(PersonaChunk)
(User)-[:KNOWS {strength: Float}]->(User)
(User)-[:VISITED {count: Int, lastVisitedAt: Int}]->(Place)
(User)-[:MEMBER_OF {joinedAt: Int}]->(Group)
```

No `SIMILAR_TO` edge, no batch similarity job — see "Recommendation matching" below
for why that was dropped.

**Vector index**: native Neo4j vector index on `PersonaChunk.embedding` only.
Place/Group do **not** get a vector index — see below.

### Three deliberate deviations from the original HelixDB-era schema (`schema.hx` in old CLAUDE.md §3.1)

1. **`userId` is the namespaced string (`tg:123`) already used everywhere else in
   the codebase, not `telegram_id: I64`.** The original field predates the
   WhatsApp adapter and CLAUDE.md's own namespaced-id rule (§11 rule 4) — following
   it here would reintroduce the exact id-collision risk that rule exists to
   prevent.
2. **`PersonaChunk` is a real graph node (`User-[:HAS_CHUNK]->PersonaChunk`), not a
   side vector table with a scalar `user_id` foreign key.** That FK pattern is how
   HelixDB split nodes/edges/vectors into three separate categories; it's not
   idiomatic in a property graph, and modeling chunks as nodes lets them
   participate in traversal.
3. **`Place.lat`/`lng` become one `Point` property.** Neo4j has native
   `point.distance()`, so the geo-radius filter is a real spatial query instead of
   manual haversine math.

---

## Recommendation matching — corrected design

### The flawed version (rejected during design discussion, recorded here so it doesn't get reinvented)

The original GraphRAG pattern (old CLAUDE.md §3.3, step 4) says: traverse from a
user's top-matching `PersonaChunk`s to `Place`/`Group` nodes via `VISITED`/
`MEMBER_OF`. But those edges start at `User`, not `PersonaChunk` — so the only way
to make that traversal work is a `PersonaChunk → SIMILAR_TO(other User) →
VISITED/MEMBER_OF` hop, i.e. collaborative filtering ("recommend what people like
you did"). That has a hard cold-start problem: with the small number of real users
this bot has, it returns nothing, because it depends on _other users'_ history
already existing.

A follow-up idea — embed `Place`/`Group` (name + description + category) and
directly cosine-compare against `PersonaChunk` embeddings — was also rejected.
Reasoning: a `PersonaChunk` is a short, atomic first-person fact ("prefers cafes
for work"); a `Place` embedding would be a blended multi-field blob ("Blue Bottle
Coffee, a quiet cafe in Koramangala, category: cafe"). Generic sentence embedding
models aren't trained to make a short preference statement and a multi-field venue
description land close together just because they're topically related — that
correspondence is what retrieval-tuned, two-tower architectures are explicitly
trained to produce (separate query/document encoders, trained jointly). A generic
embedding model applied to both sides gives cosine similarity dominated by lexical
overlap and breaks silently on anything requiring inference. It also duplicates
work structured fields do better: geo-radius is a `Point` distance filter, category
("cafe", "gym", "hiking") is a small controlled vocabulary and should be a tag
match, not a similarity search.

### What to build instead

Split by what each recommendation type actually needs:

- **Place/Group discovery — structured retrieval + LLM reranking, no vector index
  on Place/Group at all.**
  1. Cheap structural filter: category tag overlap (between the user's
     extracted-interest categories and `Place.category`/`Group.category`) +
     `Point` geo-radius → a shortlist (dozens, not thousands).
  2. Hand that shortlist plus the user's `PersonaChunk`s to the LLM — reuse Stage 2
     (already in the loop every turn) or a dedicated ranking call — to judge fit
     and narrate the recommendation. This is deliberately an LLM-reasoning step,
     not a nearest-neighbor lookup, because "does this venue fit this vibe" is a
     semantic-compatibility judgment across two differently-shaped texts, which is
     exactly what LLMs are good at and generic embeddings aren't.

- **Person discovery (2nd-degree `KNOWS`) — graph traversal + same-shape vector
  comparison, no maintained similarity edge.**
  1. Graph traversal for the 2nd-degree candidate set (friend-of-friend), no
     vectors involved.
  2. Rank/explain using live `PersonaChunk`-to-`PersonaChunk` comparison between
     the requesting user and each candidate — this comparison **is** sound,
     because both sides are the same kind of text (short fact statements) run
     through the same embedding model, unlike the Place/Group case above. Compute
     it at query time over the small candidate set; no `SIMILAR_TO` edge or batch
     job needed.

---

## Decisions made so far

| Decision                                 | Answer                                                                                                                                                                                 | Status  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Neo4j vs. continue with HelixDB          | Neo4j                                                                                                                                                                                  | Decided |
| PersonaChunk embedding source            | Local FastEmbed (as the original CLAUDE.md spec'd — never actually wired in anywhere; this proposal is the first thing that would use it)                                              | Decided |
| PersonaChunk scope vs. mem0              | Not a duplicate — purpose-built for recommendation traversal, mem0 stays the general conversational memory                                                                             | Decided |
| Place/Group vector index                 | None — structured filter + LLM reranking instead (see above)                                                                                                                           | Decided |
| `SIMILAR_TO` edge / batch similarity job | Dropped — replaced by live chunk comparison scoped to the 2nd-degree `KNOWS` candidate set                                                                                             | Decided |
| What feeds `PersonaChunk` writes         | Stage 1 extraction, as proposed — now running in the `ingest` job after the reply is sent, plus a `save_persona_chunk` tool for facts the model judges worth keeping mid-conversation. | Built   |

---

## What was out of scope here, and where it ended up

- **A job queue** — built after all, as `packages/queue` (CLAUDE.md §5).
- **The LLM reranking prompt** — `buildNarrationPrompt` in
  `packages/agent/src/recommendation.ts`.
- **Wiring into the live turn** — done; `runTurn` is the entry point.
- **Seeding real Place/Group data** — still the open one. Venues come from the Places API
  live, but a group only exists once an admin creates it and runs `/register_group`. The
  schema and the matching logic are still meaningless without people to match, which is a
  product problem rather than a code one.
