import type { AgentMode } from "@calebx/core";

/**
 * Who is asking. Every data access in the system takes one of these, and there
 * is no code path that reads user data without one — that is the whole point of
 * this package.
 */
export type PrincipalKind = "user" | "admin" | "system";

/**
 * A conversing end user. `mode` is the mode of the *current turn*, not the set
 * they are allowed into: a user enrolled in both modes still acts in one at a
 * time, and the other mode's data is off limits for the duration.
 */
export interface UserPrincipal {
  kind: "user";
  userId: string;
  mode: AgentMode;
  enrolledModes: readonly AgentMode[];
  /**
   * Other ids that denote this same person.
   *
   * The matchmaking tables key ownership by `user_id_hash` (a SHA-256 of the
   * namespaced id), while everything else keys it by the namespaced id itself.
   * Both name one person, so both belong on the principal — the alternative is
   * either a policy that compares two different id spaces, or a principal whose
   * identity changes depending on which table it is about to touch.
   */
  aliases?: readonly string[];
}

/** A human coordinator working the review queue. */
export interface AdminPrincipal {
  kind: "admin";
  adminId: string;
}

/**
 * A background job. Named after the job so a denial says which one overreached.
 *
 * System principals exist so that jobs which legitimately read across users
 * (cohort clustering) do not have to bypass authorization. They get bulk graph
 * reads and are denied every action that returns contact details or a full
 * profile — a clustering job has no business seeing a phone number.
 */
export interface SystemPrincipal {
  kind: "system";
  job: string;
}

export type Principal = UserPrincipal | AdminPrincipal | SystemPrincipal;

export function userPrincipal(
  userId: string,
  mode: AgentMode,
  enrolledModes: readonly AgentMode[] = [mode],
  aliases: readonly string[] = [],
): UserPrincipal {
  return { kind: "user", userId, mode, enrolledModes, aliases };
}

/**
 * Whether an owner id denotes this principal.
 *
 * Blank ids never match, whichever side they are on: a row whose owner column
 * is empty must not become readable by a principal whose alias list happens to
 * contain an empty string.
 */
export function ownsId(principal: UserPrincipal, ownerId: string): boolean {
  if (ownerId.trim() === "") return false;
  if (ownerId === principal.userId) return true;
  return (principal.aliases ?? []).some(
    (alias) => alias.trim() !== "" && alias === ownerId,
  );
}

export function adminPrincipal(adminId: string): AdminPrincipal {
  return { kind: "admin", adminId };
}

export function systemPrincipal(job: string): SystemPrincipal {
  return { kind: "system", job };
}

export function isUserPrincipal(p: Principal): p is UserPrincipal {
  return p.kind === "user";
}

/**
 * A principal is well-formed if it can actually identify someone. A blank or
 * whitespace-only id is treated as invalid rather than as a user who happens to
 * own nothing — the latter silently authorizes access to rows whose owner column
 * is also blank.
 */
export function isWellFormed(principal: Principal): boolean {
  switch (principal.kind) {
    case "user":
      return (
        principal.userId.trim() !== "" &&
        principal.userId === principal.userId.trim()
      );
    case "admin":
      return principal.adminId.trim() !== "";
    case "system":
      return principal.job.trim() !== "";
  }
}

/** Short label for logs and span attributes. Never includes a raw user id. */
export function principalLabel(principal: Principal): string {
  switch (principal.kind) {
    case "user":
      return `user:${principal.mode}`;
    case "admin":
      return `admin:${principal.adminId}`;
    case "system":
      return `system:${principal.job}`;
  }
}
