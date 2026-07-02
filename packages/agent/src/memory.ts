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
 * userId is converted to string — mem0's user_id param is a string,
 * but Telegram IDs from GramIO are numbers.
 */
export async function searchMemories(
  userId: number,
  query: string,
): Promise<string[]> {
  const results = await mem0.search(query, {
    user_id: String(userId),
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
  userId: number,
  message: string,
  response: string,
): Promise<void> {
  await mem0.add(
    [
      { role: "user", content: message },
      { role: "assistant", content: response },
    ],
    { user_id: String(userId) },
  );
}
