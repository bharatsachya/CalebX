import type { SessionTurn } from "@calebx/types";
import type { KvNamespace } from "./env.ts";

export interface SessionRecord {
  turns: SessionTurn[];
  /** Messages counted toward today's cap. */
  dailyCount: number;
  /** YYYY-MM-DD the dailyCount belongs to; a new day resets the count. */
  day: string;
}

export interface SessionStore {
  get(telegramId: number): Promise<SessionRecord>;
  set(telegramId: number, record: SessionRecord): Promise<void>;
  delete(telegramId: number): Promise<void>;
  /** All user ids with buffered turns — used by the daily job to flush stale sessions. */
  allIds(): Promise<number[]>;
}

const KEY_PREFIX = "session:";
/** Buffers self-expire after 48h of inactivity — raw text never lingers. */
const TTL_SECONDS = 60 * 60 * 48;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptySession(): SessionRecord {
  return { turns: [], dailyCount: 0, day: today() };
}

/**
 * KV-backed short-term session buffer. Holds recent turns + a per-day message
 * counter for each user under `session:{telegramId}`. Ephemeral by design (TTL'd,
 * never persisted to Neo4j) — the same contract the file store had, minus the disk.
 */
export class KvSessionStore implements SessionStore {
  constructor(private readonly kv: KvNamespace) {}

  private key(telegramId: number): string {
    return `${KEY_PREFIX}${telegramId}`;
  }

  async get(telegramId: number): Promise<SessionRecord> {
    const raw = await this.kv.get(this.key(telegramId));
    if (raw === null) return emptySession();
    let record: SessionRecord;
    try {
      record = JSON.parse(raw) as SessionRecord;
    } catch {
      return emptySession();
    }
    // Roll the daily counter over at midnight (buffer survives, count resets).
    if (record.day !== today()) {
      return { turns: record.turns ?? [], dailyCount: 0, day: today() };
    }
    return record;
  }

  async set(telegramId: number, record: SessionRecord): Promise<void> {
    await this.kv.put(this.key(telegramId), JSON.stringify(record), {
      expirationTtl: TTL_SECONDS,
    });
  }

  async delete(telegramId: number): Promise<void> {
    await this.kv.delete(this.key(telegramId));
  }

  async allIds(): Promise<number[]> {
    const ids: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.kv.list({ prefix: KEY_PREFIX, cursor });
      for (const entry of page.keys) {
        const id = Number(entry.name.slice(KEY_PREFIX.length));
        if (Number.isFinite(id)) ids.push(id);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return ids;
  }
}
