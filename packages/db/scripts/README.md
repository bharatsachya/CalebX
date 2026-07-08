# db/scripts

One-off operational scripts for the Neo4j layer.

- `migrate.ts` — idempotent schema setup (uniqueness constraints on `User.telegram_id`
  and `Summary.id`). Run once against your instance: `bun run db:migrate`.
