import { isWellFormed, ownsId, type Principal } from "./principal.ts";
import type { Action, ResourceKind, ResourceRef } from "./resource.ts";

/**
 * How much of the record the caller may see. A decision is not a boolean —
 * "allowed, but anonymized" is the single most common answer in this system, and
 * collapsing it to `true` is how peer discovery leaks a phone number.
 */
export type Projection = "full" | "anonymized" | "none";

export interface Decision {
  allowed: boolean;
  /** Machine-readable, stable, and asserted on in tests. */
  reason: string;
  projection: Projection;
}

const deny = (reason: string): Decision => ({
  allowed: false,
  reason,
  projection: "none",
});

const allow = (reason: string, projection: Projection = "full"): Decision => ({
  allowed: true,
  reason,
  projection,
});

/** Kinds a peer may ever be seen through, and only anonymized. */
const PEER_VISIBLE: ReadonlySet<ResourceKind> = new Set<ResourceKind>([
  "peer",
  "persona_chunk",
  "candidate",
]);

/** Kinds a background job may bulk-read. Deliberately excludes everything with PII. */
const BULK_READABLE: ReadonlySet<ResourceKind> = new Set<ResourceKind>([
  "peer",
  "persona_chunk",
  "group",
]);

/** The only kinds a background job may write. See the system branch below. */
const SYSTEM_WRITABLE: ReadonlySet<ResourceKind> = new Set<ResourceKind>([
  "review_task",
  "group",
  "community_label",
]);

/** Kinds a coordinator needs to do the job. Excludes community persona data. */
const ADMIN_READABLE: ReadonlySet<ResourceKind> = new Set<ResourceKind>([
  "candidate",
  "partner_prefs",
  "match",
  "contact_details",
  "photo",
  "review_task",
  "mode_state",
  // An admin runs /register_group inside the group they just created, which
  // writes the group id and invite link back.
  "group",
]);

/**
 * The whole authorization policy, as one pure function.
 *
 * Deny by default: every path either returns an explicit `allow` or falls
 * through to the final deny. There is no `else return true` anywhere in here,
 * and there must never be.
 */
export function authorize(
  principal: Principal,
  action: Action,
  resource: ResourceRef,
): Decision {
  if (!isWellFormed(principal)) return deny("malformed principal");

  if (principal.kind === "system") {
    // The only writes a job may perform, each narrow on purpose:
    //   review_task     — escalating to a human. It creates work for a person
    //                     rather than reading anyone's data, and a job with no
    //                     way to say "someone needs to look at this" has to
    //                     either fail silently or overreach instead.
    //   group           — shared reference data the cohort job maintains.
    //   community_label — the derived `communityId`, which is why it is its own
    //                     resource kind: the job can write that and nothing
    //                     else about a user.
    if (action === "write" && SYSTEM_WRITABLE.has(resource.kind)) {
      return allow(`system writes ${resource.kind}`);
    }
    if (action !== "read_bulk") {
      return deny("system principal may only bulk-read or write derived data");
    }
    if (!BULK_READABLE.has(resource.kind)) {
      return deny(`system principal may not read ${resource.kind}`);
    }
    // Even in bulk, a job sees anonymized records. Clustering needs edges and
    // vectors, never names.
    return allow("system bulk read", "anonymized");
  }

  if (principal.kind === "admin") {
    if (!ADMIN_READABLE.has(resource.kind)) {
      return deny(`admin may not access ${resource.kind}`);
    }
    if (action === "review") {
      return resource.kind === "review_task"
        ? allow("admin reviews tasks")
        : deny("only review_task may be reviewed");
    }
    if (
      action === "read" ||
      action === "read_contact" ||
      action === "read_anonymized"
    ) {
      return allow("admin read");
    }
    if (action === "write") {
      // A coordinator resolves tasks, advances matches, and registers a group
      // they created; they do not edit someone's profile out from under them.
      return resource.kind === "review_task" ||
        resource.kind === "match" ||
        resource.kind === "group"
        ? allow("admin write")
        : deny(`admin may not write ${resource.kind}`);
    }
    return deny(`admin may not ${action}`);
  }

  // --- user principal ---

  if (action === "read_bulk") return deny("users may not bulk-read");

  if (resource.mode !== null) {
    // Checked before ownership on purpose: owning a record in your *other* mode
    // still does not make it readable in this turn.
    if (resource.mode !== principal.mode) return deny("cross-mode access");
    if (!principal.enrolledModes.includes(resource.mode)) {
      return deny("not enrolled in mode");
    }
  }

  if (resource.ownerId === null) {
    // Shared reference data: groups and places are readable, never writable by
    // a user. Membership is expressed as an edge the user owns, not as an edit
    // to the group.
    if (resource.kind !== "group" && resource.kind !== "place") {
      return deny(`unowned ${resource.kind} is not user-readable`);
    }
    return action === "read" || action === "read_anonymized"
      ? allow("shared reference data")
      : deny("users may not modify shared data");
  }

  const isOwner = ownsId(principal, resource.ownerId);

  if (isOwner) {
    switch (action) {
      case "read":
      case "read_anonymized":
      case "write":
      case "delete":
        return allow("owner");
      case "read_contact":
        // Your own contact details are yours.
        return allow("owner contact");
      default:
        return deny(`owner may not ${action}`);
    }
  }

  // --- another user's record ---

  switch (action) {
    case "read_anonymized":
      if (!PEER_VISIBLE.has(resource.kind)) {
        return deny(`${resource.kind} is never peer-visible`);
      }
      if (resource.discoverable !== true) return deny("peer not discoverable");
      return allow("discoverable peer", "anonymized");

    case "read_contact":
      if (resource.contactUnlocked !== true)
        return deny("contact not unlocked");
      return allow("contact unlocked by mutual interest");

    case "read":
      return deny("not owner");

    default:
      return deny("not owner");
  }
}
