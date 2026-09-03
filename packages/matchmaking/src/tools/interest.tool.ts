import type { ToolDefinition } from "@calebx/core";
import { isMutual } from "@calebx/db";
import { withSpan } from "@calebx/trace";
import type { MatchmakingContext } from "../context.ts";
import { no, ok, requireProfile, str } from "./shared.ts";

export const expressInterest: ToolDefinition<MatchmakingContext> = {
  name: "express_match_interest",
  description:
    "Record that the user is interested in a candidate they were shown. If the other side already said yes, this files the match for a human coordinator to review.",
  parameters: {
    type: "object",
    properties: {
      candidateId: {
        type: "string",
        description:
          "The id of a candidate returned by search_matrimonial_candidates",
      },
    },
    required: ["candidateId"],
    additionalProperties: false,
  },
  async handler(context, args) {
    return withSpan(
      "tool.express_match_interest",
      { kind: "tool" },
      async () => {
        const selfId = requireProfile(context);
        if (typeof selfId !== "string") return selfId;

        const otherId = str(args, "candidateId");
        if (!otherId) return no("No candidate id was supplied.");
        if (otherId === selfId) return no("That is the user's own profile.");

        // The pair record belongs to neither user, so it is written with the
        // pair-writer principal — never with the user's own.
        const match = await context.repos.matchmaking.recordSuggestion(
          context.pairWriter,
          selfId,
          otherId,
          null,
          null,
        );
        const updated = await context.repos.matchmaking.setStatus(
          context.pairWriter,
          match,
          selfId,
          "interested",
        );

        if (!isMutual(updated)) {
          return ok(
            { stage: updated.stage, mutual: false },
            "Interest recorded. The other side has not answered — do not imply that they have.",
          );
        }

        await context.repos.review.file(context.principal, {
          kind: "mutual_interest",
          userId: context.userId,
          payload: { matchId: updated.id },
        });

        return ok(
          { stage: updated.stage, mutual: true, contactShared: false },
          "Both sides are interested. A coordinator will review before any contact details are exchanged — say that, and do not promise a timeline.",
        );
      },
    );
  },
};
