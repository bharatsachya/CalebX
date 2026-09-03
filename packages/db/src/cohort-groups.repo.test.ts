/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { ForbiddenError } from "@calebx/errors";
import { adminPrincipal, systemPrincipal, userPrincipal } from "@calebx/authz";
import { CohortGroupsRepository } from "./cohort-groups.repo.ts";
import { FakeSqlExecutor } from "./executor.ts";

const job = systemPrincipal("cohort-clustering");
const admin = adminPrincipal("coordinator-1");
const alice = userPrincipal("tg:1001", "community_connector");

function cohortRow(overrides: Record<string, unknown> = {}) {
  return {
    cohort_key: "cafe:delhi",
    group_id: null,
    invite_link: null,
    title: "Delhi Cafe Crawlers",
    member_hint: 6,
    registered_at: null,
    ...overrides,
  };
}

let sql: FakeSqlExecutor;
let repo: CohortGroupsRepository;

beforeEach(() => {
  sql = new FakeSqlExecutor();
  repo = new CohortGroupsRepository(sql);
});

describe("upsert", () => {
  it("records a cohort with its size", async () => {
    sql.enqueue([cohortRow()]);
    const cohort = await repo.upsert(
      job,
      "cafe:delhi",
      "Delhi Cafe Crawlers",
      6,
    );
    expect(cohort).toEqual({
      cohortKey: "cafe:delhi",
      groupId: null,
      inviteLink: null,
      title: "Delhi Cafe Crawlers",
      memberHint: 6,
      registeredAt: null,
    });
  });

  it("keeps the larger member hint on re-run", async () => {
    // The cohort job runs repeatedly; a smaller sample must not shrink history.
    sql.enqueue([cohortRow()]);
    await repo.upsert(job, "cafe:delhi", null, 2);
    expect(sql.lastSql()).toContain(
      "GREATEST(cohort_groups.member_hint, EXCLUDED.member_hint)",
    );
  });

  it("does not overwrite an existing title with null", async () => {
    sql.enqueue([cohortRow()]);
    await repo.upsert(job, "cafe:delhi", null, 6);
    expect(sql.lastSql()).toContain(
      "coalesce(cohort_groups.title, EXCLUDED.title)",
    );
  });

  it("refuses a user", async () => {
    await expect(repo.upsert(alice, "cafe:delhi", null, 1)).rejects.toThrow(
      ForbiddenError,
    );
    expect(sql.calls).toHaveLength(0);
  });
});

describe("register", () => {
  it("fills in the group id and invite link an admin created", async () => {
    sql.enqueue([
      cohortRow({
        group_id: "-1001234567890",
        invite_link: "https://t.me/+abc",
        registered_at: new Date("2026-09-01T12:00:00Z"),
      }),
    ]);
    const cohort = await repo.register(
      admin,
      "cafe:delhi",
      "-1001234567890",
      "https://t.me/+abc",
    );
    expect(cohort?.groupId).toBe("-1001234567890");
    expect(cohort?.inviteLink).toBe("https://t.me/+abc");
    expect(cohort?.registeredAt).not.toBeNull();
  });

  it("returns null for a cohort key that does not exist", async () => {
    expect(
      await repo.register(admin, "nope:nowhere", "-1", "https://t.me/+x"),
    ).toBeNull();
  });

  it("refuses a user", async () => {
    await expect(
      repo.register(alice, "cafe:delhi", "-1", "https://t.me/+x"),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("listReady", () => {
  it("only returns cohorts with both a group and an invite link", async () => {
    // A cohort with no invite link is a recommendation the user cannot act on.
    await repo.listReady(job, ["cafe:delhi"]);
    expect(sql.lastSql()).toContain(
      "group_id IS NOT NULL AND invite_link IS NOT NULL",
    );
  });

  it("short-circuits an empty key list without a query", async () => {
    expect(await repo.listReady(job, [])).toEqual([]);
    expect(sql.calls).toHaveLength(0);
  });

  it("binds the keys as an array", async () => {
    await repo.listReady(job, ["cafe:delhi", "gym:pune"]);
    expect(sql.calls[0].params).toEqual([["cafe:delhi", "gym:pune"]]);
  });
});

describe("listUnregistered", () => {
  it("returns cohorts still waiting on a human, biggest first", async () => {
    sql.enqueue([cohortRow()]);
    const pending = await repo.listUnregistered(job);
    expect(pending).toHaveLength(1);
    expect(sql.lastSql()).toContain("WHERE group_id IS NULL");
    expect(sql.lastSql()).toContain("ORDER BY member_hint DESC");
  });
});

describe("get", () => {
  it("returns null for an unknown cohort", async () => {
    expect(await repo.get(job, "nope:nowhere")).toBeNull();
  });

  it("refuses a user", async () => {
    await expect(repo.get(alice, "cafe:delhi")).rejects.toThrow(ForbiddenError);
  });
});

describe("every statement declares its cross-user intent", () => {
  it("marks all of them bulk, because a cohort is a set of people", async () => {
    sql.enqueue([cohortRow()]).enqueue([cohortRow()]).enqueue([cohortRow()]);
    await repo.upsert(job, "k", null, 1);
    await repo.get(job, "k");
    await repo.listUnregistered(job);
    await repo.listReady(job, ["k"]);
    for (const call of sql.calls) {
      expect(call.sql).toContain("/* authz:bulk */");
    }
  });
});
