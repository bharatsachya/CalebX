/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { adminPrincipal, systemPrincipal, userPrincipal } from "@calebx/authz";
import { ForbiddenError } from "@calebx/errors";
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
import {
  NullMemory,
  forgetEverything,
  type AgentDeps,
  type ChatCompletion,
  type ChatModel,
  type ChatRequest,
} from "@calebx/agent";
import { handleAgentJob } from "./pipeline.ts";
import { runIngest } from "./ingest.ts";
import type { AgentJob } from "./payloads.ts";

/**
 * End-to-end verification, against real logic and fake edges.
 *
 * Everything below the transport is the production code path: the router, the
 * mode lock, the authorization layer, the graph traversal, the tools. Only the
 * model, the SQL, the embedder and the places API are substituted — and the
 * graph substitute runs the same authorization checks as Neo4j does.
 *
 * These are the checks Phase 5 of the plan calls for: mode guardrails,
 * second-degree recommendations, and cross-user isolation.
 */

const ALICE = "tg:1001";
const BOB = "tg:2002";
const CAROL = "tg:3003";
const NOW = 1_700_000_000_000;

class ScriptedModel implements ChatModel {
  readonly requests: ChatRequest[] = [];
  private index = 0;
  constructor(private script: string[]) {}
  push(...replies: string[]): void {
    this.script = [...this.script, ...replies];
  }
  async complete(request: ChatRequest): Promise<ChatCompletion> {
    this.requests.push(request);
    const reply = this.script[this.index] ?? this.script.at(-1) ?? "";
    if (this.index < this.script.length - 1) this.index += 1;
    return { content: reply, toolCalls: [] };
  }
}

let sql: FakeSqlExecutor;
let graph: MemoryGraphStore;
let model: ScriptedModel;
let deps: AgentDeps;
const embedder = new HashEmbedder();

const community = (userId: string) =>
  userPrincipal(userId, "community_connector");

function modeRow(active: string | null, enrolled: string[]) {
  return { user_id: ALICE, active_mode: active, enrolled_modes: enrolled };
}

function buildDeps(): AgentDeps {
  return {
    model,
    memory: new NullMemory(),
    agentUsers: new AgentUsersRepository(sql),
    graph,
    embed: embedder,
    places: new StubPlacesClient(),
    repos: {
      matchmaking: new MatchmakingRepository(sql),
      search: new CandidateSearchRepository(sql),
      review: new ReviewTasksRepository(sql),
      cohorts: new CohortGroupsRepository(sql),
    },
    hashUserId: (userId) => `hash-${userId}`,
    handleSalt: "integration-salt",
    pairWriter: adminPrincipal("pair-writer"),
    systemPrincipal: systemPrincipal("lookups"),
    now: () => NOW,
  };
}

const job: AgentJob = {
  userId: ALICE,
  chatId: "1001",
  text: "just moved to bangalore, know anyone?",
  channel: "Telegram",
};

async function seed(
  userId: string,
  texts: [string, "interest" | "location"][],
) {
  const embeddings = await embedder.embed(texts.map(([text]) => text));
  await graph.addChunks(
    community(userId),
    userId,
    texts.map(([text, category], index) => ({
      text,
      category,
      embedding: embeddings[index],
    })),
  );
}

beforeEach(() => {
  sql = new FakeSqlExecutor();
  graph = new MemoryGraphStore(() => NOW);
  model = new ScriptedModel([]);
  deps = buildDeps();
});

