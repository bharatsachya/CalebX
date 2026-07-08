# DB Source

Neo4j adapters implementing `@calebx/core` ports.

- `driver.ts` — shared `neo4j-driver` pool + `run()` helper (maps failures to `Neo4jError`).
- `user.repository.ts` — `Neo4jUserRepository` implements `IUserRepository`.
- `summary.store.ts` — `Neo4jSummaryStore` implements `ISummaryStore`.
- `recommendation.store.ts` — `Neo4jRecommendationStore` implements `IRecommendationStore`.
  Every cross-user read/mutation is gated on a `RECOMMENDED` edge involving the caller —
  this is the only place another user's data is ever returned.
