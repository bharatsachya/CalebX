# src

- `config.ts` — loads `DATABASE_URL` from the repo-root `.env`.
- `db.ts` — the one `pg.Pool` for the process, plus `query`/`queryOne` helpers.
- `migrate.ts` — applies `migrations/*.sql` in order, tracked in `schema_migrations`.
- `types.ts` — hand-written TS mirrors of the six tables. Update by hand
  alongside any migration that changes a column.
- `migrations/` — the schema. See its own README.
