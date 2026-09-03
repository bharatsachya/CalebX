/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import type { ToolDefinition } from "@calebx/core";
import type { ChatCompletion, ChatModel, ChatRequest } from "./chat.ts";
import {
  RECOMMENDATION_TOOLS,
  buildNarrationPrompt,
  gatherRecommendations,
  hasAnything,
  runRecommendation,
} from "./recommendation.ts";

interface Ctx {
  ran: string[];
}

function tool(
  name: string,
  behaviour: "ok" | "empty" | "throw",
  data: unknown = { items: [name] },
): ToolDefinition<Ctx> {
  return {
    name,
    description: `${name} for testing`,
    parameters: { type: "object", properties: {} },
    async handler(context) {
      context.ran.push(name);
      if (behaviour === "throw") throw new Error("boom");
      if (behaviour === "empty") return { ok: false, message: "nothing here" };
      return { ok: true, data };
    },
  };
}

class CapturingModel implements ChatModel {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly reply = "Here's what I found.") {}
  async complete(request: ChatRequest): Promise<ChatCompletion> {
    this.requests.push(request);
    return { content: this.reply, toolCalls: [] };
  }
}

describe("RECOMMENDATION_TOOLS", () => {
  it("names one source for matchmaking and three for community", () => {
    expect(RECOMMENDATION_TOOLS.matchmaker).toEqual([
      "search_matrimonial_candidates",
    ]);
    expect(RECOMMENDATION_TOOLS.community_connector).toEqual([
      "find_like_minded_people",
      "search_community_groups",
      "get_curated_places",
    ]);
  });
});

describe("gatherRecommendations", () => {
  it("runs the named tools in order", async () => {
    const context: Ctx = { ran: [] };
    await gatherRecommendations(
      [tool("a", "ok"), tool("b", "ok")],
      ["b", "a"],
      context,
    );
    expect(context.ran).toEqual(["b", "a"]);
  });

  it("does not leave retrieval to the model", async () => {
    // The whole point: the tools are called by this code, deterministically.
    const context: Ctx = { ran: [] };
    const gathered = await gatherRecommendations(
      [tool("a", "ok")],
      ["a"],
      context,
    );
    expect(gathered).toHaveLength(1);
    expect(gathered[0].result.ok).toBe(true);
  });

  it("keeps the source that worked when another has nothing", async () => {
    const context: Ctx = { ran: [] };
    const gathered = await gatherRecommendations(
      [tool("people", "empty"), tool("places", "ok")],
      ["people", "places"],
      context,
    );
    expect(gathered.filter((g) => g.result.ok).map((g) => g.tool)).toEqual([
      "places",
    ]);
  });

  it("keeps going when a tool throws", async () => {
    const context: Ctx = { ran: [] };
    const gathered = await gatherRecommendations(
      [tool("broken", "throw"), tool("places", "ok")],
      ["broken", "places"],
      context,
    );
    expect(gathered).toHaveLength(2);
    expect(gathered[0].result.ok).toBe(false);
    expect(gathered[1].result.ok).toBe(true);
  });

  it("skips a name with no matching tool", async () => {
    const context: Ctx = { ran: [] };
    const gathered = await gatherRecommendations(
      [tool("a", "ok")],
      ["ghost", "a"],
      context,
    );
    expect(gathered.map((g) => g.tool)).toEqual(["a"]);
  });

  it("returns nothing for an empty name list", async () => {
    expect(
      await gatherRecommendations([tool("a", "ok")], [], { ran: [] }),
    ).toEqual([]);
  });
});

describe("hasAnything", () => {
  it("is false when every source failed", () => {
    expect(
      hasAnything([{ tool: "a", result: { ok: false, message: "none" } }]),
    ).toBe(false);
  });

  it("is false when a source succeeded but returned no data", () => {
    expect(hasAnything([{ tool: "a", result: { ok: true } }])).toBe(false);
  });

  it("is true when one source returned data", () => {
    expect(
      hasAnything([{ tool: "a", result: { ok: true, data: { x: 1 } } }]),
    ).toBe(true);
  });
});

