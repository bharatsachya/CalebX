/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { adminPrincipal, systemPrincipal } from "@calebx/authz";
import { HashEmbedder } from "@calebx/embed";
import { MemoryGraphStore } from "@calebx/graph";
import { StubPlacesClient } from "@calebx/community";
import {
  AgentUsersRepository,
  CandidateSearchRepository,
  CohortGroupsRepository,
  FakeSqlExecutor,
  MatchmakingRepository,
  ReviewTasksRepository,
} from "@calebx/db";
import { NullMemory } from "@calebx/agent";
import type {
  AgentDeps,
  ChatCompletion,
  ChatModel,
  ChatRequest,
} from "@calebx/agent";
import { handleAgentJob, toDispatchJobs } from "./pipeline.ts";
import type { AgentJob } from "./payloads.ts";

const USER = "tg:1001";

class ScriptedModel implements ChatModel {
  readonly requests: ChatRequest[] = [];
  private index = 0;
  constructor(private readonly script: string[]) {}
  async complete(request: ChatRequest): Promise<ChatCompletion> {
    this.requests.push(request);
    const reply = this.script[this.index] ?? this.script.at(-1) ?? "";
    if (this.index < this.script.length - 1) this.index += 1;
    return { content: reply, toolCalls: [] };
  }
}

let sql: FakeSqlExecutor;
let deps: AgentDeps;

const job: AgentJob = {
  userId: USER,
  chatId: "1001",
  text: "just moved to bangalore",
  channel: "Telegram",
};

function makeDeps(
  model: ChatModel,
  modeRow?: Record<string, unknown>,
): AgentDeps {
  sql = new FakeSqlExecutor();
  // agentUsers.ensure() is the first query of every turn.
  sql.enqueue([
    modeRow ?? { user_id: USER, active_mode: null, enrolled_modes: [] },
  ]);
  return {
    model,
    // Injected so a turn is exercised without a network call to mem0.
    memory: new NullMemory(),
    agentUsers: new AgentUsersRepository(sql),
    graph: new MemoryGraphStore(() => 1_700_000_000_000),
    embed: new HashEmbedder(),
    places: new StubPlacesClient(),
    repos: {
      matchmaking: new MatchmakingRepository(sql),
      search: new CandidateSearchRepository(sql),
      review: new ReviewTasksRepository(sql),
      cohorts: new CohortGroupsRepository(sql),
    },
    hashUserId: (userId) => `hash-${userId}`,
    handleSalt: "salt",
    pairWriter: adminPrincipal("pair-writer"),
    systemPrincipal: systemPrincipal("lookups"),
  };
}

describe("first turn", () => {
  beforeEach(() => {
    // ensure → classify → grantConsent → enroll → setActiveMode, then the reply.
    deps = makeDeps(new ScriptedModel(["community_connector", "Whereabouts?"]));
  });

  it("routes, assigns a mode, and replies", async () => {
    sql
      .enqueue([]) // grantConsent
      .enqueue([
        {
          user_id: USER,
          active_mode: "community_connector",
          enrolled_modes: ["community_connector"],
        },
      ])
      .enqueue([
        {
          user_id: USER,
          active_mode: "community_connector",
          enrolled_modes: ["community_connector"],
        },
      ]);

    const result = await handleAgentJob(deps, job);
    expect(result.outcome.kind).toBe("reply");
    expect(result.outbound).toEqual([{ kind: "reply", text: "Whereabouts?" }]);
  });

  it("queues an ingest job carrying the mode", async () => {
    sql
      .enqueue([])
      .enqueue([
        {
          user_id: USER,
          active_mode: "community_connector",
          enrolled_modes: ["community_connector"],
        },
      ])
      .enqueue([
        {
          user_id: USER,
          active_mode: "community_connector",
          enrolled_modes: ["community_connector"],
        },
      ]);

    const result = await handleAgentJob(deps, job);
    expect(result.ingest).toEqual({
      userId: USER,
      mode: "community_connector",
      text: job.text,
      reply: "Whereabouts?",
      traceId: undefined,
    });
  });
});

