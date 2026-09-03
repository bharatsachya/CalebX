import type { ToolDefinition } from "@calebx/core";
import { withSpan } from "@calebx/trace";
import type { MatchmakingContext } from "../context.ts";
import { assertNoContactLeak, looksOffMode } from "../guardrails.ts";
import { no, num, ok, requireProfile, str } from "./shared.ts";

export const searchCandidates: ToolDefinition<MatchmakingContext> = {
  name: "search_matrimonial_candidates",
  description:
    "Find matrimonial candidates matching the user's stated preferences. Returns anonymous profiles — never contact details.",
  parameters: {
    type: "object",
    properties: {
      cities: { type: "array", items: { type: "string" } },
      limit: { type: "number", description: "How many to return, default 5" },
      freeText: {
        type: "string",
        description: "The soft part of what they want, in their own words",
      },
    },
    additionalProperties: false,
  },
  async handler(context, args) {
    return withSpan(
      "tool.search_matrimonial_candidates",
      { kind: "tool" },
      async (span) => {
        const candidateId = requireProfile(context);
        if (typeof candidateId !== "string") return candidateId;

        const freeText = str(args, "freeText");
        if (freeText && looksOffMode(freeText)) {
          // A matchmaker tool asked for a cafe must refuse, not run a nonsense
          // candidate search that returns confident-looking rubbish.
          return no(
            "That is a places-and-community request, not a matrimonial one. Say so warmly and mention /switch.",
          );
        }

        const prefs = await context.repos.matchmaking.getPrefs(
          context.principal,
          context.userIdHash,
        );

        const soft = freeText ?? prefs?.lookingFor ?? null;
        const [embedding] = soft
          ? await context.embed.embed([soft])
          : [undefined];

        const cities = Array.isArray(args.cities)
          ? args.cities.filter((c): c is string => typeof c === "string")
          : undefined;

        const matches = await context.repos.search.search(context.principal, {
          selfCandidateId: candidateId,
          embedding,
          minAge: prefs?.ageMin ?? undefined,
          maxAge: prefs?.ageMax ?? undefined,
          community: prefs?.communityPref ?? undefined,
          diet: prefs?.dietPref ?? undefined,
          cities,
          maritalStatuses: ["never_married", "single", "divorced", "widowed"],
          limit: num(args, "limit") ?? 5,
        });

        span.setAttributes({
          candidateCount: matches.length,
          hadVector: soft !== null,
        });

        if (matches.length === 0) {
          return no(
            "No candidates matched those preferences. Tell them plainly and ask the one question that would widen it.",
          );
        }

        assertNoContactLeak(matches, { allowNumericFields: ["age"] });
        return ok({ candidates: matches });
      },
    );
  },
};
