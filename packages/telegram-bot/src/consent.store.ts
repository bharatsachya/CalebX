/** A user's consent decision for data processing. */
export type ConsentStatus = "granted" | "declined" | "unknown";

/**
 * Port for persisting a user's consent decision.
 *
 * NOTE: this interface's permanent home is `@calebx/core` (core/ports), and its
 * real implementation will be the HelixDB adapter writing `User.consentGranted`.
 * It lives here for now so the bot is runnable without a database. Moving it
 * later is a copy + re-export — no logic change.
 */
export interface ConsentStore {
  /** Returns the stored decision, or "unknown" if the user has never been asked. */
  get(telegramId: number): Promise<ConsentStatus>;
  /** Records a decision. */
  set(telegramId: number, status: ConsentStatus): Promise<void>;
  /** Erases the stored decision (used by /forget). */
  delete(telegramId: number): Promise<void>;
}
