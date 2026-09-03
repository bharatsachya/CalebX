import type { AgentMode } from "@calebx/core";
import { withTrace } from "@calebx/trace";
import type { ChatMessage } from "./chat.ts";
import { looksLikeRecommendationRequest } from "./intent.ts";
import { mem0Memory } from "./memory.ts";
import { parseSwitchTarget, resolveMode, resolveSwitch } from "./modes.ts";
import { RECOMMENDATION_TOOLS, runRecommendation } from "./recommendation.ts";
import { finalizeReply } from "./reply.ts";
import { classifyMode } from "./router.ts";
import {
  buildCommunityBundle,
  buildMatchmakerBundle,
  principalForTurn,
  type AgentDeps,
} from "./runtime.ts";
import { runToolLoop, type ToolInvocation } from "./tool-runner.ts";

/**
 * One user turn, end to end.
 *
 * Order: mode state → router if unassigned → subagent tool loop → reply. The
 * memory read happens inside the mode, because the mode is part of the mem0 key
 * and reading the wrong key would surface the other product's memories.
 *
 * Extraction and persona writes are deliberately *not* here: they run in the
 * ingest job after this reply has been dispatched, so nobody waits on an
 * embedding pass to be answered.
 */

export type TurnOutcome =
  | {
      kind: "reply";
      text: string;
      mode: AgentMode;
      invocations: ToolInvocation[];
    }
  /** `/switch` into a mode the user has not consented to yet. */
  | { kind: "needs_consent"; mode: AgentMode }
  | { kind: "already_active"; mode: AgentMode }
  /** Mode changed; the confirmation copy belongs to the channel, not here. */
  | { kind: "switched"; mode: AgentMode };

export interface TurnInput {
  userId: string;
  text: string;
  /** Human-readable platform name, woven into the persona prompt. */
  channel: string;
  /** Parsed by the caller so command handling stays in the transport layer. */
  command?: { name: string; argument?: string };
}

const FALLBACK = "I'm here — what's on your mind?";

function buildSystemPrompt(
  persona: string,
  channel: string,
  memories: string[],
): string {
  const recalled =
    memories.length > 0
      ? `\n\nWhat you already know about this person (most relevant first). Treat it as
context, not as something to recite:\n${memories.map((m) => `- ${m}`).join("\n")}`
      : "\n\nYou know nothing about this person yet. Ask one thing.";

  return `${persona}\n\nYou are talking to them on ${channel}.${recalled}`;
}

async function runSubagentTurn<Context>(
  deps: AgentDeps,
  bundle: {
    mode: AgentMode;
    persona: string;
    tools: readonly Parameters<
      typeof runToolLoop<Context>
    >[0]["tools"][number][];
    context: Context;
  },
  input: TurnInput,
): Promise<TurnOutcome> {
  const memory = deps.memory ?? mem0Memory;
  const memories = await memory.search(input.userId, bundle.mode, input.text);
  const system = buildSystemPrompt(bundle.persona, input.channel, memories);

  // A plain-language ask runs the deterministic retrieval path rather than
  // hoping the model remembers to call the right tool (assumptions.md A10).
  const wantsRecommendation =
    input.command?.name === "recommendation" ||
    looksLikeRecommendationRequest(input.text);

  if (wantsRecommendation) {
    const outcome = await runRecommendation({
      model: deps.model,
      persona: system,
      tools: bundle.tools,
      toolNames: RECOMMENDATION_TOOLS[bundle.mode],
      context: bundle.context,
    });
    if (outcome.narration !== null) {
      return {
        kind: "reply",
        text: finalizeReply(outcome.narration, FALLBACK),
        mode: bundle.mode,
        invocations: outcome.gathered.map((entry) => ({
          name: entry.tool,
          ok: entry.result.ok,
        })),
      };
    }
    // Nothing found. Fall through to the conversation rather than announcing a
    // failure — the subagent's tools will report the same emptiness in words.
  }

  const messages: ChatMessage[] = [{ role: "user", content: input.text }];
  const loop = await runToolLoop({
    model: deps.model,
    system,
    messages,
    tools: bundle.tools,
    context: bundle.context,
  });

  return {
    kind: "reply",
    text: finalizeReply(loop.content, FALLBACK),
    mode: bundle.mode,
    invocations: loop.invocations,
  };
}

