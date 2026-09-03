import {
  AGENT_MODES,
  isAgentMode,
  type AgentMode,
  type UserModeState,
} from "@calebx/core";

/**
 * Mode resolution, as pure functions.
 *
 * Everything here is decided from a `UserModeState` and, at most, a
 * classification string. No I/O, no LLM call, no clock — so every branch of
 * "which subagent handles this turn" is directly testable, which matters because
 * a wrong answer here means a turn reads the wrong half of someone's data.
 */

export type ModeDecision =
  /** No mode yet: classify the message and assign one. */
  | { kind: "needs_router" }
  /** Mode is settled; run this subagent. */
  | { kind: "run"; mode: AgentMode }
  /** The user asked to switch and needs that mode's consent first. */
  | { kind: "needs_consent"; mode: AgentMode }
  /** The user asked to switch to the mode they are already in. */
  | { kind: "already_active"; mode: AgentMode };

export function resolveMode(state: UserModeState | null): ModeDecision {
  if (!state || state.activeMode === null) return { kind: "needs_router" };
  return { kind: "run", mode: state.activeMode };
}

/**
 * What `/switch` should do.
 *
 * Switching is allowed in both directions — the earlier design's one-way lock
 * was replaced because a misclassified first message would otherwise strand a
 * user in the wrong product forever. What is *not* waived is consent: entering
 * a mode for the first time needs that mode's own grant, because the two
 * collect genuinely different data.
 */
export function resolveSwitch(
  state: UserModeState | null,
  target?: AgentMode,
): ModeDecision {
  const current = state?.activeMode ?? null;
  const resolved = target ?? otherMode(current);
  if (resolved === null) return { kind: "needs_router" };
  if (resolved === current) return { kind: "already_active", mode: resolved };
  if (!(state?.enrolledModes ?? []).includes(resolved)) {
    return { kind: "needs_consent", mode: resolved };
  }
  return { kind: "run", mode: resolved };
}

/** The mode a user is not in. Null when they are in neither. */
export function otherMode(mode: AgentMode | null): AgentMode | null {
  if (mode === null) return null;
  return mode === "matchmaker" ? "community_connector" : "matchmaker";
}

/**
 * Parses a `/switch` argument.
 *
 * Accepts the canonical names plus the words people actually type. Returns
 * undefined for anything unrecognised, which means "switch to the other one"
 * rather than an error — with two modes, that is almost always what was meant.
 */
export function parseSwitchTarget(
  argument: string | undefined,
): AgentMode | undefined {
  if (!argument) return undefined;
  const normalised = argument
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (isAgentMode(normalised)) return normalised;
  const aliases: Record<string, AgentMode> = {
    matrimonial: "matchmaker",
    marriage: "matchmaker",
    match: "matchmaker",
    matches: "matchmaker",
    shaadi: "matchmaker",
    community: "community_connector",
    social: "community_connector",
    friends: "community_connector",
    places: "community_connector",
    groups: "community_connector",
  };
  return aliases[normalised];
}

/**
 * Maps the router's raw classification onto a mode.
 *
 * Defaults to the community connector when the model is unsure. That default is
 * deliberate: the community side collects less and asks less, so a wrong guess
 * there is a mildly odd conversation, while a wrong guess into matchmaker mode
 * opens with questions about marriage.
 */
export function modeFromClassification(raw: string): AgentMode {
  const cleaned = raw.trim().toLowerCase();
  if (cleaned.includes("matchmaker") || cleaned.includes("matrimonial")) {
    return "matchmaker";
  }
  return "community_connector";
}

export const MODE_LABELS: Readonly<Record<AgentMode, string>> = {
  matchmaker: "matchmaking",
  community_connector: "places & people",
};

export { AGENT_MODES };
