# src

- `config.ts` — reads `DATABASE_URL` through `@calebx/config` (which loads the
  repo-root `.env`).
- `db.ts` — the one `pg.Pool` for the process, plus `query`/`queryOne` helpers.
- `migrate.ts` — applies `migrations/*.sql` in order, tracked in `schema_migrations`.
- `types.ts` — hand-written TS mirrors of the six tables. Update by hand
  alongside any migration that changes a column.
- `candidates.repo.ts` — find-or-create by `wa_phone`, consent read/write.
- `messages.repo.ts` — logs one row per WhatsApp message (idempotent on
  `wa_message_id`). Other tables get their own `*.repo.ts` as they're needed.
- `migrations/` — the schema. See its own README.
