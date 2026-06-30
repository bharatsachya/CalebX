import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type OnboardingStep =
  | "pending_name"
  | "pending_city"
  | "pending_age"
  | "pending_purpose"
  | "complete";

export interface OnboardingRecord {
  step: OnboardingStep;
  name?: string;
  city?: string;
  age?: string;
  purpose?: string;
}

export interface OnboardingStore {
  get(telegramId: number): Promise<OnboardingRecord>;
  set(telegramId: number, record: OnboardingRecord): Promise<void>;
  delete(telegramId: number): Promise<void>;
}

type Ledger = Record<string, OnboardingRecord>;

const DEFAULT_RECORD: OnboardingRecord = { step: "pending_name" };

/**
 * File-backed onboarding state ledger. Same atomic-write pattern as FileConsentStore.
 * Survives restarts so interrupted onboarding resumes at the correct step.
 */
export class FileOnboardingStore implements OnboardingStore {
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

  async get(telegramId: number): Promise<OnboardingRecord> {
    await this.ensureLoaded();
    return this.ledger[String(telegramId)] ?? { ...DEFAULT_RECORD };
  }

  async set(telegramId: number, record: OnboardingRecord): Promise<void> {
    await this.ensureLoaded();
    this.ledger[String(telegramId)] = record;
    await this.persist();
  }

  async delete(telegramId: number): Promise<void> {
    await this.ensureLoaded();
    delete this.ledger[String(telegramId)];
    await this.persist();
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
