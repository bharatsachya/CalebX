import type { ToolDefinition } from "@calebx/core";

/**
 * The model interface the tool loop runs against.
 *
 * Declared here rather than importing the OpenAI SDK's types so the loop can be
 * driven by a scripted fake in tests. Every branch of the loop — unknown tool,
 * malformed arguments, iteration exhaustion — is otherwise only reachable by
 * getting a real model to misbehave on demand.
 */

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string, exactly as the model produced it. */
  arguments: string;
}

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  /** Set on `role: "tool"` messages, matching the call being answered. */
  toolCallId?: string;
  name?: string;
}

export interface ChatCompletion {
  content: string;
  toolCalls: ToolCall[];
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  /** Empty means "answer in prose, no tools available this round". */
  tools: ToolSpec[];
  temperature: number;
}

export interface ChatModel {
  complete(request: ChatRequest): Promise<ChatCompletion>;
}

/** The wire shape of a tool, as the function-calling API wants it. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export function toToolSpecs<Context>(
  tools: readonly ToolDefinition<Context>[],
): ToolSpec[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as unknown as Record<string, unknown>,
  }));
}