describe("mode guardrails", () => {
  it("routes a first message and locks in a mode", async () => {
    model.push("community_connector", "Whereabouts have you landed?");
    sql
      .enqueue([modeRow(null, [])]) // ensure
      .enqueue([]) // grantConsent
      .enqueue([modeRow("community_connector", ["community_connector"])]) // enroll
      .enqueue([modeRow("community_connector", ["community_connector"])]); // setActive

    const result = await handleAgentJob(deps, { ...job, text: "hi there" });
    expect(result.outcome.kind).toBe("reply");
    if (result.outcome.kind === "reply") {
      expect(result.outcome.mode).toBe("community_connector");
    }
    // The classification call, then the conversation call.
    expect(model.requests[0].temperature).toBe(0.1);
    expect(model.requests[1].temperature).toBe(0.7);
  });

  it("does not re-route once a mode is set", async () => {
    model.push("Which part of town?");
    sql.enqueue([modeRow("community_connector", ["community_connector"])]);

    await handleAgentJob(deps, job);
    expect(model.requests).toHaveLength(1);
  });

  it("refuses to switch into an unconsented mode, and does not switch", async () => {
    model.push("ok");
    sql.enqueue([modeRow("community_connector", ["community_connector"])]);

    const result = await handleAgentJob(deps, {
      ...job,
      command: { name: "switch" },
    });

    expect(result.outcome.kind).toBe("needs_consent");
    // No UPDATE ran: the mode is unchanged until consent is granted.
    expect(sql.calls.some((call) => call.sql.includes("SET active_mode"))).toBe(
      false,
    );
  });

  it("switches once both modes are enrolled, in either direction", async () => {
    model.push("ok");
    const both = ["community_connector", "matchmaker"];
    sql
      .enqueue([modeRow("community_connector", both)])
      .enqueue([modeRow("matchmaker", both)]);

    const forward = await handleAgentJob(deps, {
      ...job,
      command: { name: "switch" },
    });
    expect(forward.outcome.kind).toBe("switched");

    sql
      .enqueue([modeRow("matchmaker", both)])
      .enqueue([modeRow("community_connector", both)]);
    const back = await handleAgentJob(deps, {
      ...job,
      command: { name: "switch" },
    });
    expect(back.outcome.kind).toBe("switched");
    if (back.outcome.kind === "switched") {
      expect(back.outcome.mode).toBe("community_connector");
    }
  });

  it("keeps community persona data out of a matchmaker turn", async () => {
    // The single most important boundary: same person, wrong mode, no access.
    await seed(ALICE, [["prefers quiet cafes for work", "interest"]]);
    const asMatchmaker = userPrincipal(ALICE, "matchmaker");
    await expect(graph.listChunks(asMatchmaker, ALICE)).rejects.toThrow(
      /cross-mode/,
    );
  });

  it("keeps the two modes' memories in separate keys", async () => {
    const memory = new NullMemory();
    deps = { ...buildDeps(), memory };
    model.push("Which part of town?");
    sql.enqueue([modeRow("community_connector", ["community_connector"])]);

    await handleAgentJob(deps, job);
    expect(memory.searches[0].mode).toBe("community_connector");
  });
});

describe("second-degree people recommendations", () => {
  beforeEach(async () => {
    // alice — bob — carol, with carol opted in and sharing an interest.
    await graph.linkKnows(community(ALICE), ALICE, BOB);
    await graph.linkKnows(community(BOB), BOB, CAROL);
    await seed(ALICE, [
      ["prefers quiet cafes for work", "interest"],
      ["lives in Koramangala", "location"],
    ]);
    await seed(CAROL, [
      ["works from cafes most days", "interest"],
      ["lives in Indiranagar", "location"],
    ]);
  });

  it("surfaces a friend-of-friend who opted in", async () => {
    await graph.setDiscoverable(community(CAROL), CAROL, true);
    model.push(
      "There's someone you've got a mutual friend with who also works from cafes.",
    );
    sql.enqueue([modeRow("community_connector", ["community_connector"])]);

    const result = await handleAgentJob(deps, job);
    expect(result.outcome.kind).toBe("reply");

    // The narration prompt is built from real retrieved data, not invented.
    const narration = model.requests.at(-1)!.system;
    expect(narration).toContain("find_like_minded_people");
    expect(narration).toContain("works from cafes most days");
  });

  it("never puts the peer's identity in front of the model", async () => {
    await graph.setDiscoverable(community(CAROL), CAROL, true);
    model.push("Someone worth meeting.");
    sql.enqueue([modeRow("community_connector", ["community_connector"])]);

    await handleAgentJob(deps, job);
    const narration = model.requests.at(-1)!.system;
    expect(narration).not.toContain(CAROL);
    expect(narration).not.toContain("3003");
  });

  it("offers nobody when the peer has not opted in", async () => {
    model.push("Nothing yet — tell me what a good evening looks like?");
    sql.enqueue([modeRow("community_connector", ["community_connector"])]);

    const result = await handleAgentJob(deps, job);
    expect(result.outcome.kind).toBe("reply");
    // Nothing was found, so the narration step never ran; the turn fell through
    // to ordinary conversation instead of announcing an empty result.
    const prompts = model.requests.map((request) => request.system).join("\n");
    expect(prompts).not.toContain("RESULTS (JSON)");
  });
});

