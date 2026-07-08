/** A user's consent decision for data processing. */
export type ConsentStatus = "granted" | "declined" | "unknown";

/**
 * Port for persisting a user's consent decision.
 *
 * Consent is intentionally kept in a local file store (not Neo4j): it must be
 * checked before ANY data touches the database, so it stays outside it. The User
 * node's `consent_granted` mirrors the decision but this file is the source of truth.
 */
export interface ConsentStore {
  /** Returns the stored decision, or "unknown" if the user has never been asked. */
  get(telegramId: number): Promise<ConsentStatus>;
  /** Records a decision. */
  set(telegramId: number, status: ConsentStatus): Promise<void>;
  /** Erases the stored decision (used by /forget). */
  delete(telegramId: number): Promise<void>;
}