describe("/switch", () => {
  it("asks for consent before entering an unenrolled mode", async () => {
    // The grant made at /start covers one mode, not both.
    deps = makeDeps(new ScriptedModel(["ok"]), {
      user_id: USER,
      active_mode: "community_connector",
      enrolled_modes: ["community_connector"],
    });

    const result = await handleAgentJob(deps, {
      ...job,
      command: { name: "switch" },
    });

    expect(result.outcome.kind).toBe("needs_consent");
    expect(result.outbound[0].kind).toBe("mode_consent");
    expect(result.outbound[0].mode).toBe("matchmaker");
    expect(result.outbound[0].text).toContain(
      "Matchmaking works a bit differently",
    );
    expect(result.ingest).toBeUndefined();
  });

  it("switches when the user is already enrolled", async () => {
    deps = makeDeps(new ScriptedModel(["ok"]), {
      user_id: USER,
      active_mode: "community_connector",
      enrolled_modes: ["community_connector", "matchmaker"],
    });
    sql.enqueue([
      {
        user_id: USER,
        active_mode: "matchmaker",
        enrolled_modes: ["community_connector", "matchmaker"],
      },
    ]);

    const result = await handleAgentJob(deps, {
      ...job,
      command: { name: "switch" },
    });
    expect(result.outcome.kind).toBe("switched");
    expect(result.outbound[0].text).toContain("Switched to matchmaking");
  });

  it("says so when already in the requested mode", async () => {
    deps = makeDeps(new ScriptedModel(["ok"]), {
      user_id: USER,
      active_mode: "matchmaker",
      enrolled_modes: ["community_connector", "matchmaker"],
    });
    const result = await handleAgentJob(deps, {
      ...job,
      command: { name: "switch", argument: "matchmaker" },
    });
    expect(result.outcome.kind).toBe("already_active");
    expect(result.outbound[0].text).toContain("already on matchmaking");
  });

  it("does not ingest a switch turn", async () => {
    deps = makeDeps(new ScriptedModel(["ok"]), {
      user_id: USER,
      active_mode: "community_connector",
      enrolled_modes: ["community_connector", "matchmaker"],
    });
    sql.enqueue([
      {
        user_id: USER,
        active_mode: "matchmaker",
        enrolled_modes: ["community_connector", "matchmaker"],
      },
    ]);
    const result = await handleAgentJob(deps, {
      ...job,
      command: { name: "switch" },
    });
    expect(result.ingest).toBeUndefined();
  });
});

describe("established mode", () => {
  it("runs the active mode without re-routing", async () => {
    const model = new ScriptedModel(["Which part of town?"]);
    deps = makeDeps(model, {
      user_id: USER,
      active_mode: "community_connector",
      enrolled_modes: ["community_connector"],
    });

    const result = await handleAgentJob(deps, job);
    expect(result.outcome.kind).toBe("reply");
    // One completion only: no router call when the mode is settled.
    expect(model.requests).toHaveLength(1);
  });

  it("applies the single-question rule to the reply", async () => {
    deps = makeDeps(
      new ScriptedModel(["Which city are you in? And which area? And why?"]),
      {
        user_id: USER,
        active_mode: "community_connector",
        enrolled_modes: ["community_connector"],
      },
    );
    const result = await handleAgentJob(deps, job);
    expect(result.outbound[0].text).toBe("Which city are you in?");
  });

  it("substitutes the fallback when the model returns nothing", async () => {
    deps = makeDeps(new ScriptedModel([""]), {
      user_id: USER,
      active_mode: "community_connector",
      enrolled_modes: ["community_connector"],
    });
    const result = await handleAgentJob(deps, job);
    expect(result.outbound[0].text).toBe("I'm here — what's on your mind?");
  });
});

describe("toDispatchJobs", () => {
  it("addresses every message to the originating chat", () => {
    const jobs = toDispatchJobs(
      { ...job, isGroup: true, traceId: "abc" },
      [{ kind: "reply", text: "hello" }],
      "tg",
    );
    expect(jobs).toEqual([
      {
        chatId: "1001",
        text: "hello",
        channel: "tg",
        isGroup: true,
        traceId: "abc",
      },
    ]);
  });

  it("returns nothing for no outbound messages", () => {
    expect(toDispatchJobs(job, [], "tg")).toEqual([]);
  });
});
