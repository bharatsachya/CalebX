import { createHash } from "node:crypto";
import type { Projection } from "./policy.ts";

/**
 * Turning a record into what the caller is allowed to see.
 *
 * The policy decides *whether*; this decides *what*. They are separate because
 * an allow-with-projection that nobody applies is indistinguishable from a full
 * allow, and that mistake is invisible in a code review.
 */

/**
 * A stable opaque handle for a peer.
 *
 * Peer discovery has to let A say "I'm interested in the second one" without A
 * ever learning who the second one is. A salted hash gives a handle that is
 * stable for the same peer across turns and useless outside this deployment.
 */
export function peerHandle(userId: string, salt: string): string {
  return createHash("sha256")
    .update(`${salt}:${userId}`)
    .digest("hex")
    .slice(0, 12);
}

export interface PeerProfile {
  userId: string;
  displayName?: string | null;
  phone?: string | null;
  interests: string[];
  area?: string | null;
  sharedConnections?: number;
  discoverable: boolean;
}

/** What A is allowed to see about B before B has agreed to anything. */
export interface AnonymizedPeer {
  handle: string;
  interests: string[];
  area: string | null;
  sharedConnections: number;
}

export function anonymizePeer(peer: PeerProfile, salt: string): AnonymizedPeer {
  return {
    handle: peerHandle(peer.userId, salt),
    interests: [...peer.interests],
    area: peer.area ?? null,
    sharedConnections: peer.sharedConnections ?? 0,
  };
}

/**
 * Fields that must never survive an anonymized projection of a candidate.
 * Listed by name rather than by an allowlist of what to keep, because a new
 * column added to `candidates` should default to *hidden*, not to visible.
 */
const CANDIDATE_PII = [
  "full_name",
  "fullName",
  "name",
  "phone",
  "wa_phone",
  "waPhone",
  "email",
  "dob",
  "date_of_birth",
  "address",
  "user_id_hash",
  "userIdHash",
  "telegram_id",
  "telegramId",
  "photo_url",
  "photoUrl",
  "instagram",
  "linkedin",
] as const;

/**
 * Applies a projection to any record-shaped object.
 *
 * `full` returns a shallow copy (never the caller's own object, so a downstream
 * mutation cannot travel back into a cache). `anonymized` drops the PII columns.
 * `none` returns null — a caller that forgot to check `allowed` gets nothing
 * rather than everything.
 */
export function project<T extends Record<string, unknown>>(
  record: T,
  projection: Projection,
): Partial<T> | null {
  if (projection === "none") return null;
  if (projection === "full") return { ...record };

  const out: Record<string, unknown> = {};
  const hidden = new Set<string>(CANDIDATE_PII);
  for (const [key, value] of Object.entries(record)) {
    if (hidden.has(key)) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

/** Convenience for lists. Drops anything projected to nothing. */
export function projectAll<T extends Record<string, unknown>>(
  records: T[],
  projection: Projection,
): Partial<T>[] {
  return records
    .map((record) => project(record, projection))
    .filter((record): record is Partial<T> => record !== null);
}
