# Assumptions

Decisions taken without an explicit answer, recorded so they can be overridden cheaply.
Each entry: what was assumed, why, and what to change if it is wrong.

> Format is stable on purpose — this file is read by humans reviewing the build, not by code.

---

## A1 — Human-review surface is Postgres + an admin Telegram chat

`review_tasks` in Postgres is the queue of record; the bot posts each open task into the
chat id in `ADMIN_CHAT_ID` with inline Approve/Decline buttons.

**Why:** the alternative (coordinators working in the existing Google Sheet) would make the
matchmaking product's Sheet a write target for the agent, which couples the two products
that CLAUDE.md §0.1 keeps separate.

**If wrong:** `packages/matchmaking/src/review.ts` is the only consumer of the repo; swap
its store for a Sheets-backed one. Nothing else changes.

---

## A2 — Groups are created by a human admin, then registered by the bot

A bot cannot create a Telegram group (Bot API has no method; group creation needs a user
account, i.e. MTProto, which CLAUDE.md §6.3 bans). So the cohort job files a
`create_group` review task, an admin creates the group and adds the bot as admin, and the
admin runs `/register_group` inside it. The bot then mints the invite link itself.

**Why:** the only ToS-compliant path.

**If wrong (you want a pre-created pool):** keep `cohort_groups` as-is and pre-insert rows
with `group_id` already filled; `claimGroupForCohort` already handles a pre-registered row.

---

## A3 — Sheets → Postgres is a one-shot import plus a periodic one-way sync

`form-bot.ts` keeps writing to the Sheet, so a one-shot import would make every later
signup invisible to the matchmaker. The sync is idempotent on the candidate's normalised
phone and never writes back to Sheets.

**If wrong:** drop the repeatable job registration in `packages/queue/src/schedule.ts`.

---

## A4 — Embeddings: `bge-small-en-v1.5`, 384 dimensions, behind a service interface

The dimension is baked into both `CREATE VECTOR INDEX` (Neo4j) and `vector(384)`
(Postgres), so it had to be fixed now. `EmbeddingProvider` is an interface with three
implementations: an HTTP client (`EMBED_SERVICE_URL`), an optional in-process FastEmbed
provider, and a deterministic hash embedder used by tests and offline dev.

**If wrong:** change `EMBEDDING_DIMENSIONS` in `packages/embed/src/dimensions.ts` and
reindex both stores. The constant is imported by the migration test and the graph schema,
so a mismatch fails a unit test rather than silently corrupting a query.

---

## A5 — Place data is API-owned; `Place` nodes store only identity

Google Places terms permit storing `place_id` indefinitely but not caching names,
addresses, or coordinates beyond ~30 days, and prohibit building a derived catalog. So
`Place` holds `placeId` + our own tags, and everything user-visible is hydrated live.
Geo-radius therefore happens in Nearby Search, not `point.distance()`.

**If wrong (switch to Foursquare/OSM, which permit persistence):** add `location: Point`
back to the `Place` node and move the radius filter into `packages/community/src/cypher/places.ts`.

---

## A6 — Decay is computed at read time, not stored

`PersonaChunk.decayWeight` is not a column. `effectiveScore = similarity * decay(ageDays)`
with a half-life constant. Chunks stay immutable, there is no decay cron, and no write
amplification.

**If wrong:** the half-life lives in `packages/community/src/decay.ts`.

---

## A7 — Trace attributes are redacted by default

Raw message text, phone numbers, invite links, and tokens never reach a span attribute;
they are replaced with `[redacted:<len>:<hash8>]`. Namespaced user ids are masked to
`wa:***234` because a WhatsApp `wa_id` _is_ a phone number.

**Why:** traces get shipped to files and read by whoever debugs. mem0 already stores raw
text — the trace log should not become a second copy of it.

**If wrong:** `TRACE_REDACT=off` disables it for local debugging only.

---

## A8 — Mode isolation is enforced in the authorization layer, not by convention

A principal carries exactly one `mode`. Every resource carries the mode it belongs to, and
a cross-mode access is denied even when the principal owns the resource. This is what keeps
a matchmaker turn from reading community persona chunks.