async function runInMode(
  deps: AgentDeps,
  mode: AgentMode,
  enrolledModes: readonly AgentMode[],
  input: TurnInput,
): Promise<TurnOutcome> {
  const principal = principalForTurn(deps, input.userId, mode, enrolledModes);

  if (mode === "matchmaker") {
    const bundle = await buildMatchmakerBundle(deps, input.userId, principal);
    return runSubagentTurn(deps, bundle, input);
  }
  const bundle = await buildCommunityBundle(deps, input.userId, principal);
  return runSubagentTurn(deps, bundle, input);
}

export async function runTurn(
  deps: AgentDeps,
  input: TurnInput,
): Promise<TurnOutcome> {
  return withTrace(
    "agent.turn",
    { userId: input.userId },
    {
      attributes: {
        channel: input.channel,
        "text.length": input.text.length,
        command: input.command?.name ?? null,
      },
    },
    async (span) => {
      // The mode row is read with a principal that has no mode yet, so it is
      // resolved as mode-agnostic — asking "which mode?" cannot itself require
      // knowing the mode.
      const bootstrap = principalForTurn(
        deps,
        input.userId,
        "community_connector",
        ["community_connector", "matchmaker"],
      );
      const state = await deps.agentUsers.ensure(bootstrap, input.userId);

      if (input.command?.name === "switch") {
        const decision = resolveSwitch(
          state,
          parseSwitchTarget(input.command.argument),
        );
        if (decision.kind === "needs_consent") {
          span.setAttributes({ outcome: "needs_consent", mode: decision.mode });
          return { kind: "needs_consent", mode: decision.mode };
        }
        if (decision.kind === "already_active") {
          return { kind: "already_active", mode: decision.mode };
        }
        if (decision.kind === "run") {
          await deps.agentUsers.setActiveMode(
            bootstrap,
            input.userId,
            decision.mode,
          );
          span.setAttributes({ outcome: "switched", mode: decision.mode });
          return { kind: "switched", mode: decision.mode };
        }
        // No mode assigned yet: fall through and let the router decide.
      }

      let decision = resolveMode(state);
      let enrolled = state.enrolledModes;

      if (decision.kind === "needs_router") {
        const { mode } = await classifyMode(deps.model, input.text);
        // The first mode is covered by the consent granted at /start; only a
        // later /switch into the second mode needs its own grant.
        await deps.agentUsers.grantConsent(bootstrap, input.userId, mode);
        const updated = await deps.agentUsers.enroll(
          bootstrap,
          input.userId,
          mode,
        );
        await deps.agentUsers.setActiveMode(bootstrap, input.userId, mode);
        decision = { kind: "run", mode };
        enrolled = updated.enrolledModes.includes(mode)
          ? updated.enrolledModes
          : [...updated.enrolledModes, mode];
      }

      if (decision.kind !== "run") {
        // Unreachable in practice; a decision that is not runnable here would
        // otherwise fall through to an empty reply.
        return {
          kind: "reply",
          text: FALLBACK,
          mode: "community_connector",
          invocations: [],
        };
      }

      span.setAttributes({ mode: decision.mode });
      const outcome = await runInMode(deps, decision.mode, enrolled, input);

      if (outcome.kind === "reply") {
        // Best-effort by contract: a failed memory write must not swallow a
        // reply the user is waiting for.
        await (deps.memory ?? mem0Memory).add(
          input.userId,
          decision.mode,
          input.text,
          outcome.text,
        );
      }
      return outcome;
    },
  );
}
