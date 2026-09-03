/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { CohortGroupsRepository, FakeSqlExecutor } from "@calebx/db";
import { MemoryGraphStore } from "@calebx/graph";
import { systemPrincipal, userPrincipal } from "@calebx/authz";
import {
  checkRegisterRequest,
  registerGroup,
  type RegisterDeps,
} from "./register-group.ts";

describe("checkRegisterRequest", () => {
  const valid = {
    chatType: "supergroup",
    argument: "cafe:delhi",
    senderIsChatAdmin: true,
  };

  it("accepts a well-formed request from a chat admin", () => {
    expect(checkRegisterRequest(valid)).toEqual({
      kind: "ok",
      cohortKey: "cafe:delhi",
    });
  });

  it("accepts both group types", () => {
    expect(checkRegisterRequest({ ...valid, chatType: "group" }).kind).toBe(
      "ok",
    );
  });

  it("refuses a private chat", () => {
    // There is nothing to register: the point is to claim the group you are in.
    expect(checkRegisterRequest({ ...valid, chatType: "private" })).toEqual({
      kind: "not_a_group",
    });
  });

  it("refuses a missing or malformed cohort key", () => {
    for (const argument of [
      undefined,
      "",
      "   ",
      "cafe",
      "cafe delhi",
      "cafe:",
    ]) {
      expect(checkRegisterRequest({ ...valid, argument }).kind).toBe("usage");
    }
  });

  it("normalises case and surrounding space", () => {
    expect(
      checkRegisterRequest({ ...valid, argument: "  Cafe:Delhi  " }),
    ).toEqual({ kind: "ok", cohortKey: "cafe:delhi" });
  });

  it("refuses a non-admin sender", () => {
    expect(
      checkRegisterRequest({ ...valid, senderIsChatAdmin: false }),
    ).toEqual({ kind: "not_admin" });
  });

  it("reports the fixable problem before the unfixable one", () => {
    // A member who typed the command wrong should be told about the command,
    // not that they are not an admin.
    expect(
      checkRegisterRequest({
        chatType: "supergroup",
        argument: "nonsense",
        senderIsChatAdmin: false,
      }).kind,
    ).toBe("usage");
  });
});

describe("registerGroup", () => {
  let sql: FakeSqlExecutor;
  let graph: MemoryGraphStore;
  let deps: RegisterDeps;

  function cohortRow(overrides: Record<string, unknown> = {}) {
    return {
      cohort_key: "cafe:delhi",
      group_id: null,
      invite_link: null,
      title: "Delhi Cafe Crawlers",
      member_hint: 0,
      registered_at: null,
      ...overrides,
    };
  }

  beforeEach(() => {
    sql = new FakeSqlExecutor();
    graph = new MemoryGraphStore(() => 1_700_000_000_000);
    deps = {
      cohorts: new CohortGroupsRepository(sql),
      graph,
      createInviteLink: async () => "https://t.me/+abc123",
      adminId: "coordinator-1",
    };
  });

  it("writes the group to both stores", async () => {
    sql
      .enqueue([cohortRow()])
      .enqueue([
        cohortRow({ group_id: "-1001", invite_link: "https://t.me/+abc123" }),
      ]);

    const result = await registerGroup(
      deps,
      "-1001",
      "Delhi Cafe Crawlers",
      "cafe:delhi",
    );
    expect(result.inviteLink).toBe("https://t.me/+abc123");

    // Postgres is what a coordinator reads…
    expect(sql.calls[1].params).toEqual([
      "cafe:delhi",
      "-1001",
      "https://t.me/+abc123",
      "Delhi Cafe Crawlers",
    ]);
    // …and the Neo4j node is what the community subagent traverses to.
    const [group] = await graph.groupsByCohort(
      systemPrincipal("audit"),
      "cafe:delhi",
    );
    expect(group.groupId).toBe("-1001");
    expect(group.inviteLink).toBe("https://t.me/+abc123");
  });

  it("creates the cohort row first, for a cohort the job has not reached", async () => {
    sql.enqueue([cohortRow()]).enqueue([cohortRow({ group_id: "-1001" })]);
    await registerGroup(deps, "-1001", "New Group", "gym:pune");
    expect(sql.calls[0].sql).toContain("INSERT INTO cohort_groups");
  });

  it("derives the group category from the cohort key", async () => {
    sql.enqueue([cohortRow()]).enqueue([cohortRow({ group_id: "-1001" })]);
    await registerGroup(deps, "-1001", "Pune Gym Crew", "fitness:pune");
    const [group] = await graph.groupsByCohort(
      systemPrincipal("audit"),
      "fitness:pune",
    );
    expect(group.category).toBe("fitness");
  });

  it("writes nothing when the bot cannot mint an invite link", async () => {
    // `createChatInviteLink` fails unless the bot is already an administrator.
    // A registered group with no link is a recommendation nobody can act on.
    deps.createInviteLink = async () => {
      throw new Error("CHAT_ADMIN_REQUIRED");
    };
    await expect(
      registerGroup(deps, "-1001", "Delhi Cafe Crawlers", "cafe:delhi"),
    ).rejects.toThrow("CHAT_ADMIN_REQUIRED");
    expect(sql.calls).toHaveLength(0);
    expect(
      await graph.groupsByCohort(systemPrincipal("audit"), "cafe:delhi"),
    ).toEqual([]);
  });

  it("does not let a user principal near the registry", async () => {
    const asUser = new CohortGroupsRepository(sql);
    await expect(
      asUser.register(
        userPrincipal("tg:1001", "community_connector"),
        "cafe:delhi",
        "-1001",
        "https://t.me/+abc",
      ),
    ).rejects.toThrow();
  });
});
