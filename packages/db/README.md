# @calebx/db

Neo4j adapter layer. Implements the `@calebx/core` persistence ports against a Neo4j
instance (connection details come from `@calebx/config`: `NEO4J_URI`, `NEO4J_USERNAME`,
`NEO4J_PASSWORD`).

## Setup

Provide your own Neo4j instance (e.g. Aura free tier) via `.env`, then create the
schema constraints:

```bash
bun run db:migrate
```

## Data model

```
(:User { telegram_id UNIQUE, username, name, city, age, purpose,
         consent_granted, created_at, last_active, photo_file_id })
(:Summary { id UNIQUE, text, interests: [string], created_at })

(:User)-[:HAS_SUMMARY]->(:Summary)
(:User)-[:RECOMMENDED { id, score, shared, status, a_accepted, b_accepted, created_at }]->(:User)
```

Raw messages are never stored — only LLM-distilled summaries and interest tags.
