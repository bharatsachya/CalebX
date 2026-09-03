import {
  assertAuthorized,
  SQL_BULK_MARKER,
  type Principal,
} from "@calebx/authz";
import { poolExecutor, type SqlExecutor } from "./executor.ts";

/**
 * The cohort → Telegram group registry (assumptions.md A2).
 *
 * A bot cannot create a Telegram group, so a cohort is registered here with
 * `group_id` NULL, a human creates the group and adds the bot as an admin, and
 * `/register_group` fills in the id and invite link. Only then can the group be
 * recommended to anyone — a cohort with no invite link is a recommendation the
 * user cannot act on.
 *
 * Every statement here crosses users by nature (a cohort is a set of people),
 * so all of them are bulk-marked and gated on a system or admin principal.
 */

export interface CohortGroup {
  cohortKey: string;
  groupId: string | null;
  inviteLink: string | null;
  title: string | null;
  memberHint: number;
  registeredAt: Date | null;
}

interface CohortRow {
  cohort_key: string;
  group_id: string | null;
  invite_link: string | null;
  title: string | null;
  member_hint: number;
  registered_at: Date | null;
}

const RETURNING = `cohort_key, group_id, invite_link, title, member_hint, registered_at`;

const UPSERT_COHORT = `${SQL_BULK_MARKER}
INSERT INTO cohort_groups (cohort_key, title, member_hint)
VALUES ($1, $2, $3)
ON CONFLICT (cohort_key) DO UPDATE
  SET member_hint = GREATEST(cohort_groups.member_hint, EXCLUDED.member_hint),
      title = coalesce(cohort_groups.title, EXCLUDED.title)
RETURNING ${RETURNING}
`;

const REGISTER_GROUP = `${SQL_BULK_MARKER}
UPDATE cohort_groups
SET group_id = $2, invite_link = $3, title = coalesce($4, title),
    registered_at = now()
WHERE cohort_key = $1
RETURNING ${RETURNING}
`;

const GET_COHORT = `${SQL_BULK_MARKER}
SELECT ${RETURNING} FROM cohort_groups WHERE cohort_key = $1
`;

const LIST_UNREGISTERED = `${SQL_BULK_MARKER}
SELECT ${RETURNING} FROM cohort_groups
WHERE group_id IS NULL
ORDER BY member_hint DESC, created_at ASC
`;

const LIST_READY = `${SQL_BULK_MARKER}
SELECT ${RETURNING} FROM cohort_groups
WHERE group_id IS NOT NULL AND invite_link IS NOT NULL
  AND cohort_key = ANY($1)
`;

function toCohort(row: CohortRow): CohortGroup {
  return {
    cohortKey: row.cohort_key,
    groupId: row.group_id,
    inviteLink: row.invite_link,
    title: row.title,
    memberHint: row.member_hint,
    registeredAt: row.registered_at,
  };
}

export class CohortGroupsRepository {
  constructor(private readonly executor: SqlExecutor = poolExecutor) {}

  /** Records that a cohort exists and how many people are in it. */
  async upsert(
    principal: Principal,
    cohortKey: string,
    title: string | null,
    memberHint: number,
  ): Promise<CohortGroup> {
    this.assertPrivileged(principal, "write");
    const rows = await this.executor.query<CohortRow>(UPSERT_COHORT, [
      cohortKey,
      title,
      memberHint,
    ]);
    return toCohort(rows[0]);
  }

  /** `/register_group`, run by an admin inside the newly created group. */
  async register(
    principal: Principal,
    cohortKey: string,
    groupId: string,
    inviteLink: string,
    title: string | null = null,
  ): Promise<CohortGroup | null> {
    assertAuthorized(principal, "write", {
      kind: "group",
      ownerId: null,
      mode: null,
    });
    const rows = await this.executor.query<CohortRow>(REGISTER_GROUP, [
      cohortKey,
      groupId,
      inviteLink,
      title,
    ]);
    return rows[0] ? toCohort(rows[0]) : null;
  }

  async get(
    principal: Principal,
    cohortKey: string,
  ): Promise<CohortGroup | null> {
    this.assertPrivileged(principal, "read");
    const rows = await this.executor.query<CohortRow>(GET_COHORT, [cohortKey]);
    return rows[0] ? toCohort(rows[0]) : null;
  }

  /** Cohorts still waiting on a human to create their group. */
  async listUnregistered(principal: Principal): Promise<CohortGroup[]> {
    this.assertPrivileged(principal, "read");
    const rows = await this.executor.query<CohortRow>(LIST_UNREGISTERED);
    return rows.map(toCohort);
  }

  /**
   * Cohorts that are actually recommendable: a real group with a real invite
   * link. Anything else would be surfaced to a user who then cannot join.
   */
  async listReady(
    principal: Principal,
    cohortKeys: string[],
  ): Promise<CohortGroup[]> {
    this.assertPrivileged(principal, "read");
    if (cohortKeys.length === 0) return [];
    const rows = await this.executor.query<CohortRow>(LIST_READY, [cohortKeys]);
    return rows.map(toCohort);
  }

  /**
   * Groups are shared reference data: a user may read them but never write, and
   * the cross-user reads here are the cohort job's, not a user's.
   */
  private assertPrivileged(
    principal: Principal,
    action: "read" | "write",
  ): void {
    if (principal.kind === "admin") {
      assertAuthorized(principal, action === "read" ? "read" : "write", {
        kind: "review_task",
        ownerId: null,
        mode: null,
      });
      return;
    }
    assertAuthorized(principal, action === "read" ? "read_bulk" : "write", {
      kind: "group",
      ownerId: null,
      mode: null,
    });
  }
}
