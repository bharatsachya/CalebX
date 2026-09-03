/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { ForbiddenError } from "@calebx/errors";
import { adminPrincipal, systemPrincipal, userPrincipal } from "@calebx/authz";
import { ReviewTasksRepository } from "./review-tasks.repo.ts";
import { FakeSqlExecutor } from "./executor.ts";

const ALICE = "tg:1001";
const alice = userPrincipal(ALICE, "matchmaker");
const admin = adminPrincipal("coordinator-1");
const job = systemPrincipal("cohort-clustering");

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    kind: "mutual_interest",
    state: "open",
    user_id: ALICE,
    payload: { candidateId: "c2" },
    note: null,
    created_at: new Date("2026-09-01T10:00:00Z"),
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

let sql: FakeSqlExecutor;
let repo: ReviewTasksRepository;

beforeEach(() => {
  sql = new FakeSqlExecutor();
  repo = new ReviewTasksRepository(sql);
});

describe("file", () => {
  it("inserts a task for the user whose action caused it", async () => {
    sql.enqueue([]).enqueue([taskRow()]);
    const task = await repo.file(alice, {
      kind: "mutual_interest",
      userId: ALICE,
      payload: { candidateId: "c2" },
    });
    expect(task.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(task.state).toBe("open");
    expect(sql.calls[1].params).toEqual([
      "mutual_interest",
      ALICE,
      '{"candidateId":"c2"}',
    ]);
  });

  it("returns the existing open task instead of filing a duplicate", async () => {
    // A user tapping "express interest" twice must not put two identical items
    // in front of a coordinator who cannot tell them apart.
    sql.enqueue([taskRow()]);
    const task = await repo.file(alice, {
      kind: "mutual_interest",
      userId: ALICE,
      payload: { candidateId: "c2" },
    });
    expect(task.id).toBe("11111111-1111-1111-1111-111111111111");
    expect(sql.calls).toHaveLength(1);
  });

  it("defaults an omitted payload to an empty object", async () => {
    sql.enqueue([]).enqueue([taskRow({ payload: {} })]);
    const task = await repo.file(alice, {
      kind: "agent_escalation",
      userId: ALICE,
    });
    expect(task.payload).toEqual({});
    expect(sql.calls[0].params[2]).toBe("{}");
  });

  it("treats a null payload column as an empty object", async () => {
    sql.enqueue([]).enqueue([taskRow({ payload: null })]);
    const task = await repo.file(alice, {
      kind: "agent_escalation",
      userId: ALICE,
    });
    expect(task.payload).toEqual({});
  });

  it("lets a system job file an unowned task, which is how it escalates", async () => {
    // The cohort job cannot create a Telegram group itself (A2).
    sql.enqueue([]).enqueue([taskRow({ kind: "create_group", user_id: null })]);
    const task = await repo.file(job, {
      kind: "create_group",
      userId: null,
      payload: { cohortKey: "cafe:delhi" },
    });
    expect(task.userId).toBeNull();
  });

  it("refuses a user filing a task on someone else's behalf", async () => {
    await expect(
      repo.file(alice, { kind: "mutual_interest", userId: "tg:2002" }),
    ).rejects.toThrow(ForbiddenError);
    expect(sql.calls).toHaveLength(0);
  });

  it("refuses a user filing an unowned task", async () => {
    await expect(
      repo.file(alice, { kind: "create_group", userId: null }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("listOpen", () => {
  it("returns open tasks oldest first for an admin", async () => {
    sql.enqueue([
      taskRow(),
      taskRow({ id: "22222222-2222-2222-2222-222222222222" }),
    ]);
    const tasks = await repo.listOpen(admin);
    expect(tasks).toHaveLength(2);
    expect(sql.lastSql()).toContain("ORDER BY created_at ASC");
  });

  it("applies a limit", async () => {
    await repo.listOpen(admin, 5);
    expect(sql.calls[0].params).toEqual([5]);
  });

  it("refuses a user, whose own escalations are not a queue to browse", async () => {
    await expect(repo.listOpen(alice)).rejects.toThrow(ForbiddenError);
    expect(sql.calls).toHaveLength(0);
  });

  it("refuses a system principal", async () => {
    await expect(repo.listOpen(job)).rejects.toThrow(ForbiddenError);
  });

  it("marks the cross-user read as deliberate bulk", async () => {
    await repo.listOpen(admin);
    expect(sql.calls[0].sql).toContain("/* authz:bulk */");
  });
});

describe("listOpenOlderThan", () => {
  it("filters by age in minutes", async () => {
    await repo.listOpenOlderThan(admin, 120);
    expect(sql.lastSql()).toContain(
      "created_at < now() - ($1 || ' minutes')::interval",
    );
    expect(sql.calls[0].params).toEqual([120]);
  });
});

describe("resolve", () => {
  it("closes an open task and stamps who did it", async () => {
    sql.enqueue([
      taskRow({
        state: "approved",
        resolved_by: "coordinator-1",
        resolved_at: new Date("2026-09-01T11:00:00Z"),
      }),
    ]);
    const task = await repo.resolve(
      admin,
      "11111111-1111-1111-1111-111111111111",
      "approved",
      "looks good",
    );
    expect(task?.state).toBe("approved");
    expect(task?.resolvedBy).toBe("coordinator-1");
    expect(sql.calls[0].params).toEqual([
      "11111111-1111-1111-1111-111111111111",
      "approved",
      "looks good",
      "coordinator-1",
    ]);
  });

  it("only touches tasks that are still open", async () => {
    // Two coordinators tapping Approve on the same message must not both count.
    await repo.resolve(admin, "x", "approved");
    expect(sql.lastSql()).toContain("WHERE id = $1 AND state = 'open'");
  });

  it("returns null when the task was already resolved", async () => {
    expect(await repo.resolve(admin, "x", "declined")).toBeNull();
  });

  it("refuses a user and a system principal", async () => {
    await expect(repo.resolve(alice, "x", "approved")).rejects.toThrow(
      ForbiddenError,
    );
    await expect(repo.resolve(job, "x", "approved")).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("deleteOpenForUser (/forget)", () => {
  it("drops the user's still-open escalations", async () => {
    await repo.deleteOpenForUser(alice, ALICE);
    expect(sql.lastSql()).toBe(
      "DELETE FROM review_tasks WHERE user_id = $1 AND state = 'open'",
    );
  });

  it("refuses to drop another user's tasks", async () => {
    await expect(repo.deleteOpenForUser(alice, "tg:2002")).rejects.toThrow(
      ForbiddenError,
    );
  });
});
