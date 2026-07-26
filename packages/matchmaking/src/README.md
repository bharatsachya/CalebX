# src

- `config.ts` — loads `DATABASE_URL` from the repo-root `.env`.
- `db.ts` — the one `pg.Pool` for the process, plus `query`/`queryOne` helpers.
- `migrate.ts` — applies `migrations/*.sql` in order, tracked in `schema_migrations`.
- `types.ts` — hand-written TS mirrors of the six tables. Update by hand
  alongside any migration that changes a column.
- `candidates.repo.ts` — find-or-create by `wa_phone`, consent read/write.
  Other tables get their own `*.repo.ts` as the PRs that need them land.
- `migrations/` — the schema. See its own README.
