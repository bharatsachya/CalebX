import type { UserId } from "./user-id.ts";

/** A user's consent decision for data processing. */
export type ConsentStatus = "granted" | "declined" | "unknown";

/**
 * Port for persisting a user's consent decision.
 *
 * Keys are namespaced `UserId`s, never raw platform ids — see `user-id.ts`.
 * Implementations store only the id and the decision; never message content.
 *
 * The current implementation is file-backed (`FileConsentStore`). When the
 * HelixDB layer lands, an adapter writing `User.consentGranted` drops in here
 * with no change to any caller.
 */
export interface ConsentStore {
  /** Returns the stored decision, or "unknown" if the user has never been asked. */
  get(userId: UserId): Promise<ConsentStatus>;
  /** Records a decision. */
  set(userId: UserId, status: ConsentStatus): Promise<void>;
  /** Erases the stored decision (used by /forget). */
  delete(userId: UserId): Promise<void>;
}
