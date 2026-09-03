/// <reference types="bun" />
import { beforeEach, describe, expect, it } from "bun:test";
import { ForbiddenError } from "@calebx/errors";
import type { ToolDefinition } from "@calebx/core";
import { MAX_TOOL_ITERATIONS, runToolLoop } from "./tool-runner.ts";
import type { ChatCompletion, ChatModel, ChatRequest } from "./chat.ts";

interface Ctx {
  calls: string[];
}

/** Replays a scripted sequence of completions and records what it was asked. */
class ScriptedModel implements ChatModel {
  readonly requests: ChatRequest[] = [];
  private index = 0;

  constructor(private readonly script: ChatCompletion[]) {}

  async complete(request: ChatRequest): Promise<ChatCompletion> {
    this.requests.push({ ...request, messages: [...request.messages] });
    const next = this.script[this.index];
    if (this.index < this.script.length - 1) this.index += 1;
    return next ?? { content: "", toolCalls: [] };
  }
}

const prose = (content: string): ChatCompletion => ({ content, toolCalls: [] });
const callTool = (name: string, args = "{}"): ChatCompletion => ({
  content: "",
  toolCalls: [{ id: `call-${name}`, name, arguments: args }],
});

const echo: ToolDefinition<Ctx> = {
  name: "echo",
  description: "Echoes its argument back for testing.",
  parameters: { type: "object", properties: { value: { type: "string" } } },
  async handler(context, args) {
    context.calls.push(`echo:${String(args.value ?? "")}`);
    return { ok: true, data: { value: args.value } };
  },
};

const failing: ToolDefinition<Ctx> = {
  name: "failing",
  description: "Always reports a normal failure.",
  parameters: { type: "object", properties: {} },
  async handler() {
    return { ok: false, message: "nothing matched" };
  },
};

const throwing: ToolDefinition<Ctx> = {
  name: "throwing",
  description: "Throws an authorization error.",
  parameters: { type: "object", properties: {} },
  async handler() {
    throw new ForbiddenError("not owner", "read:candidate");
  },
};

const exploding: ToolDefinition<Ctx> = {
  name: "exploding",
  description: "Throws an unexpected error.",
  parameters: { type: "object", properties: {} },
  async handler() {
    throw new Error("connection reset");
  },
};

const TOOLS = [echo, failing, throwing, exploding];

let context: Ctx;

beforeEach(() => {
  context = { calls: [] };
});

describe("happy path", () => {
  it("returns prose when the model calls no tool", async () => {
    const model = new ScriptedModel([prose("Tell me more.")]);
    const result = await runToolLoop({
      model,
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS,
      context,
    });
    expect(result.content).toBe("Tell me more.");
    expect(result.iterations).toBe(1);
    expect(result.invocations).toEqual([]);
    expect(result.exhausted).toBe(false);
  });

  it("runs a tool, then returns the follow-up prose", async () => {
    const model = new ScriptedModel([
      callTool("echo", '{"value":"hello"}'),
      prose("Here you go."),
    ]);
    const result = await runToolLoop({
      model,
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS,
      context,
    });
    expect(context.calls).toEqual(["echo:hello"]);
    expect(result.content).toBe("Here you go.");
    expect(result.invocations).toEqual([
      expect.objectContaining({ name: "echo", ok: true }),
    ]);
    expect(result.iterations).toBe(2);
  });

  it("feeds the tool result back to the model", async () => {
    const model = new ScriptedModel([
      callTool("echo", '{"value":"x"}'),
      prose("done"),
    ]);
    await runToolLoop({
      model,
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: TOOLS,
      context,
    });
    const secondRequest = model.requests[1];
    const toolReply = secondRequest.messages.find((m) => m.role === "tool");
    expect(toolReply?.toolCallId).toBe("call-echo");
    expect(String(toolReply?.content)).toContain('"ok":true');
  });

  it("passes tool specs derived from the definitions", async () => {
    const model = new ScriptedModel([prose("hi")]);
    await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
    });
    expect(model.requests[0].tools.map((t) => t.name)).toEqual([
      "echo",
      "failing",
      "throwing",
      "exploding",
    ]);
  });

  it("handles several tool calls in one round", async () => {
    const model = new ScriptedModel([
      {
        content: "",
        toolCalls: [
          { id: "1", name: "echo", arguments: '{"value":"a"}' },
          { id: "2", name: "echo", arguments: '{"value":"b"}' },
        ],
      },
      prose("both done"),
    ]);
    const result = await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
    });
    expect(context.calls).toEqual(["echo:a", "echo:b"]);
    expect(result.invocations).toHaveLength(2);
  });
});

