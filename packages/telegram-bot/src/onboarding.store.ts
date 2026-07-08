import { run } from "@calebx/db";

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

const DEFAULT_RECORD: OnboardingRecord = { step: "pending_name" };

/**
 * Neo4j-backed onboarding state. Persists the current step + the profile fields it
 * collects onto the User node (same properties the profile uses), so interrupted
 * onboarding resumes correctly across restarts and instances.
 */
export class Neo4jOnboardingStore implements OnboardingStore {
  async get(telegramId: number): Promise<OnboardingRecord> {
    const result = await run(
      `MATCH (u:User { telegram_id: $telegramId })
       RETURN u.onboarding_step AS step, u.name AS name, u.city AS city,
              u.age AS age, u.purpose AS purpose`,
      { telegramId },
    );
    const row = result.records[0];
    if (!row) return { ...DEFAULT_RECORD };

    const step = row.get("step");
    if (typeof step !== "string") return { ...DEFAULT_RECORD };

    const record: OnboardingRecord = { step: step as OnboardingStep };
    const name = row.get("name");
    if (typeof name === "string") record.name = name;
    const city = row.get("city");
    if (typeof city === "string") record.city = city;
    const age = row.get("age");
    if (typeof age === "string") record.age = age;
    const purpose = row.get("purpose");
    if (typeof purpose === "string") record.purpose = purpose;
    return record;
  }

  async set(telegramId: number, record: OnboardingRecord): Promise<void> {
    await run(
      `MERGE (u:User { telegram_id: $telegramId })
       ON CREATE SET u.created_at = $now
       SET u.onboarding_step = $step,
           u.name = coalesce($name, u.name),
           u.city = coalesce($city, u.city),
           u.age = coalesce($age, u.age),
           u.purpose = coalesce($purpose, u.purpose),
           u.last_active = $now`,
      {
        telegramId,
        step: record.step,
        name: record.name ?? null,
        city: record.city ?? null,
        age: record.age ?? null,
        purpose: record.purpose ?? null,
        now: Date.now(),
      },
    );
  }

  async delete(telegramId: number): Promise<void> {
    await run(
      `MATCH (u:User { telegram_id: $telegramId })
       REMOVE u.onboarding_step, u.name, u.city, u.age, u.purpose`,
      { telegramId },
    );
  }
}
