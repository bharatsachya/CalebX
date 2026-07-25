import MemoryClient from "mem0ai";
import { agentConfig } from "./config.ts";

interface Mem0SearchResult {
  memory: string;
  score?: number;
}

const mem0 = new MemoryClient({ apiKey: agentConfig.mem0ApiKey });

/**
 * Returns memories for this user relevant to the current message,
 * most relevant first. Returns an empty array if mem0 has nothing yet.
 *
 * userId is a namespaced id from `@calebx/channel` ("tg:123", "wa:4477...").
 * The namespace is what keeps a WhatsApp phone number from colliding with a
 * Telegram id here — mem0 has a single flat user_id space.
 */
export async function searchMemories(
  userId: string,
  query: string,
): Promise<string[]> {
  const results = await mem0.search(query, {
    user_id: userId,
    limit: 10,
  });
  return (results as Mem0SearchResult[])
    .filter((r) => typeof r.memory === "string")
    .map((r) => r.memory);
}

/**
 * Stores a user turn (message + agent reply) as a paired memory.
 * mem0 handles deduplication and contradiction resolution automatically.
 */
export async function addMemory(
  userId: string,
  message: string,
  response: string,
): Promise<void> {
  await mem0.add(
    [
      { role: "user", content: message },
      { role: "assistant", content: response },
    ],
    { user_id: userId },
  );
}
