/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { userPrincipal } from "@calebx/authz";
import { FakeSqlExecutor, ReviewTasksRepository } from "@calebx/db";
import { createHumanReviewTool } from "./human-review.ts";

interface Ctx {
  principal: ReturnType<typeof userPrincipal>;
  userId: string;
  review: ReviewTasksRepository;
}

const USER = "tg:1001";
let sql: FakeSqlExecutor;
let context: Ctx;
const tool = createHumanReviewTool<Ctx>((ctx) => ({
  principal: ctx.principal,
  userId: ctx.userId,
  review: ctx.review,
}));

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    kind: "agent_escalation",
    state: "open",
    user_id: USER,
    payload: { reason: "user reported harassment" },
    note: null,
    created_at: new Date(),
    resolved_at: null,
    resolved_by: null,
    ...overrides,
  };
}

beforeEach(() => {
  sql = new FakeSqlExecutor();
  context = {
    principal: userPrincipal(USER, "community_connector"),
    userId: USER,
    review: new ReviewTasksRepository(sql),
  };
});

describe("request_human_review", () => {
  it("is available with a required reason", () => {
    expect(tool.name).toBe("request_human_review");
    expect(tool.parameters.required).toEqual(["reason"]);
  });

  it("files an escalation task", async () => {
    sql.enqueue([]).enqueue([taskRow()]);
    const result = await tool.handler(context, {
      reason: "user reported harassment",
    });
    expect(result.ok).toBe(true);
    expect((result.data as { taskId: string }).taskId).toBe("t1");
    expect(sql.calls[1].params[0]).toBe("agent_escalation");
  });

  it("does not block the conversation", async () => {
    // A bot that goes silent pending review is indistinguishable from a broken
    // one, so the instruction is explicitly to carry on.
    sql.enqueue([]).enqueue([taskRow()]);
    const result = await tool.handler(context, { reason: "something odd" });
    expect(result.message).toContain("carry on");
  });

  it("does not promise a timeline", async () => {
    sql.enqueue([]).enqueue([taskRow()]);
    const result = await tool.handler(context, { reason: "something odd" });
    expect(result.message).toContain("Do not promise when");
  });

  it("refuses a blank reason", async () => {
    expect((await tool.handler(context, { reason: "   " })).ok).toBe(false);
    expect((await tool.handler(context, {})).ok).toBe(false);
    expect(sql.calls).toHaveLength(0);
  });

  it("truncates a rambling reason", async () => {
    sql.enqueue([]).enqueue([taskRow()]);
    await tool.handler(context, { reason: "x".repeat(900) });
    const payload = JSON.parse(String(sql.calls[1].params[2])) as {
      reason: string;
    };
    expect(payload.reason).toHaveLength(500);
  });

  it("reuses the open task instead of filing a duplicate", async () => {
    sql.enqueue([taskRow()]);
    const result = await tool.handler(context, {
      reason: "user reported harassment",
    });
    expect(result.ok).toBe(true);
    expect(sql.calls).toHaveLength(1);
  });
});
