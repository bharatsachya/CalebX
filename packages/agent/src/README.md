# packages/agent/src

Source files for the agent pipeline (single free-tier LLM call per turn):

- llm.ts — OpenRouter client (openai SDK, baseURL override); `responseCall` / `summarizeCall`.
- system-prompt.ts — CALEBX personality prompt, turn rendering, and the summarization prompt.
- agent.ts — `runAgent()` (one reply) and `summarizeSession()` (session → summary + interests).
- index.ts — public re-export.

Config comes from `@calebx/config`. No mem0, no separate extraction call.
