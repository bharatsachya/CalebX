import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionTurn } from "@calebx/types";

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

type Ledger = Record<string, SessionRecord>;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptySession(): SessionRecord {
  return { turns: [], dailyCount: 0, day: today() };
}

/**
 * File-backed short-term session buffer. Holds recent turns + a per-day message
 * counter for each user. Same atomic temp-file+rename pattern as the other stores.
 * Never persisted to Neo4j — raw text lives only here, and only transiently.
 */
export class FileSessionStore implements SessionStore {
  private readonly filePath: string;
  private ledger: Ledger = {};
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.ledger = JSON.parse(raw) as Ledger;
    } catch {
      this.ledger = {};
    }
    this.loaded = true;
  }

  async get(telegramId: number): Promise<SessionRecord> {
    await this.ensureLoaded();
    const record = this.ledger[String(telegramId)];
    if (record === undefined) return emptySession();
    // Roll the daily counter over at midnight.
    if (record.day !== today()) {
      return { turns: record.turns, dailyCount: 0, day: today() };
    }
    return record;
  }

  async set(telegramId: number, record: SessionRecord): Promise<void> {
    await this.ensureLoaded();
    this.ledger[String(telegramId)] = record;
    await this.persist();
  }

  async delete(telegramId: number): Promise<void> {
    await this.ensureLoaded();
    delete this.ledger[String(telegramId)];
    await this.persist();
  }

  async allIds(): Promise<number[]> {
    await this.ensureLoaded();
    return Object.keys(this.ledger).map(Number);
  }

  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.ledger, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, snapshot, "utf8");
      await rename(tmp, this.filePath);
    });
    return this.writeChain;
  }
}
