import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ConsentStatus, ConsentStore } from "./consent.store.ts";

type Ledger = Record<string, ConsentStatus>;

/**
 * File-backed consent ledger. Single-process, last-write-wins.
 *
 * Survives restarts so users are not re-prompted after every deploy. Stores ONLY
 * the telegram id and the decision — never message content. When the HelixDB layer
 * lands, swap this for an adapter that writes `User.consentGranted`; nothing else
 * in the bot changes (it depends on the `ConsentStore` interface, not this class).
 */
export class FileConsentStore implements ConsentStore {
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
      // No file yet (or unreadable) → start empty. The first write creates it.
      this.ledger = {};
    }
    this.loaded = true;
  }

  async get(telegramId: number): Promise<ConsentStatus> {
    await this.ensureLoaded();
    return this.ledger[String(telegramId)] ?? "unknown";
  }

  async set(telegramId: number, status: ConsentStatus): Promise<void> {
    await this.ensureLoaded();
    this.ledger[String(telegramId)] = status;
    await this.persist();
  }

  async delete(telegramId: number): Promise<void> {
    await this.ensureLoaded();
    delete this.ledger[String(telegramId)];
    await this.persist();
  }

  /** Serialize writes; write atomically (temp file + rename) to avoid corruption. */
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