describe("buildNarrationPrompt", () => {
  it("includes only successful results", () => {
    const prompt = buildNarrationPrompt("PERSONA", [
      { tool: "places", result: { ok: true, data: { name: "Blue Tokai" } } },
      { tool: "people", result: { ok: false, message: "nobody opted in" } },
    ]);
    expect(prompt).toContain("Blue Tokai");
    expect(prompt).toContain("PERSONA");
  });

  it("lists the sources that had nothing, so the model can be honest", () => {
    const prompt = buildNarrationPrompt("P", [
      { tool: "people", result: { ok: false, message: "nobody opted in" } },
    ]);
    expect(prompt).toContain("Sources that had nothing");
    expect(prompt).toContain("nobody opted in");
  });

  it("forbids padding, which is this path's main failure mode", () => {
    const prompt = buildNarrationPrompt("P", [
      { tool: "places", result: { ok: true, data: [{ name: "One" }] } },
    ]);
    expect(prompt).toContain("Never add, embellish, or round up");
    expect(prompt).toContain("Do not pad it to three");
  });

  it("forbids surfacing scores, handles and ratings", () => {
    const prompt = buildNarrationPrompt("P", []);
    expect(prompt).toContain(
      "Do not mention scores, similarity, handles, ids, or ratings",
    );
  });

  it("keeps the single-question rule", () => {
    expect(buildNarrationPrompt("P", [])).toContain("at most one question");
  });
});

describe("runRecommendation", () => {
  it("gathers then narrates", async () => {
    const model = new CapturingModel("There's a spot on 12th Main you'd like.");
    const context: Ctx = { ran: [] };
    const outcome = await runRecommendation({
      model,
      persona: "PERSONA",
      tools: [tool("places", "ok")],
      toolNames: ["places"],
      context,
    });
    expect(context.ran).toEqual(["places"]);
    expect(outcome.narration).toBe("There's a spot on 12th Main you'd like.");
  });

  it("does not call the model at all when nothing was found", async () => {
    // Narrating an empty result set is how a model invents a place.
    const model = new CapturingModel();
    const outcome = await runRecommendation({
      model,
      persona: "P",
      tools: [tool("places", "empty")],
      toolNames: ["places"],
      context: { ran: [] },
    });
    expect(outcome.narration).toBeNull();
    expect(model.requests).toHaveLength(0);
  });

  it("withholds tools from the narration call", async () => {
    const model = new CapturingModel();
    await runRecommendation({
      model,
      persona: "P",
      tools: [tool("places", "ok")],
      toolNames: ["places"],
      context: { ran: [] },
    });
    expect(model.requests[0].tools).toEqual([]);
  });

  it("returns what was gathered alongside the narration", async () => {
    const model = new CapturingModel();
    const outcome = await runRecommendation({
      model,
      persona: "P",
      tools: [tool("a", "ok"), tool("b", "empty")],
      toolNames: ["a", "b"],
      context: { ran: [] },
    });
    expect(outcome.gathered.map((g) => g.tool)).toEqual(["a", "b"]);
  });

  it("uses a moderate temperature by default and honours an override", async () => {
    const model = new CapturingModel();
    await runRecommendation({
      model,
      persona: "P",
      tools: [tool("a", "ok")],
      toolNames: ["a"],
      context: { ran: [] },
    });
    expect(model.requests[0].temperature).toBe(0.6);

    const other = new CapturingModel();
    await runRecommendation({
      model: other,
      persona: "P",
      tools: [tool("a", "ok")],
      toolNames: ["a"],
      context: { ran: [] },
      temperature: 0.3,
    });
    expect(other.requests[0].temperature).toBe(0.3);
  });
});
