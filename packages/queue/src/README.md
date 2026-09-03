# @calebx/queue

Job queues, outbound pacing, and the composition root that both bots and workers share.

## The two execution modes

`AGENT_EXECUTION=inline` (default) runs the turn in the bot process. `AGENT_EXECUTION=queue`
hands it to the `agent-execution` worker. **Both call the same `handleAgentJob`**, so inline
is a deployment choice rather than a second implementation that can drift — a checkout with
Postgres and Neo4j reachable replies to a message without anyone standing up Redis first.

```bash
bun run --cwd packages/queue worker:agent      # turns
bun run --cwd packages/queue worker:ingest     # extraction → embeddings → chunks
bun run --cwd packages/queue worker:dispatch   # the only process that sends to Telegram
```

## Queues

| Queue             | Concurrency | Retries | Does                                  |
| ----------------- | ----------- | ------- | ------------------------------------- |
| `agent-execution` | 5           | 3       | router → subagent → outbound          |
| `ingest`          | 5           | 3       | extraction, embedding, persona writes |
| `dispatch`        | **1**       | 5       | the throttled send path               |
| `cohort`          | 1           | 1       | tag cohorts, then Louvain             |

Dispatch is single-threaded because the 30/s Telegram limit is **global** — a second worker
would pace against its own state and know nothing of the first one's sends.

## Pacing

`SendPacer` enforces 30/s globally, 1/s per chat, and 20/min per group, with 35–50ms of
jitter on every send. The jitter is not politeness: perfectly uniform intervals are a machine
signature, and Telegram's timing heuristics feed the bot's Contributor Quality Score.

A 429 is **re-queued, never retried inline** — sleeping through `retry_after` inside the
single dispatch worker would hold every other chat hostage for the same window.

## Typing indicator

`sendChatAction` expires after ~5s, so a long turn needs it re-sent. The busy worker cannot
do that, so it publishes `typing.start`/`typing.stop` on Redis and the dispatch worker owns
the repeat loop — on the same side of the pacer as replies, because **chat actions count
against the same budget**. Telegram only; the WhatsApp Cloud API has no typing action.

## Payload validation

Jobs outlive the code that enqueued them: a payload sitting in Redis during a deploy is read
back by the _new_ worker. So every payload is parsed on the way out of the queue, not trusted
because it was valid on the way in.
