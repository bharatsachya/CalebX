# @calebx/agent

Conversational agent for CALEBX, backed by a single OpenRouter (free-tier) LLM call
per turn. No mem0, no separate extraction call — cost stays near zero.

Entry points:

- `runAgent(profile, summaries, recentTurns, message): Promise<string>` — one warm
  reply, given the user's profile, past session summaries (long-term memory), and the
  recent in-session turns (short-term memory).
- `summarizeSession(turns): Promise<{ summary, interests } | null>` — distills a chat
  session into a persona note + interest tags for storage in Neo4j.

Imports `@calebx/config`, `@calebx/errors`, `@calebx/types` only. Nothing in `core/`
imports from here.
