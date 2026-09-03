/**
 * A CALEBX user, identified by a channel-namespaced id ("tg:123", "wa:4477...").
 *
 * The domain deliberately knows nothing about which chat platform a user came
 * from beyond that namespace — adding a platform must not change anything here.
 */
export interface User {
  id?: string;
  userId: string;
}

export interface IUserRepository {
  createUser(userId: string): Promise<User>;
  getUser(userId: string): Promise<User | null>;
}

/**
 * The two products a user can be talking to. A user is in exactly one mode at a
 * time, and the modes are hard boundaries — a matchmaker turn must not be able
 * to read community persona data, or vice versa. That boundary is enforced in
 * `@calebx/authz`, not by convention.
 */
export type AgentMode = "matchmaker" | "community_connector";

export const AGENT_MODES: readonly AgentMode[] = [
  "matchmaker",
  "community_connector",
] as const;

export function isAgentMode(value: unknown): value is AgentMode {
  return (
    typeof value === "string" &&
    (AGENT_MODES as readonly string[]).includes(value)
  );
}

/**
 * A user's mode state.
 *
 * `activeMode` is which subagent handles their turns now; `enrolledModes` is the
 * set of modes they have both a profile and a consent grant for. Assignment is
 * not one-way — `/switch` moves `activeMode` — but entering a mode for the first
 * time requires that mode's own consent, because the two modes collect
 * genuinely different data.
 */
export interface UserModeState {
  userId: string;
  activeMode: AgentMode | null;
  enrolledModes: AgentMode[];
}

/**
 * The tool contract, shared by every subagent package.
 *
 * It lives in `core` because both domain packages define tools and the agent
 * runner executes them — putting it in the agent package would make the domain
 * depend on the orchestrator, which is backwards.
 *
 * `parameters` is a JSON Schema object because that is what the model's
 * function-calling API takes; keeping it as data rather than a validator lets
 * the same definition be sent to the model and checked locally.
 */
export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * What a tool hands back to the runner.
 *
 * `ok: false` is an expected outcome, not an exception: "no candidates matched"
 * and "that needs your confirmation first" are both normal turns, and the model
 * needs to see them as results it can narrate rather than as errors.
 */
export interface ToolResult {
  ok: boolean;
  /** Structured payload for the model to narrate. Never raw PII. */
  data?: unknown;
  /** Short explanation, in the model's voice-neutral register. */
  message?: string;
  /** Set when the tool wants explicit user confirmation before acting. */
  needsConfirmation?: boolean;
}

export interface ToolDefinition<Context> {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  handler(context: Context, args: Record<string, unknown>): Promise<ToolResult>;
}
