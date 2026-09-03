import MemoryClient from "mem0ai";
import type { AgentMode } from "@calebx/core";
import { withSpan } from "@calebx/trace";
import { agentConfig } from "./config.ts";

interface Mem0SearchResult {
  memory: string;
  score?: number;
}

/**
 * Constructed on first use, not at import.
 *
 * `new MemoryClient()` pings mem0 to initialise, so building it at module load
 * meant every process that merely imported this package — including the test
 * runner — made a network call and needed a key.
 */
let client: MemoryClient | null = null;

function mem0(): MemoryClient {
  if (!client) client = new MemoryClient({ apiKey: agentConfig.mem0ApiKey });
  return client;
}

/**
 * mem0's `user_id` space is flat, and the two modes are separate products with
 * separate data practices. Sharing one key would surface matrimonial memories
 * inside a community reply, and `search` has no filter to prevent it — so the
 * mode is part of the key.
 *
 * `tg:1001#matchmaker`. The `#` cannot appear in a namespaced id, so the split
 * is unambiguous in both directions.
 */
export function memoryKey(userId: string, mode: AgentMode | null): string {
  return mode === null ? userId : `${userId}#${mode}`;
}

/** Both mode keys plus the pre-mode key, for a complete `/forget`. */
export function allMemoryKeys(userId: string): string[] {
  return [
    userId,
    memoryKey(userId, "matchmaker"),
    memoryKey(userId, "community_connector"),
  ];
}

/**
 * Memories relevant to the current message, most relevant first.
 *
 * Returns an empty array rather than throwing when mem0 is unreachable: a turn
 * with no recalled context is degraded, but a turn that fails outright leaves
 * the user with nothing at all.
 */
export async function searchMemories(
  userId: string,
  mode: AgentMode | null,
  query: string,
): Promise<string[]> {
  return withSpan(
    "mem0.search",
    { kind: "http", attributes: { mode: mode ?? "unassigned" } },
    async (span) => {
      try {
        const results = await mem0().search(query, {
          user_id: memoryKey(userId, mode),
          limit: 10,
        });
        const memories = (results as Mem0SearchResult[])
          .filter((result) => typeof result.memory === "string")
          .map((result) => result.memory);
        span.setAttributes({ "message.count": memories.length });
        return memories;
      } catch (error) {
        span.recordError(error);
        return [];
      }
    },
  );
}

/**
 * Stores a turn. Best-effort by contract: a memory write must never take down a
 * reply the user is waiting for.
 */
export async function addMemory(
  userId: string,
  mode: AgentMode | null,
  message: string,
  response: string,
): Promise<boolean> {
  return withSpan(
    "mem0.add",
    { kind: "http", attributes: { mode: mode ?? "unassigned" } },
    async (span) => {
      try {
        await mem0().add(
          [
            { role: "user", content: message },
            { role: "assistant", content: response },
          ],
          { user_id: memoryKey(userId, mode) },
        );
        return true;
      } catch (error) {
        span.recordError(error);
        return false;
      }
    },
  );
}

/**
 * Erases every memory for this user, in both modes.
 *
 * Unlike the writes above this one is *not* best-effort — a `/forget` that
 * silently half-succeeds tells the user their data is gone when it is not. The
 * caller must surface a failure.
 */
export async function deleteAllMemories(userId: string): Promise<void> {
  await withSpan("mem0.deleteAll", { kind: "http" }, async () => {
    for (const key of allMemoryKeys(userId)) {
      await mem0().deleteAll({ user_id: key });
    }
  });
}

/**
 * The memory port.
 *
 * Injectable so a turn can be tested without a network round-trip to mem0 — and
 * so a future store can replace it without touching the turn logic. `runTurn`
 * takes it from `AgentDeps` and falls back to the mem0 implementation.
 */
export interface MemoryPort {
  search(
    userId: string,
    mode: AgentMode | null,
    query: string,
  ): Promise<string[]>;
  add(
    userId: string,
    mode: AgentMode | null,
    message: string,
    response: string,
  ): Promise<boolean>;
  deleteAll(userId: string): Promise<void>;
}

export const mem0Memory: MemoryPort = {
  search: searchMemories,
  add: addMemory,
  deleteAll: deleteAllMemories,
};

/** Records calls and returns nothing. For tests and offline runs. */
export class NullMemory implements MemoryPort {
  readonly searches: {
    userId: string;
    mode: AgentMode | null;
    query: string;
  }[] = [];
  readonly writes: {
    userId: string;
    mode: AgentMode | null;
    message: string;
  }[] = [];

  constructor(private readonly canned: string[] = []) {}

  async search(userId: string, mode: AgentMode | null, query: string) {
    this.searches.push({ userId, mode, query });
    return this.canned;
  }

  async add(userId: string, mode: AgentMode | null, message: string) {
    this.writes.push({ userId, mode, message });
    return true;
  }

  async deleteAll() {
    /* nothing stored */
  }
}
