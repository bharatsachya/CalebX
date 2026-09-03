import { Queue } from "bullmq";
import IORedis from "ioredis";
import { getQueueConfig } from "./config.ts";
import {
  CONCURRENCY,
  QUEUE_NAMES,
  RETRY_POLICY,
  type AgentJob,
  type DispatchJob,
  type IngestJob,
  type QueueName,
} from "./payloads.ts";

/**
 * BullMQ wiring.
 *
 * Deliberately thin: everything worth testing — pacing, retries, payload
 * validation, ingestion — lives in its own module and is exercised without
 * Redis. What is left here is connection management and the enqueue helpers.
 */

let connection: IORedis | null = null;

/**
 * BullMQ requires `maxRetriesPerRequest: null` on its connection; without it a
 * blocking command that outlives the retry budget kills the worker.
 */
export function getConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(getQueueConfig().redisUrl, {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

/** A separate connection: a subscriber cannot issue ordinary commands. */
export function createSubscriber(): IORedis {
  return new IORedis(getQueueConfig().redisUrl, { maxRetriesPerRequest: null });
}

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;

  const policy = RETRY_POLICY[name];
  const queue = new Queue(name, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: policy.attempts,
      backoff: { type: "exponential", delay: policy.backoffMs },
      // Keep a short tail for debugging; the trace file is the real record.
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });
  queues.set(name, queue);
  return queue;
}

export async function enqueueAgentTurn(job: AgentJob): Promise<void> {
  await getQueue(QUEUE_NAMES.agent).add("turn", job);
}

export async function enqueueIngest(job: IngestJob): Promise<void> {
  await getQueue(QUEUE_NAMES.ingest).add("ingest", job);
}

export async function enqueueDispatch(
  job: DispatchJob,
  delayMs = 0,
): Promise<void> {
  await getQueue(QUEUE_NAMES.dispatch).add("send", job, {
    delay: delayMs > 0 ? delayMs : undefined,
  });
}

export function concurrencyFor(name: QueueName): number {
  return CONCURRENCY[name];
}

export async function closeQueues(): Promise<void> {
  for (const queue of queues.values()) await queue.close();
  queues.clear();
  await connection?.quit();
  connection = null;
}
