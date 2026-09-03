# @calebx/community

The community subagent: people, groups and places. Neo4j plus the Places API — no
candidate tables.

## Tools

| Tool                      | Notes                                                                |
| ------------------------- | -------------------------------------------------------------------- |
| `save_persona_chunk`      | One durable fact, embedded and appended. Never announced to the user |
| `find_like_minded_people` | Second-degree `KNOWS` traversal, then live chunk-to-chunk ranking    |
| `search_community_groups` | Cohort key → a group that actually exists **and** has an invite link |
| `get_curated_places`      | Places Nearby Search filtered by the user's interest categories      |

## Retrieval shape

Always **graph first, rank second**. The candidate set comes from traversal — friends of
friends, a cohort key — and only then is it ranked. An unconstrained vector search across
all users is both slower and a privacy boundary violation.

- **People:** `secondDegreePeers` → consent filter → `peerAffinity` over decayed chunks.
  Both sides of that comparison are short first-person facts run through the same model,
  which is what makes it sound. `assumptions.md` A8 for the mode boundary.
- **Groups:** `listReady` returns only cohorts with a real `group_id` _and_ an invite link.
  Anything else is a suggestion the user cannot act on.
- **Places:** no vector index, ever. Category tags are a controlled vocabulary and geo is a
  radius — both are structured filters that a similarity search does worse.

## Decay

`decayWeight` is computed at read time from `createdAt`, with a 90-day half-life. Chunks are
immutable, so a contradiction writes a new one and the old one simply weighs less — the
temporal trail _is_ the persona history. No cron, no stored weight to drift.

## Cohorts

`buildTagCohorts` (category + city) ships first and works at twenty users. `louvainCommunities`
runs graphology's Louvain in-process — hosted AuraDB has no GDS library — and takes over
behind the same `communityId` once `KNOWS` is dense enough.

## Places and the terms of use

`PlacesClient` is the only place Google's data exists in the process. `place_id` may be
stored indefinitely; names, addresses and coordinates may not, so every recommendation
re-hydrates them live and `Place` in Neo4j holds identity plus our own tags. See
`assumptions.md` A5. `StubPlacesClient` returns obviously-fake results for tests and for
running without a key.
