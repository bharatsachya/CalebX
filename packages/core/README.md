# Core Package

Core business logic of CalebX: domain entities, the pure matching use-case, and
repository ports (interfaces) that keep the system decoupled from external platforms
(e.g., Telegram) and databases (e.g., Neo4j).

- `entities.ts` — `User`, `UserProfile`.
- `ports.ts` — `IUserRepository`, `ISummaryStore`, `IRecommendationStore`.
- `matching.ts` — pure compatibility scoring + greedy pair selection (`pickRecommendations`).

Imports `@calebx/types` only. No adapter/platform code lives here.
