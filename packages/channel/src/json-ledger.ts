import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { LEGACY_NUMERIC } from "./user-id.ts";

/**
 * A file-backed key/value ledger with atomic writes.
 *
 * Single-process, last-write-wins. Survives restarts so users are not
 * re-prompted after every deploy. Writes go through a temp file + rename so a
 * crash mid-write can never leave a truncated JSON file on disk.
 *
 * Both the consent and onboarding stores are this same shape, so the pattern
 * lives here once rather than being duplicated per store.
 */
export class JsonLedger<TValue> {
  private readonly filePath: string;
  private entries: Record<string, TValue> = {};
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.entries = JSON.parse(raw) as Record<string, TValue>;
    } catch {
      // No file yet (or unreadable) → start empty. The first write creates it.
      this.entries = {};
    }
    this.loaded = true;

    if (this.migrateLegacyKeys()) await this.persist();
  }

  /**
   * Rewrites pre-namespace keys to the `tg:` namespace.
   *
   * Ledgers written before namespaced ids existed are keyed by a bare Telegram
   * id (`"1101953596"`). Those can only have come from Telegram — WhatsApp keys
   * have always been `wa:`-prefixed — so the mapping is unambiguous.
   *
   * Runs once on first load, self-healing and idempotent. Returns whether
   * anything changed so the caller persists at most one extra write.
   */
  private migrateLegacyKeys(): boolean {
    let changed = false;
    for (const key of Object.keys(this.entries)) {
      if (!LEGACY_NUMERIC.test(key)) continue;

      const value = this.entries[key];
      const namespaced = `tg:${key}`;
      // Never clobber an already-migrated record.
      if (value !== undefined && this.entries[namespaced] === undefined) {
        this.entries[namespaced] = value;
      }
      delete this.entries[key];
      changed = true;
    }
    return changed;
  }

  async get(key: string): Promise<TValue | undefined> {
    await this.ensureLoaded();
    return this.entries[key];
  }

  async set(key: string, value: TValue): Promise<void> {
    await this.ensureLoaded();
    this.entries[key] = value;
    await this.persist();
  }

  async delete(key: string): Promise<void> {
    await this.ensureLoaded();
    delete this.entries[key];
    await this.persist();
  }

  /** Serialize writes; write atomically (temp file + rename) to avoid corruption. */
  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.entries, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, snapshot, "utf8");
      await rename(tmp, this.filePath);
    });
    return this.writeChain;
  }
}
