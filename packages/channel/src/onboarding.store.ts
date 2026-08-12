import type { UserId } from "./user-id.ts";

/** Where a user is in the four-question onboarding sequence. */
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

/** A brand-new user starts at the first question. */
export const DEFAULT_ONBOARDING_RECORD: OnboardingRecord = {
  step: "pending_name",
};

/**
 * Port for onboarding progress. Keyed by namespaced `UserId`.
 *
 * `get` never returns null — an unknown user yields a fresh
 * `DEFAULT_ONBOARDING_RECORD` so callers can treat "new" and "in progress"
 * identically.
 */
export interface OnboardingStore {
  get(userId: UserId): Promise<OnboardingRecord>;
  set(userId: UserId, record: OnboardingRecord): Promise<void>;
  delete(userId: UserId): Promise<void>;
}
