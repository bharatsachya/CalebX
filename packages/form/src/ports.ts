/**
 * Storage ports. Implemented by `@calebx/sheets`.
 *
 * Defined here rather than in `packages/core` for the same reason
 * `packages/channel` defines `ConsentStore` and `OnboardingStore` locally: the
 * port belongs to the domain that uses it, and `core` holds only what is shared
 * across products.
 *
 * The split into three ports is a safety boundary, not tidiness. `MatchStore`
 * has no write method, so no handler can persist to the curated Matches tab.
 * `ContactStore` is separate from both, so the `/match` path — which is only
 * ever handed a `MatchStore` — has no route to a phone number. The rule in
 * `003_contact_details.sql` is enforced by what the types make reachable.
 */

import type { CandidateProfile, ContactRecord, Match } from "./types.ts";

export interface CandidateStore {
  /** Null for a user who has not answered anything yet. */
  get(userId: string): Promise<CandidateProfile | null>;
  /** Finds candidate by linked Telegram user ID. */
  findByTelegramId?(telegramUserId: string): Promise<CandidateProfile | null>;
  /** Upsert. Creates the row on first write. */
  set(userId: string, profile: CandidateProfile): Promise<void>;
  delete(userId: string): Promise<void>;
}

/** SENSITIVE — see `003_contact_details.sql`. */
export interface ContactStore {
  get(userId: string): Promise<ContactRecord | null>;
  /** Finds contacts matching a normalized phone number. */
  findByPhone?(normalizedPhone: string): Promise<ContactRecord[]>;
  set(userId: string, record: ContactRecord): Promise<void>;
  delete(userId: string): Promise<void>;
}

/**
 * Read-only by construction.
 *
 * Adding a write method here would be the single change that lets a user edit
 * curated match data. Don't.
 */
export interface MatchStore {
  list(userId: string): Promise<Match[]>;
}

export interface UserMatchCandidate {
  userId: string;
  telegramUserId?: string;
  answers: Record<string, string>;
}

export type PhoneMatchResult =
  | { kind: "exact"; user: UserMatchCandidate }
  | { kind: "none" }
  | { kind: "ambiguous"; count: number }
  | { kind: "telegram_conflict"; reason: string };

/**
 * Identity port: handles phone matching, Telegram linking, and identity resolution.
 */
export interface IdentityStore {
  /** Resolves a Telegram user ID to its linked canonical internal user_id, or null if not linked. */
  findCanonicalUserId(telegramUserId: string): Promise<string | null>;
  /** Matches a normalized phone against the user database according to identity rules. */
  matchPhone(
    telegramUserId: string,
    normalizedPhone: string,
  ): Promise<PhoneMatchResult>;
  /** Creates a new user record for a fresh sign-up. */
  createNewUser?(
    telegramUserId: string,
    normalizedPhone: string,
  ): Promise<string>;
  /** Links Telegram user ID to canonical internal user ID. */
  linkTelegramUser(
    canonicalUserId: string,
    telegramUserId: string,
  ): Promise<void>;
  /** Unlinks Telegram user ID from canonical record. */
  unlinkTelegramUser(canonicalUserId: string): Promise<void>;
}
