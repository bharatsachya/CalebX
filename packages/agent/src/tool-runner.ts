import type { ToolDefinition, ToolResult } from "@calebx/core";
import { ForbiddenError } from "@calebx/errors";
import { withSpan } from "@calebx/trace";
import type { ChatMessage, ChatModel, ToolCall } from "./chat.ts";
import { toToolSpecs } from "./chat.ts";

/**
 * The function-calling loop.
 *
 * Bounded at four rounds. Not as a cost control — as a correctness one: a model
 * that has called `search` three times with slightly different arguments is not
 * converging, it is flailing, and the user is sitting in front of a typing
 * indicator while it does. When the budget runs out the loop asks once more with
 * tools withheld, which forces prose out of whatever it has.
 */

export const MAX_TOOL_ITERATIONS = 4;

export interface ToolInvocation {
  name: string;
  ok: boolean;
  /** Present when the tool asked for user confirmation instead of acting. */
  needsConfirmation?: boolean;
  durationMs?: number;
}

export interface ToolLoopResult {
  content: string;
  invocations: ToolInvocation[];
  iterations: number;
  /** True when the budget ran out before the model produced prose. */
  exhausted: boolean;
}

export interface ToolLoopOptions<Context> {
  model: ChatModel;
  system: string;
  messages: ChatMessage[];
  tools: readonly ToolDefinition<Context>[];
  context: Context;
  temperature?: number;
  maxIterations?: number;
}

/**
 * A denial must not be narrated back to the user as an explanation.
 *
 * `ForbiddenError`'s reason is deliberately non-identifying, but "not owner" in
 * a chat message still tells the user something about what exists. The model
 * gets a flat refusal and no detail to embellish.
 */
function describeToolFailure(error: unknown): string {
  if (error instanceof ForbiddenError) {
    return "That is not available. Do not speculate about why.";
  }
  return "That did not work. Say so plainly and carry on — do not retry it.";
}

function parseArguments(raw: string): Record<string, unknown> | null {
  if (raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toolMessage(call: ToolCall, result: ToolResult): ChatMessage {
  return {
    role: "tool",
    toolCallId: call.id,
    name: call.name,
    content: JSON.stringify({
      ok: result.ok,
      needsConfirmation: result.needsConfirmation ?? false,
      message: result.message,
      data: result.data,
    }),
  };
}

export async function runToolLoop<Context>(
  options: ToolLoopOptions<Context>,
): Promise<ToolLoopResult> {
  const {
    model,
    system,
    tools,
    context,
    temperature = 0.7,
    maxIterations = MAX_TOOL_ITERATIONS,
  } = options;

  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const specs = toToolSpecs(tools);
  const messages: ChatMessage[] = [...options.messages];
  const invocations: ToolInvocation[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const completion = await withSpan(
      "llm.turn",
      { kind: "llm", attributes: { iteration } },
      () => model.complete({ system, messages, tools: specs, temperature }),
    );

    if (completion.toolCalls.length === 0) {
      return {
        content: completion.content,
        invocations,
        iterations: iteration,
        exhausted: false,
      };
    }

    messages.push({
      role: "assistant",
      content: completion.content,
      toolCalls: completion.toolCalls,
    });

    for (const call of completion.toolCalls) {
      const tool = byName.get(call.name);
      if (!tool) {
        // Hallucinated tool names are a normal model failure, not an exception.
        // Telling it plainly beats crashing the turn.
        invocations.push({ name: call.name, ok: false });
        messages.push(
          toolMessage(call, {
            ok: false,
            message: `There is no tool called "${call.name}".`,
          }),
        );
        continue;
      }

      const args = parseArguments(call.arguments);
      if (args === null) {
        invocations.push({ name: call.name, ok: false });
        messages.push(
          toolMessage(call, {
            ok: false,
            message: "Those arguments were not valid JSON. Try once, simpler.",
          }),
        );
        continue;
      }

      const startedAt = Date.now();
      try {
        const result = await tool.handler(context, args);
        invocations.push({
          name: call.name,
          ok: result.ok,
          needsConfirmation: result.needsConfirmation,
          durationMs: Date.now() - startedAt,
        });
        messages.push(toolMessage(call, result));
      } catch (error) {
        invocations.push({
          name: call.name,
          ok: false,
          durationMs: Date.now() - startedAt,
        });
        messages.push(
          toolMessage(call, { ok: false, message: describeToolFailure(error) }),
        );
      }
    }
  }

  // Budget exhausted. One more round with no tools: the model must answer with
  // what it already has rather than the user getting silence.
  const forced = await withSpan(
    "llm.turn.forced",
    { kind: "llm", attributes: { iteration: maxIterations + 1 } },
    () =>
      model.complete({
        system,
        messages: [
          ...messages,
          {
            role: "user",
            content:
              "Reply now in your own words using only what you already know. Do not use tools.",
          },
        ],
        tools: [],
        temperature,
      }),
  );

  return {
    content: forced.content,
    invocations,
    iterations: maxIterations,
    exhausted: true,
  };
}
