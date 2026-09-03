import { assertAuthorized, type Principal } from "@calebx/authz";
import type { ResourceKind } from "@calebx/authz";

/**
 * Authorization checks shared by both store implementations.
 *
 * They live here rather than in each store so the in-memory store used by tests
 * and the Neo4j store used in production cannot drift apart on *who is allowed
 * to do what* — a fake that is more permissive than the real thing turns every
 * test that passes into a false negative.
 */

const COMMUNITY = "community_connector" as const;

/** Reading or writing your own subgraph. */
export function requireOwn(
  principal: Principal,
  userId: string,
  kind: ResourceKind,
  action: "read" | "write" | "delete" = "read",
): void {
  assertAuthorized(principal, action, {
    kind,
    ownerId: userId,
    mode: COMMUNITY,
  });
}

/**
 * Reading a peer. Returns the projection the caller is limited to, which for a
 * peer is always `anonymized` — the store's job is to hand back the projection
 * so the caller cannot forget to apply one.
 */
export function requirePeer(
  principal: Principal,
  peerUserId: string,
  discoverable: boolean,
  kind: ResourceKind = "peer",
): "anonymized" | "full" {
  const decision = assertAuthorized(principal, "read_anonymized", {
    kind,
    ownerId: peerUserId,
    mode: COMMUNITY,
    discoverable,
  });
  return decision.projection === "full" ? "full" : "anonymized";
}

/** Shared reference data: groups and places. */
export function requireSharedRead(
  principal: Principal,
  kind: "group" | "place",
): void {
  assertAuthorized(principal, "read", { kind, ownerId: null, mode: null });
}

/**
 * Writing shared reference data, or reading across users. Only a system
 * principal gets here — the cohort job and the group registrar, nothing else.
 */
export function requireSystem(
  principal: Principal,
  kind: ResourceKind,
  action: "read_bulk" | "write" = "read_bulk",
): void {
  assertAuthorized(principal, action, { kind, ownerId: null, mode: null });
}
