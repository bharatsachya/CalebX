import type { ToolDefinition } from "@calebx/core";
import { withSpan } from "@calebx/trace";
import type { MatchmakingContext } from "../context.ts";
import { assertNoContactLeak } from "../guardrails.ts";
import { ok } from "./shared.ts";

export const getMyProfile: ToolDefinition<MatchmakingContext> = {
  name: "get_my_matrimonial_profile",
  description:
    "Fetch the current user's own matrimonial profile and stated partner preferences. Use this before searching so the search reflects what they actually said.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async handler(context) {
    return withSpan(
      "tool.get_my_matrimonial_profile",
      { kind: "tool" },
      async () => {
        const prefs = await context.repos.matchmaking.getPrefs(
          context.principal,
          context.userIdHash,
        );
        const payload = {
          hasProfile: context.candidateId !== null,
          preferences: prefs,
        };
        // Their own record, but scanned anyway: `lookingFor` is free text the user
        // typed, and people do type their own number into free text.
        assertNoContactLeak(payload, {
          allowNumericFields: ["ageMin", "ageMax", "incomeMin"],
        });
        return ok(
          payload,
          prefs
            ? undefined
            : "No preferences recorded yet — ask about one thing at a time.",
        );
      },
    );
  },
};