describe("model misbehaviour", () => {
  it("tells the model plainly when it invents a tool name", async () => {
    const model = new ScriptedModel([callTool("teleport"), prose("ok")]);
    const result = await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
    });
    expect(result.invocations[0]).toEqual(
      expect.objectContaining({ name: "teleport", ok: false }),
    );
    const toolReply = model.requests[1].messages.find((m) => m.role === "tool");
    expect(String(toolReply?.content)).toContain("no tool called");
  });

  it("rejects malformed JSON arguments without crashing the turn", async () => {
    const model = new ScriptedModel([
      callTool("echo", "{value: hello"),
      prose("recovered"),
    ]);
    const result = await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
    });
    expect(context.calls).toEqual([]);
    expect(result.content).toBe("recovered");
    const toolReply = model.requests[1].messages.find((m) => m.role === "tool");
    expect(String(toolReply?.content)).toContain("not valid JSON");
  });

  it("rejects a JSON array of arguments", async () => {
    const model = new ScriptedModel([callTool("echo", "[1,2]"), prose("ok")]);
    await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
    });
    expect(context.calls).toEqual([]);
  });

  it("treats empty arguments as an empty object", async () => {
    const model = new ScriptedModel([callTool("echo", ""), prose("ok")]);
    await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
    });
    expect(context.calls).toEqual(["echo:"]);
  });
});

describe("tool failures", () => {
  it("passes an ordinary tool failure through as a result", async () => {
    const model = new ScriptedModel([
      callTool("failing"),
      prose("nothing found"),
    ]);
    const result = await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
    });
    expect(result.invocations[0].ok).toBe(false);
    const toolReply = model.requests[1].messages.find((m) => m.role === "tool");
    expect(String(toolReply?.content)).toContain("nothing matched");
  });

  it("does not hand an authorization reason to the model", async () => {
    // "not owner" in a chat message still tells the user what exists.
    const model = new ScriptedModel([callTool("throwing"), prose("ok")]);
    await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
    });
    const toolReply = model.requests[1].messages.find((m) => m.role === "tool");
    expect(String(toolReply?.content)).not.toContain("not owner");
    expect(String(toolReply?.content)).toContain("not available");
  });

  it("survives an unexpected exception from a tool", async () => {
    const model = new ScriptedModel([
      callTool("exploding"),
      prose("carrying on"),
    ]);
    const result = await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
    });
    expect(result.content).toBe("carrying on");
    expect(result.invocations[0].ok).toBe(false);
  });

  it("does not leak an internal error message to the model", async () => {
    const model = new ScriptedModel([callTool("exploding"), prose("ok")]);
    await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
    });
    const toolReply = model.requests[1].messages.find((m) => m.role === "tool");
    expect(String(toolReply?.content)).not.toContain("connection reset");
  });

  it("records that a tool asked for confirmation", async () => {
    const confirming: ToolDefinition<Ctx> = {
      name: "confirming",
      description: "Wants confirmation first.",
      parameters: { type: "object", properties: {} },
      async handler() {
        return { ok: false, needsConfirmation: true, message: "confirm?" };
      },
    };
    const model = new ScriptedModel([
      callTool("confirming"),
      prose("Is that right?"),
    ]);
    const result = await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: [confirming],
      context,
    });
    expect(result.invocations[0].needsConfirmation).toBe(true);
  });
});

describe("iteration budget", () => {
  it("stops after the maximum and forces a prose reply", async () => {
    // A model calling the same tool four times is flailing, not converging.
    const model = new ScriptedModel([callTool("echo", '{"value":"loop"}')]);
    const result = await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
    });
    expect(result.exhausted).toBe(true);
    expect(result.iterations).toBe(MAX_TOOL_ITERATIONS);
    expect(context.calls).toHaveLength(MAX_TOOL_ITERATIONS);
  });

  it("withholds tools on the forced round", async () => {
    const model = new ScriptedModel([callTool("echo")]);
    await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
    });
    expect(model.requests.at(-1)?.tools).toEqual([]);
  });

  it("honours a lower custom budget", async () => {
    const model = new ScriptedModel([callTool("echo")]);
    const result = await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
      maxIterations: 2,
    });
    expect(result.iterations).toBe(2);
    expect(context.calls).toHaveLength(2);
  });

  it("passes the temperature through", async () => {
    const model = new ScriptedModel([prose("hi")]);
    await runToolLoop({
      model,
      system: "s",
      messages: [],
      tools: TOOLS,
      context,
      temperature: 0.2,
    });
    expect(model.requests[0].temperature).toBe(0.2);
  });
});
