import type { Principal } from "@calebx/authz";
import type { ToolDefinition, ToolResult } from "@calebx/core";
import type { ReviewTasksRepository } from "@calebx/db";
import { withSpan } from "@calebx/trace";

/**
 * Escalation to a human, available in both modes.
 *
 * A factory rather than a plain tool because the two subagents have different
 * contexts; this way there is one implementation of "how escalation works" and
 * each mode supplies only the three things it needs.
 *
 * The conversation deliberately does not block on the outcome. The user is told
 * a person will look, and the agent keeps talking — a bot that goes silent
 * pending review is indistinguishable from a broken one.
 */

export interface EscalationDeps {
  principal: Principal;
  userId: string;
  review: ReviewTasksRepository;
}

export function createHumanReviewTool<Context>(
  extract: (context: Context) => EscalationDeps,
): ToolDefinition<Context> {
  return {
    name: "request_human_review",
    description:
      "Ask a human at CALEBX to look at something you should not decide alone — a complaint, a safety concern, a request you cannot fulfil, or anything about someone's contact details. The conversation continues either way.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description:
            "One sentence, in your own words, on what needs a person",
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
    async handler(context, args): Promise<ToolResult> {
      return withSpan(
        "tool.request_human_review",
        { kind: "tool" },
        async () => {
          const reason =
            typeof args.reason === "string"
              ? args.reason.trim().slice(0, 500)
              : "";
          if (reason === "")
            return { ok: false, message: "No reason was given." };

          const deps = extract(context);
          const task = await deps.review.file(deps.principal, {
            kind: "agent_escalation",
            userId: deps.userId,
            payload: { reason },
          });

          return {
            ok: true,
            data: {
              taskId: task.id,
              alreadyOpen: task.payload.reason !== reason,
            },
            message:
              "Tell the user a person at CALEBX will look at this, then carry on with the conversation. Do not promise when.",
          };
        },
      );
    },
  };
}
