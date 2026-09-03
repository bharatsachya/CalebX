import { runTurn, type AgentDeps, type TurnOutcome } from "@calebx/agent";
import { copy } from "@calebx/channel";
import type { AgentJob, DispatchJob, IngestJob } from "./payloads.ts";

/**
 * One inbound message, turned into outbound work.
 *
 * This is the single place the agent's structured outcome becomes user-facing
 * text and background jobs. Both the inline path (a bot running everything in
 * process) and the queued path (an `agent-execution` worker) call it, so the two
 * cannot drift — the inline mode is a deployment choice, not a second
 * implementation.
 *
 * It returns work rather than performing it, which is what makes "does a
 * `/switch` into an unconsented mode ask before switching?" a unit test.
 */

export type OutboundKind =
  "reply" | "mode_consent" | "switched" | "already_active";

export interface Outbound {
  kind: OutboundKind;
  text: string;
  /** Set on `mode_consent`, so the transport can attach the right buttons. */
  mode?: "matchmaker" | "community_connector";
}

export interface PipelineResult {
  outcome: TurnOutcome;
  outbound: Outbound[];
  /** Undefined when the turn produced nothing worth extracting from. */
  ingest?: IngestJob;
}

export async function handleAgentJob(
  deps: AgentDeps,
  job: AgentJob,
): Promise<PipelineResult> {
  const outcome = await runTurn(deps, {
    userId: job.userId,
    text: job.text,
    channel: job.channel,
    command: job.command,
  });

  switch (outcome.kind) {
    case "reply":
      return {
        outcome,
        outbound: [{ kind: "reply", text: outcome.text }],
        ingest: {
          userId: job.userId,
          mode: outcome.mode,
          text: job.text,
          reply: outcome.text,
          traceId: job.traceId,
        },
      };

    case "needs_consent":
      // The switch has not happened. Asking first is the point: the two modes
      // collect different data, so the grant made at /start cannot cover both.
      return {
        outcome,
        outbound: [
          {
            kind: "mode_consent",
            text: copy.modeConsentRequest(outcome.mode),
            mode: outcome.mode,
          },
        ],
      };

    case "switched":
      return {
        outcome,
        outbound: [
          { kind: "switched", text: copy.switchedMessage(outcome.mode) },
        ],
      };

    case "already_active":
      return {
        outcome,
        outbound: [
          {
            kind: "already_active",
            text: copy.alreadyInModeMessage(outcome.mode),
          },
        ],
      };
  }
}

/** Turns outbound text into dispatch jobs for this chat. */
export function toDispatchJobs(
  job: AgentJob,
  outbound: Outbound[],
  channel: DispatchJob["channel"],
): DispatchJob[] {
  return outbound.map((message) => ({
    chatId: job.chatId,
    text: message.text,
    channel,
    isGroup: job.isGroup,
    traceId: job.traceId,
  }));
}
