# @calebx/db

Postgres domain package for the WhatsApp matchmaking product. This is a
**separate product from CALEBX** sharing this monorepo — it no longer wraps
HelixDB, and does not depend on `@calebx/core` or `@calebx/channel`. CALEBX's
own persistence (the `IUserRepository` mock this package used to provide) now
lives directly in `packages/telegram-bot`, its only real consumer.

One database, six tables, no ORM: `candidates`, `contact_details`, `messages`,
`partner_prefs`, `matches`, `photos`. Matches are created by hand in v1 — there
is no algorithmic matcher, so there is no `match_events` table yet either
(deferred until something actually needs it).

## Running migrations

```bash
DATABASE_URL=postgres://localhost:5432/calebx_matchmaking bun run --cwd packages/db migrate
```

Migrations are plain numbered `.sql` files in `src/migrations/`, applied once
each in filename order and tracked in a `schema_migrations` table. Add a new
migration by adding a new numbered file — never edit one that has already
shipped.

## What must never happen

`contact_details` rows are never serialized into any payload sent to another
candidate, a match summary, or a WhatsApp message — the platform never shares
contact info automatically. The only path to a candidate seeing another's
contact details is a manual admin action after mutual interest.
