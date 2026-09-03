import {
  assertAuthorized,
  SQL_BULK_MARKER,
  type Principal,
} from "@calebx/authz";
import { ValidationError } from "@calebx/errors";
import { poolExecutor, type SqlExecutor } from "./executor.ts";

/**
 * The human-in-the-loop queue (assumptions.md A1).
 *
 * Every escalation lands here: a cohort that needs a Telegram group created, a
 * mutual match that needs a coordinator's eyes, a contact reveal, an agent
 * escalation. One table so there is one surface to work and one place to look
 * when something is stuck.
 *
 * Reads are bulk by nature — a coordinator's queue spans users — so they are
 * marked `authz:bulk` and gated on an admin principal, which is the only
 * principal `authorize` lets near a review task.
 */

export type ReviewKind =
  "create_group" | "mutual_interest" | "contact_share" | "agent_escalation";

export type ReviewState = "open" | "approved" | "declined";

export interface ReviewTask {
  id: string;
  kind: ReviewKind;
  state: ReviewState;
  userId: string | null;
  payload: Record<string, unknown>;
  note: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

interface TaskRow {
  id: string;
  kind: ReviewKind;
  state: ReviewState;
  user_id: string | null;
  payload: Record<string, unknown> | null;
  note: string | null;
  created_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
}

const RETURNING = `
  id, kind, state, user_id, payload, note, created_at, resolved_at, resolved_by
`;

const INSERT_TASK = `
INSERT INTO review_tasks (kind, user_id, payload)
VALUES ($1, $2, $3::jsonb)
RETURNING ${RETURNING}
`;

/** Deduplicated on (kind, user_id, payload) while still open. */
const FIND_OPEN_DUPLICATE = `
SELECT ${RETURNING}
FROM review_tasks
WHERE state = 'open' AND kind = $1 AND user_id = $2 AND payload = $3::jsonb
LIMIT 1
`;

const LIST_OPEN = `${SQL_BULK_MARKER}
SELECT ${RETURNING}
FROM review_tasks
WHERE state = 'open'
ORDER BY created_at ASC
LIMIT $1
`;

const LIST_OPEN_OLDER_THAN = `${SQL_BULK_MARKER}
SELECT ${RETURNING}
FROM review_tasks
WHERE state = 'open' AND created_at < now() - ($1 || ' minutes')::interval
ORDER BY created_at ASC
`;

const GET_TASK = `${SQL_BULK_MARKER}
SELECT ${RETURNING} FROM review_tasks WHERE id = $1
`;

const RESOLVE = `${SQL_BULK_MARKER}
UPDATE review_tasks
SET state = $2, note = $3, resolved_by = $4, resolved_at = now()
WHERE id = $1 AND state = 'open'
RETURNING ${RETURNING}
`;

const DELETE_FOR_USER = `
DELETE FROM review_tasks WHERE user_id = $1 AND state = 'open'
`;

function toTask(row: TaskRow): ReviewTask {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    userId: row.user_id,
    payload: row.payload ?? {},
    note: row.note,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

export class ReviewTasksRepository {
  constructor(private readonly executor: SqlExecutor = poolExecutor) {}

  /**
   * Files a task, or returns the existing open one.
   *
   * Deduplication is not an optimisation: without it, a user tapping "express
   * interest" twice puts two identical items in front of a coordinator, who has
   * no way to tell they are the same request.
   *
   * Filing is allowed for the *user* whose action caused it — the queue is
   * admin-read, not admin-write-only.
   */
  async file(
    principal: Principal,
    task: {
      kind: ReviewKind;
      userId: string | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<ReviewTask> {
    if (task.userId !== null) {
      assertAuthorized(principal, "write", {
        kind: "review_task",
        ownerId: task.userId,
        mode: null,
      });
    } else {
      assertAuthorized(principal, "write", {
        kind: "review_task",
        ownerId: null,
        mode: null,
      });
    }

    const payload = JSON.stringify(task.payload ?? {});
    const existing = await this.executor.query<TaskRow>(FIND_OPEN_DUPLICATE, [
      task.kind,
      task.userId,
      payload,
    ]);
    if (existing[0]) return toTask(existing[0]);

    const rows = await this.executor.query<TaskRow>(INSERT_TASK, [
      task.kind,
      task.userId,
      payload,
    ]);
    if (!rows[0])
      throw new ValidationError("review_tasks insert returned no row");
    return toTask(rows[0]);
  }

  async listOpen(principal: Principal, limit = 50): Promise<ReviewTask[]> {
    this.assertAdmin(principal);
    const rows = await this.executor.query<TaskRow>(LIST_OPEN, [limit]);
    return rows.map(toTask);
  }

  /** Backs a future reminder job (assumptions.md A11). */
  async listOpenOlderThan(
    principal: Principal,
    minutes: number,
  ): Promise<ReviewTask[]> {
    this.assertAdmin(principal);
    const rows = await this.executor.query<TaskRow>(LIST_OPEN_OLDER_THAN, [
      minutes,
    ]);
    return rows.map(toTask);
  }

  async get(principal: Principal, id: string): Promise<ReviewTask | null> {
    this.assertAdmin(principal);
    const rows = await this.executor.query<TaskRow>(GET_TASK, [id]);
    return rows[0] ? toTask(rows[0]) : null;
  }

  /**
   * Resolves an open task. Returns null when the task was already resolved —
   * two coordinators tapping Approve on the same message must not both count,
   * and the second must be able to tell that they were second.
   */
  async resolve(
    principal: Principal,
    id: string,
    state: Exclude<ReviewState, "open">,
    note: string | null = null,
  ): Promise<ReviewTask | null> {
    assertAuthorized(principal, "review", {
      kind: "review_task",
      ownerId: null,
      mode: null,
    });
    const resolvedBy =
      principal.kind === "admin" ? principal.adminId : principal.kind;
    const rows = await this.executor.query<TaskRow>(RESOLVE, [
      id,
      state,
      note,
      resolvedBy,
    ]);
    return rows[0] ? toTask(rows[0]) : null;
  }

  /** /forget: drops the user's still-open escalations. */
  async deleteOpenForUser(principal: Principal, userId: string): Promise<void> {
    assertAuthorized(principal, "delete", {
      kind: "review_task",
      ownerId: userId,
      mode: null,
    });
    await this.executor.query(DELETE_FOR_USER, [userId]);
  }

  private assertAdmin(principal: Principal): void {
    assertAuthorized(principal, "read", {
      kind: "review_task",
      ownerId: null,
      mode: null,
    });
  }
}