describe("cross-user isolation", () => {
  beforeEach(async () => {
    await seed(BOB, [["something private about bob", "interest"]]);
  });

  it("refuses a direct read of another user's chunks", async () => {
    await expect(graph.listChunks(community(ALICE), BOB)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("refuses a vector search scoped to another user", async () => {
    const [query] = await embedder.embed(["something private"]);
    await expect(
      graph.searchOwnChunks(community(ALICE), BOB, query),
    ).rejects.toThrow(ForbiddenError);
  });

  it("returns only the searcher's own chunks for an identical query", async () => {
    await seed(ALICE, [["something private about bob", "interest"]]);
    const [query] = await embedder.embed(["something private about bob"]);
    const results = await graph.searchOwnChunks(
      community(ALICE),
      ALICE,
      query,
      10,
    );
    expect(results).toHaveLength(1);
    expect(results.every((result) => result.chunk.userId === ALICE)).toBe(true);
  });

  it("refuses to read a non-discoverable peer even with a mutual friend", async () => {
    await graph.linkKnows(community(ALICE), ALICE, CAROL);
    await graph.linkKnows(community(CAROL), CAROL, BOB);
    await expect(graph.peerChunks(community(ALICE), BOB)).rejects.toThrow(
      /not discoverable/,
    );
  });

  it("refuses a user the bulk surface a background job uses", async () => {
    await expect(graph.knowsEdges(community(ALICE))).rejects.toThrow(
      ForbiddenError,
    );
    await expect(graph.allUserInterests(community(ALICE))).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("gives a background job anonymized bulk access and nothing more", async () => {
    const cohortJob = systemPrincipal("cohort-clustering");
    await expect(graph.allUserInterests(cohortJob)).resolves.toBeDefined();
    await expect(graph.listChunks(cohortJob, BOB)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("ingestion writes the persona a turn produced", () => {
  it("stores extracted chunks under the right user and mode", async () => {
    const report = await runIngest(
      {
        extract: async () =>
          JSON.stringify({
            location_hint: "Indiranagar",
            chunks: [
              { text: "works out of cafes on weekdays", category: "interest" },
            ],
          }),
        promptFor: () => "PROMPT",
        parse: (raw) => {
          const parsed = JSON.parse(raw) as {
            location_hint: string | null;
            chunks: { text: string; category: "interest" | "location" }[];
          };
          return { locationHint: parsed.location_hint, chunks: parsed.chunks };
        },
        embed: embedder,
        graph,
        principalFor: (userId, mode) => userPrincipal(userId, mode),
      },
      {
        userId: ALICE,
        mode: "community_connector",
        text: "I work out of cafes in Indiranagar",
        reply: "Nice.",
      },
    );

    expect(report.chunksWritten).toBe(2);
    const chunks = await graph.listChunks(community(ALICE), ALICE);
    expect(chunks.map((chunk) => chunk.category).sort()).toEqual([
      "interest",
      "location",
    ]);
  });
});

describe("/forget", () => {
  it("erases the graph, and reports honestly when a store fails", async () => {
    await seed(ALICE, [["prefers quiet cafes for work", "interest"]]);
    await graph.linkKnows(community(ALICE), ALICE, BOB);

    const report = await forgetEverything({
      memories: async () => {
        throw new Error("mem0 unreachable");
      },
      graph: () => graph.deleteUser(community(ALICE), ALICE),
      modeState: async () => undefined,
    });

    // The graph wipe still happened despite mem0 being down…
    expect(await graph.getUser(community(ALICE), ALICE)).toBeNull();
    expect(await graph.listChunks(community(ALICE), ALICE)).toEqual([]);
    // …and the user is owed the truth about the part that did not.
    expect(report.ok).toBe(false);
    expect(report.failed).toEqual(["memories"]);
  });

  it("removes the user from other people's graphs too", async () => {
    await graph.linkKnows(community(ALICE), ALICE, BOB);
    await graph.deleteUser(community(ALICE), ALICE);
    expect(await graph.knowsEdges(systemPrincipal("audit"))).toEqual([]);
  });
});
