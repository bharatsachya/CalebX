# @calebx/trace

Agent execution tracing: traces, spans, and a viewer. Answers one question —
**"what did the agent do for this turn, in what order, and where did the time go?"**

No external tracing backend, no OTLP collector, no vendor. Spans go to a JSONL file
under `.data/traces/<role>.jsonl` and a CLI renders them as a tree.

## Usage

```ts
import { initTracing, withTrace, withSpan } from "@calebx/trace";

initTracing("agent"); // once, in an entry point only

await withTrace("agent.turn", { userId, mode }, { attributes: { mode } }, async () => {
  const memories = await withSpan("mem0.search", { kind: "llm" }, () => searchMemories(...));
  await withSpan("tool.search_candidates", { kind: "tool" }, () => runTool(...));
});
```

Context flows through `AsyncLocalStorage`, so nothing has to be threaded through call
signatures — a span opened five frames deep still lands under the right parent.

## Viewing traces

```bash
bun run --cwd packages/trace view agent            # last 5 traces + slowest span names
bun run --cwd packages/trace view agent <traceId>  # one trace
TRACE_LIMIT=20 bun run --cwd packages/trace view agent
```

```
trace 4f2a…  7 spans  912ms
· agent.turn  912ms (self 21ms)  [mode=matchmaker userId=tg:***596]
   ├─ ◇ mem0.search  120ms
   ├─ ▸ tool.search_matrimonial_candidates  310ms
   │  ├─ ◇ embed.query  40ms
   │  └─ ▪ db.candidate_search  260ms  [rows=4]
   └─ ◆ llm.response  461ms  [model.name=…]
```

## Redaction

Attribute redaction is **on by default** (`assumptions.md` A7). Any attribute key
containing `text`/`message`/`phone`/`name`/`token`/… is replaced with
`[redacted:<len>:<hash8>]`, and namespaced user ids are masked to `wa:***234` — a
WhatsApp `wa_id` is a phone number. `TRACE_REDACT=off` disables it for local debugging.

## Environment

| Variable       | Default | Meaning                            |
| -------------- | ------- | ---------------------------------- |
| `TRACE`        | `on`    | `off` disables tracing entirely    |
| `TRACE_STDOUT` | `false` | also emit JSON lines to stdout     |
| `TRACE_REDACT` | `on`    | `off` disables attribute redaction |
| `TRACE_LIMIT`  | `5`     | traces shown by the viewer         |
