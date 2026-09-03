import type { ToolDefinition } from "@calebx/core";
import { withSpan } from "@calebx/trace";
import type { MatchmakingContext } from "../context.ts";
import { assertNoContactLeak } from "../guardrails.ts";
import { no, num, ok, requireProfile, str } from "./shared.ts";

export const updatePartnerPreferences: ToolDefinition<MatchmakingContext> = {
  name: "update_partner_preferences",
  description:
    "Save one or more partner preferences the user has explicitly stated. Pass confirmed=false first to show the user what you understood; only pass confirmed=true after they agree.",
  parameters: {
    type: "object",
    properties: {
      ageMin: { type: "number", description: "Youngest acceptable age" },
      ageMax: { type: "number", description: "Oldest acceptable age" },
      communityPref: { type: "string" },
      educationPref: { type: "string" },
      dietPref: { type: "string" },
      lookingFor: {
        type: "string",
        description: "The user's own words about temperament or lifestyle",
      },
      prefTags: { type: "array", items: { type: "string" } },
      confirmed: {
        type: "boolean",
        description: "True only after the user has agreed to this exact change",
      },
    },
    additionalProperties: false,
  },
  async handler(context, args) {
    return withSpan(
      "tool.update_partner_preferences",
      { kind: "tool" },
      async () => {
        const candidateId = requireProfile(context);
        if (typeof candidateId !== "string") return candidateId;

        const patch = {
          ageMin: num(args, "ageMin"),
          ageMax: num(args, "ageMax"),
          communityPref: str(args, "communityPref"),
          educationPref: str(args, "educationPref"),
          dietPref: str(args, "dietPref"),
          lookingFor: str(args, "lookingFor"),
          prefTags: Array.isArray(args.prefTags)
            ? args.prefTags
                .filter((t): t is string => typeof t === "string")
                .slice(0, 5)
            : undefined,
        };

        const supplied = Object.entries(patch).filter(
          ([, value]) => value !== undefined,
        );
        if (supplied.length === 0) {
          return no("Nothing to save — no preference was stated in this turn.");
        }

        // The user's rule: never state a change as done before they agree to it.
        // The tool enforces it rather than trusting the prompt, because a model
        // that forgets produces a silently rewritten profile.
        if (args.confirmed !== true) {
          return {
            ok: false,
            needsConfirmation: true,
            message:
              "Read this back to the user in your own words and ask if it is right. Call again with confirmed=true only if they agree.",
            data: { proposed: Object.fromEntries(supplied) },
          };
        }

        const saved = await context.repos.matchmaking.updatePrefs(
          context.principal,
          context.userIdHash,
          candidateId,
          patch,
        );
        assertNoContactLeak(saved, {
          allowNumericFields: ["ageMin", "ageMax", "incomeMin"],
        });
        return ok(saved, "Saved.");
      },
    );
  },
};
