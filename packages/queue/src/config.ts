import { env } from "@calebx/config";

const e = env("queue");

export interface QueueConfig {
  redisUrl: string;
  adminChatId: string | null;
}

let cached: QueueConfig | null = null;

export function getQueueConfig(): QueueConfig {
  if (cached) return cached;
  cached = {
    redisUrl: e.optional("REDIS_URL", "redis://localhost:6379"),
    // Optional: a deployment with no coordinator still runs, it just cannot
    // notify anyone. The review tasks are still recorded either way.
    adminChatId: e.optional("ADMIN_CHAT_ID", "") || null,
  };
  return cached;
}
