# Worker entry points

Three processes, each deliberately thin. Everything worth testing — pacing, retries, payload
validation, the turn itself, ingestion — lives in the parent directory and is exercised
without Redis; what is left here is BullMQ wiring and process lifecycle.

- **`agent.worker.ts`** — consumes `agent-execution`, enqueues the reply and the ingest job.
  On the final failed attempt it queues the fallback message itself: a failed turn still owes
  the user a reply.
- **`ingest.worker.ts`** — extraction → embedding → persona chunks. Its failures are invisible
  to the user by design, so they are loud in the log; a silently empty persona graph is very
  hard to notice.
- **`dispatch.worker.ts`** — the only process that sends to Telegram, and the only one that
  may. Also owns the typing loop.
