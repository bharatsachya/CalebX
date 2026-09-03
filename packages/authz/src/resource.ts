import type { AgentMode } from "@calebx/core";

/**
 * Every kind of thing that can be read or written. Kept as a closed union so
 * adding a table forces a policy decision — a new resource kind with no rule
 * falls through to deny, and its test fails immediately.
 */
export type ResourceKind =
  | "candidate"
  | "partner_prefs"
  | "match"
  | "contact_details"
  | "photo"
  | "persona_chunk"
  | "peer"
  | "group"
  | "place"
  | "review_task"
  | "memory"
  | "mode_state"
  /** The `communityId` label the cohort job writes. Its own kind so the job can
   *  be allowed to write that and nothing else about a user. */
  | "community_label";

export type Action =
  /** Read the full record, PII included. */
  | "read"
  /** Read a projection with identifying fields stripped. */
  | "read_anonymized"
  /** Read contact details specifically — always its own decision. */
  | "read_contact"
  /** Read many users' records at once, for a background job. */
  | "read_bulk"
  | "write"
  | "delete"
  /** Resolve a human-review task. */
  | "review";

/**
 * What is being accessed.
 *
 * `ownerId: null` means the resource belongs to no user (a group, a place).
 * `mode: null` means it is mode-agnostic. Both are load-bearing: they are the
 * difference between "shared reference data" and "somebody's record", and the
 * policy treats them differently.
 */
export interface ResourceRef {
  kind: ResourceKind;
  ownerId: string | null;
  mode: AgentMode | null;
  /** Peer opted in to appearing in other people's recommendations. */
  discoverable?: boolean;
  /** A match reached `contact_shared`, so contact details may be revealed. */
  contactUnlocked?: boolean;
}

export function ownedBy(
  kind: ResourceKind,
  ownerId: string,
  mode: AgentMode,
  extra: Omit<ResourceRef, "kind" | "ownerId" | "mode"> = {},
): ResourceRef {
  return { kind, ownerId, mode, ...extra };
}

/** Shared reference data: groups, places. Owned by nobody. */
export function shared(
  kind: ResourceKind,
  mode: AgentMode | null = null,
): ResourceRef {
  return { kind, ownerId: null, mode };
}
