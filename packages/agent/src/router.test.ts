/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import type { ChatCompletion, ChatModel, ChatRequest } from "./chat.ts";
import { ROUTER_PROMPT, classifyMode } from "./router.ts";

class FixedModel implements ChatModel {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly reply: string | Error) {}
  async complete(request: ChatRequest): Promise<ChatCompletion> {
    this.requests.push(request);
    if (this.reply instanceof Error) throw this.reply;
    return { content: this.reply, toolCalls: [] };
  }
}

describe("ROUTER_PROMPT", () => {
  it("names both modes and states the tie-break", () => {
    expect(ROUTER_PROMPT).toContain("matchmaker");
    expect(ROUTER_PROMPT).toContain("community_connector");
    expect(ROUTER_PROMPT).toContain("answer community_connector");
  });
});

describe("classifyMode", () => {
  it("classifies a matrimonial opener", async () => {
    const model = new FixedModel("matchmaker");
    const result = await classifyMode(
      model,
      "my parents want me to find a match",
    );
    expect(result).toEqual({ mode: "matchmaker", confident: true });
  });

  it("classifies a social opener", async () => {
    const model = new FixedModel("community_connector");
    const result = await classifyMode(
      model,
      "just moved to Bangalore, know any cafes?",
    );
    expect(result).toEqual({ mode: "community_connector", confident: true });
  });

  it("runs at a low temperature with no tools", async () => {
    // Classification and conversation want opposite settings.
    const model = new FixedModel("matchmaker");
    await classifyMode(model, "hi");
    expect(model.requests[0].temperature).toBe(0.1);
    expect(model.requests[0].tools).toEqual([]);
  });

  it("tolerates a chatty answer that still names a mode", async () => {
    const model = new FixedModel("I think this is matchmaker.");
    expect((await classifyMode(model, "hi")).mode).toBe("matchmaker");
  });

  it("defaults to community and flags low confidence on a blank answer", async () => {
    const model = new FixedModel("   ");
    expect(await classifyMode(model, "hi")).toEqual({
      mode: "community_connector",
      confident: false,
    });
  });

  it("defaults to community on an unrecognisable answer", async () => {
    const model = new FixedModel("bananas");
    expect(await classifyMode(model, "hi")).toEqual({
      mode: "community_connector",
      confident: false,
    });
  });

  it("falls back rather than throwing when the model errors", async () => {
    // A router failure must not drop the turn.
    const model = new FixedModel(new Error("502 from upstream"));
    expect(await classifyMode(model, "hi")).toEqual({
      mode: "community_connector",
      confident: false,
    });
  });

  it("guesses the side that asks less when unsure", async () => {
    // A wrong community guess is a mildly odd chat; a wrong matchmaker guess
    // opens with questions about marriage.
    const model = new FixedModel("");
    expect((await classifyMode(model, "hey")).mode).toBe("community_connector");
  });
});
