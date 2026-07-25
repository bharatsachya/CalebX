import { JsonLedger } from "./json-ledger.ts";
import type { ConsentStatus, ConsentStore } from "./consent.store.ts";
import type { UserId } from "./user-id.ts";

/**
 * File-backed consent ledger.
 *
 * Stores ONLY the namespaced user id and the decision — never message content.
 * Swap for a database-backed `ConsentStore` and nothing else in any bot changes.
 */
export class FileConsentStore implements ConsentStore {
  private readonly ledger: JsonLedger<ConsentStatus>;

  constructor(filePath: string) {
    this.ledger = new JsonLedger<ConsentStatus>(filePath);
  }

  async get(userId: UserId): Promise<ConsentStatus> {
    return (await this.ledger.get(userId)) ?? "unknown";
  }

  async set(userId: UserId, status: ConsentStatus): Promise<void> {
    await this.ledger.set(userId, status);
  }

  async delete(userId: UserId): Promise<void> {
    await this.ledger.delete(userId);
  }
}
