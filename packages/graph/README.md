# @calebx/graph

The Neo4j persona graph: `User`, `PersonaChunk`, `Place`, `Group`, and the
`HAS_CHUNK` / `KNOWS` / `VISITED` / `MEMBER_OF` edges between them.

This is the recommendation index. It is **not** a replacement for mem0 — mem0 stays the
conversational memory; this exists because mem0 cannot traverse a social graph or answer
"who are the friends-of-friends who also like filter coffee".

## Two implementations, same behaviour

- `Neo4jGraphStore` — hosted AuraDB.
- `MemoryGraphStore` — a **complete** in-memory implementation, not a stub. Same
  traversals, same authorization checks (both call the shared helpers in `access.ts`).
  A fake that is more permissive than the real store turns every passing test into a
  false negative, so the checks live in one place and parity is asserted in tests.

## Authorization is doubled on purpose

1. `access.ts` decides whether the caller may do this at all (`@calebx/authz` policy).
2. Every query runs through `scopedCypher`, which refuses a statement that neither binds
   `$ownerId` nor carries `// authz:bulk`.

`cypher.test.ts` asserts that **every statement exported from `cypher.ts`** passes that
check, and that `ALL_STATEMENTS` covers every export — so a new query cannot be added
without being checked.

## Schema deviations from the original design

- `Place` holds `placeId` + our own tags only, and **no `Point`**. Google Places terms
  permit storing `place_id` indefinitely but not caching names or coordinates, so
  geo-radius happens in Nearby Search (`assumptions.md` A5).
- No `decayWeight` column. Chunks are immutable and decay is computed at read time from
  `createdAt` — no cron, no write amplification (A6).
- `Group` carries `inviteLink` and `cohortKey`, because a bot cannot create a Telegram
  group (A2).

## Applying the schema

```bash
bun run --cwd packages/graph schema
```

Every statement is `IF NOT EXISTS`, so it is safe to re-run against a live database.

## Environment

`NEO4J_URI`, `NEO4J_PASSWORD` (required), `NEO4J_USER` (default `neo4j`),
`NEO4J_DATABASE` (default `neo4j`).
