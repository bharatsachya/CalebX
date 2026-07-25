import { JsonLedger } from "./json-ledger.ts";
import {
  DEFAULT_ONBOARDING_RECORD,
  type OnboardingRecord,
  type OnboardingStore,
} from "./onboarding.store.ts";
import type { UserId } from "./user-id.ts";

/**
 * File-backed onboarding state ledger.
 *
 * Survives restarts so interrupted onboarding resumes at the correct step.
 * Unknown users get a fresh copy of the default record rather than null.
 */
export class FileOnboardingStore implements OnboardingStore {
  private readonly ledger: JsonLedger<OnboardingRecord>;

  constructor(filePath: string) {
    this.ledger = new JsonLedger<OnboardingRecord>(filePath);
  }

  async get(userId: UserId): Promise<OnboardingRecord> {
    return (await this.ledger.get(userId)) ?? { ...DEFAULT_ONBOARDING_RECORD };
  }

  async set(userId: UserId, record: OnboardingRecord): Promise<void> {
    await this.ledger.set(userId, record);
  }

  async delete(userId: UserId): Promise<void> {
    await this.ledger.delete(userId);
  }
}
