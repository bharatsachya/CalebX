# packages/agent/src

Source files for the agent pipeline:

- config.ts — env var reads (OPENROUTER_API_KEY, MEM0_API_KEY, OPENROUTER_MODEL)
- llm.ts — OpenRouter client (openai SDK, baseURL override); enforces stage temperature split
- memory.ts — mem0 client: searchMemories, addMemory
- system-prompt.ts — CALEBX personality prompt and extraction prompt
- agent.ts — runAgent() implementation (two-stage pipeline)
- index.ts — public re-export
