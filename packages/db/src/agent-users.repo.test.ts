/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { ForbiddenError, ValidationError } from "@calebx/errors";
import { adminPrincipal, systemPrincipal, userPrincipal } from "@calebx/authz";
import { AgentUsersRepository } from "./agent-users.repo.ts";
import { FakeSqlExecutor } from "./executor.ts";

const ALICE = "tg:1001";
const BOB = "tg:2002";
const alice = userPrincipal(ALICE, "matchmaker");

let sql: FakeSqlExecutor;
let repo: AgentUsersRepository;

beforeEach(() => {
  sql = new FakeSqlExecutor();
  repo = new AgentUsersRepository(sql);
});

describe("getState", () => {
  it("returns null for a user the router has never seen", async () => {
    expect(await repo.getState(alice, ALICE)).toBeNull();
  });

  it("maps the row into a mode state", async () => {
    sql.enqueue([
      {
        user_id: ALICE,
        active_mode: "matchmaker",
        enrolled_modes: ["matchmaker"],
      },
    ]);
    expect(await repo.getState(alice, ALICE)).toEqual({
      userId: ALICE,
      activeMode: "matchmaker",
      enrolledModes: ["matchmaker"],
    });
  });

  it("treats a null enrolled_modes as an empty list", async () => {
    sql.enqueue([{ user_id: ALICE, active_mode: null, enrolled_modes: null }]);
    const state = await repo.getState(alice, ALICE);
    expect(state?.enrolledModes).toEqual([]);
    expect(state?.activeMode).toBeNull();
  });

  it("scopes the query to the user", async () => {
    await repo.getState(alice, ALICE);
    expect(sql.lastSql()).toContain("WHERE user_id = $1");
    expect(sql.calls[0].params).toEqual([ALICE]);
  });

  it("refuses to read another user's mode state", async () => {
    // The mode state decides which half of the data a turn may touch, so
    // reading someone else's is not a small leak.
    await expect(repo.getState(alice, BOB)).rejects.toThrow(ForbiddenError);
    expect(sql.calls).toHaveLength(0);
  });

  it("refuses a system principal", async () => {
    await expect(
      repo.getState(systemPrincipal("cohort"), ALICE),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows an admin to read it", async () => {
    sql.enqueue([
      { user_id: ALICE, active_mode: "matchmaker", enrolled_modes: [] },
    ]);
    await expect(
      repo.getState(adminPrincipal("c1"), ALICE),
    ).resolves.not.toBeNull();
  });
});

describe("ensure", () => {
  it("upserts and returns the state", async () => {
    sql.enqueue([{ user_id: ALICE, active_mode: null, enrolled_modes: [] }]);
    const state = await repo.ensure(alice, ALICE);
    expect(state.userId).toBe(ALICE);
    expect(sql.lastSql()).toContain("ON CONFLICT (user_id) DO UPDATE");
  });

  it("throws rather than inventing an empty state when nothing came back", async () => {
    // ON CONFLICT … RETURNING always returns a row. No row means the statement
    // did not run, which must not be read as "this user has no modes".
    await expect(repo.ensure(alice, ALICE)).rejects.toThrow(ValidationError);
  });
});

describe("setActiveMode", () => {
  it("updates and returns the new state", async () => {
    sql.enqueue([
      {
        user_id: ALICE,
        active_mode: "community_connector",
        enrolled_modes: ["matchmaker", "community_connector"],
      },
    ]);
    const state = await repo.setActiveMode(alice, ALICE, "community_connector");
    expect(state.activeMode).toBe("community_connector");
    expect(sql.calls[0].params).toEqual([ALICE, "community_connector"]);
  });

  it("rejects a mode that is not one of the two", async () => {
    await expect(
      repo.setActiveMode(alice, ALICE, "dating" as never),
    ).rejects.toThrow(/unknown agent mode/);
    expect(sql.calls).toHaveLength(0);
  });

  it("throws when the user has no row yet", async () => {
    await expect(
      repo.setActiveMode(alice, ALICE, "matchmaker"),
    ).rejects.toThrow(/no agent_users row/);
  });

  it("refuses to switch another user's mode", async () => {
    await expect(repo.setActiveMode(alice, BOB, "matchmaker")).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("enroll", () => {
  it("adds the mode and passes it as an array for the union", async () => {
    sql.enqueue([
      {
        user_id: ALICE,
        active_mode: "matchmaker",
        enrolled_modes: ["matchmaker", "community_connector"],
      },
    ]);
    const state = await repo.enroll(alice, ALICE, "community_connector");
    expect(state.enrolledModes).toContain("community_connector");
    expect(sql.calls[0].params).toEqual([ALICE, ["community_connector"]]);
  });

  it("makes the first enrolled mode active", async () => {
    expect(
      (await repo.enroll(alice, ALICE, "matchmaker").catch(() => null)) ===
        null,
    ).toBe(true);
    expect(sql.lastSql()).toContain(
      "active_mode = coalesce(active_mode, $2[1])",
    );
  });

  it("deduplicates rather than appending a mode twice", async () => {
    await repo.enroll(alice, ALICE, "matchmaker").catch(() => undefined);
    expect(sql.lastSql()).toContain("array_agg(DISTINCT m)");
  });
});

describe("consent", () => {
  it("grants a mode's consent idempotently", async () => {
    await repo.grantConsent(alice, ALICE, "matchmaker");
    expect(sql.lastSql()).toContain("ON CONFLICT (user_id, mode) DO NOTHING");
    expect(sql.calls[0].params).toEqual([ALICE, "matchmaker"]);
  });

  it("lists the modes a user has consented to", async () => {
    sql.enqueue([{ mode: "matchmaker" }, { mode: "community_connector" }]);
    expect(await repo.consentedModes(alice, ALICE)).toEqual([
      "matchmaker",
      "community_connector",
    ]);
  });

  it("returns an empty list when nothing was granted", async () => {
    expect(await repo.consentedModes(alice, ALICE)).toEqual([]);
  });

  it("refuses to grant consent on someone else's behalf", async () => {
    await expect(repo.grantConsent(alice, BOB, "matchmaker")).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("deleteUser (/forget)", () => {
  it("deletes the row, cascading to mode_consent", async () => {
    await repo.deleteUser(alice, ALICE);
    expect(sql.lastSql()).toBe("DELETE FROM agent_users WHERE user_id = $1");
    expect(sql.calls[0].params).toEqual([ALICE]);
  });

  it("refuses to delete another user", async () => {
    await expect(repo.deleteUser(alice, BOB)).rejects.toThrow(ForbiddenError);
    expect(sql.calls).toHaveLength(0);
  });

  it("refuses an admin, who may not delete a user's account", async () => {
    await expect(repo.deleteUser(adminPrincipal("c1"), ALICE)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("every statement is owner-scoped", () => {
  it("never issues an unscoped query, whatever the method", async () => {
    // scopedSql throws on an unscoped statement, so reaching the executor at
    // all proves the predicate was there.
    sql.enqueue([{ user_id: ALICE, active_mode: null, enrolled_modes: [] }]);
    await repo.ensure(alice, ALICE);
    await repo.getState(alice, ALICE);
    await repo.grantConsent(alice, ALICE, "matchmaker");
    await repo.consentedModes(alice, ALICE);
    await repo.deleteUser(alice, ALICE);
    for (const call of sql.calls) {
      // Either a WHERE predicate on the owner, or an INSERT that names the
      // owner column — the two shapes `assertSqlScoped` accepts.
      expect(call.sql).toMatch(
        /user_id\s*=\s*\$1|insert\s+into\s+\w+\s*\([^)]*user_id/i,
      );
      expect(call.params[0]).toBe(ALICE);
    }
  });
});