**If wrong (you want one shared persona across modes):** delete the mode check in
`packages/authz/src/policy.ts` — it is one clause, and its test names say so.

---

## A9 — Background jobs use an explicit `system` principal that cannot read PII

The cohort job legitimately reads across users. Rather than bypassing authorization, it
runs as a `system` principal that is allowed bulk graph reads and denied every
contact/PII-returning action.

**If wrong:** nothing to change; this is strictly safer than the alternative.

---

## A10 — `/recommendation` is agent-triggered, not user-typed

When a user asks for a recommendation in plain language, the agent invokes the
recommendation path itself. The command exists as a manual shortcut. CALEBX never replies
"type /recommendation".

**If wrong:** `RECOMMENDATION_TRIGGER_MODE` in `packages/agent/src/config.ts` switches
between `auto` and `command_only`.

---

## A11 — Review tasks have no SLA, but the user can ask

A pending `mutual_interest` sits open until an admin acts. The user is told it is being
looked at, and asking again returns the real state. No reminder job is scheduled.

**If wrong:** add a repeatable `review-reminder` job; the repo already exposes
`listOpenOlderThan`.

---

## A12 — Matchmaker mode writes nothing from background extraction

The ingest job is a no-op for `matchmaker`. Partner preferences are only ever written
through `update_partner_preferences`, which makes the user confirm first.

**Why:** a background job quietly saving "prefers vegetarian" because the model inferred it
from one sentence is exactly the silent profile rewrite the confirmation rule exists to
prevent. Candidate interest text comes from the biodata import, not from conversation.

**If wrong:** `runIngest` in `packages/queue/src/ingest.ts` has the branch and its reason;
adding a matchmaker path there is a dozen lines.

---

## A13 — Two execution modes, one code path

`AGENT_EXECUTION=inline` (the default) runs the turn in the bot process;
`AGENT_EXECUTION=queue` hands it to the `agent-execution` worker. Both call the same
`handleAgentJob`.

**Why:** requiring Redis and three worker processes before a checkout can reply to a message
makes the product hard to run and hard to demo. Sharing the entry point is what stops inline
from becoming a second implementation that drifts.

**If wrong:** delete `createInlineRunner` and make `createRunner` always queue.

---

## A14 — The first mode is covered by the consent given at /start

The router assigns a mode on the first substantive message without asking again. Only a
later `/switch` into the _second_ mode prompts for that mode's own consent.

**Why:** the user has just read the privacy notice and tapped agree; asking a second time in
the same minute reads as a broken bot. The second mode genuinely differs — matchmaking
collects contact details and biodata — which is why that one does ask.

**If wrong:** the prompt already exists (`copy.modeConsentRequest`); call it from the
`needs_router` branch in `runTurn` as well.

---

## A15 — A principal owns both its namespaced id and its Postgres hash

`candidates` keys ownership by `user_id_hash`; everything else keys it by `tg:123`. Rather
than comparing across two id spaces, the principal carries the hash as an alias.

**Why:** the alternative is a policy that compares different id spaces, or a principal whose
identity changes depending on which table it is about to touch.

**If wrong:** `ownsId` in `packages/authz/src/principal.ts` is four lines.

---

## A16 — WhatsApp always runs inline

The queued path is Telegram-only. WhatsApp's Cloud API has its own per-number limits, its own
send path in `packages/whatsapp-bot`, and that package already serialises per user.

**If wrong:** add a WhatsApp sender to `dispatch.worker.ts`, which currently throws for
`channel: "wa"` rather than dropping the job silently.

---

## A17 — Discoverability is a command, not a question mid-conversation

People discovery is opt-in via `/findme`. The agent does not ask for it in the middle of a
turn.

**Why:** an interruption asking "may I describe you to strangers?" in the middle of a
conversation about cafes is jarring, and consent given to get past a prompt is not consent.

**If wrong:** the copy exists (`copy.DISCOVERABLE_REQUEST`); the community persona can be
told to offer it once the conversation is warm.
