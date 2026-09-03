import type { ToolDefinition } from "@calebx/core";
import { isContactUnlocked, isMutual, type MatchRecord } from "@calebx/db";
import { withSpan } from "@calebx/trace";
import type { MatchmakingContext } from "../context.ts";
import { assertNoContactLeak } from "../guardrails.ts";
import { no, num, ok } from "./shared.ts";

export const listMyMatches: ToolDefinition<MatchmakingContext> = {
  name: "list_my_matches",
  description:
    "List the user's current matches and how far each has progressed. Contact details appear only if a coordinator has already shared them.",
  parameters: {
    type: "object",
    properties: { limit: { type: "number" } },
    additionalProperties: false,
  },
  async handler(context, args) {
    return withSpan("tool.list_my_matches", { kind: "tool" }, async () => {
      const matches = await context.repos.matchmaking.listMatches(
        context.principal,
        context.userIdHash,
        num(args, "limit") ?? 10,
      );

      const payload = matches.map((match: MatchRecord) => ({
        matchId: match.id,
        stage: match.stage,
        mutual: isMutual(match),
        contactUnlocked: isContactUnlocked(match),
        reason: match.reason,
      }));

      assertNoContactLeak(payload);
      if (payload.length === 0) return no("No matches yet.");
      return ok({ matches: payload });
    });
  },
};
