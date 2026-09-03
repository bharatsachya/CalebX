import { ForbiddenError } from "@calebx/errors";
import { authorize, type Decision } from "./policy.ts";
import type { Principal } from "./principal.ts";
import type { Action, ResourceRef } from "./resource.ts";

/**
 * The enforcing wrapper. Repositories and tools call this, never `authorize`
 * directly — a decision that is computed and then ignored is worse than no
 * decision at all, and `authorize`'s return value is easy to drop.
 *
 * Denials are not traced from here on purpose: every tool call and repository
 * query already runs inside a span, so a thrown `ForbiddenError` surfaces as
 * that span's error with its `reason` attached. Adding a span here would double
 * every access check for no new information.
 */
export function assertAuthorized(
  principal: Principal,
  action: Action,
  resource: ResourceRef,
): Decision {
  const decision = authorize(principal, action, resource);
  if (!decision.allowed) {
    throw new ForbiddenError(decision.reason, `${action}:${resource.kind}`);
  }
  return decision;
}

/**
 * Filters a list to what the principal may see, pairing each survivor with its
 * projection.
 *
 * Filtering rather than throwing is correct for search results: one
 * non-discoverable peer in a candidate set is normal, not an error, and throwing
 * would turn a partial result into no result.
 */
export function filterAuthorized<T>(
  principal: Principal,
  action: Action,
  items: T[],
  toRef: (item: T) => ResourceRef,
): { item: T; decision: Decision }[] {
  const out: { item: T; decision: Decision }[] = [];
  for (const item of items) {
    const decision = authorize(principal, action, toRef(item));
    if (decision.allowed) out.push({ item, decision });
  }
  return out;
}

/** Non-throwing check, for branching without exceptions. */
export function can(
  principal: Principal,
  action: Action,
  resource: ResourceRef,
): boolean {
  return authorize(principal, action, resource).allowed;
}
