import type { ToolDefinition } from "@calebx/core";
import { withSpan } from "@calebx/trace";
import { categoriseInterest, cohortKey } from "../cohort.ts";
import type { CommunityContext } from "../context.ts";
import { no, ok, str } from "./shared.ts";

export const searchCommunityGroups: ToolDefinition<CommunityContext> = {
  name: "search_community_groups",
  description:
    "Find CALEBX groups that fit the user's interests and city. Only returns groups that actually exist and can be joined.",
  parameters: {
    type: "object",
    properties: {
      interest: {
        type: "string",
        description: "What they are into, in their words",
      },
      city: { type: "string" },
    },
    additionalProperties: false,
  },
  async handler(context, args) {
    return withSpan(
      "tool.search_community_groups",
      { kind: "tool" },
      async (span) => {
        const city = str(args, "city") ?? context.location?.city ?? null;
        if (!city) {
          return no(
            "No city known yet. Ask which city they are in — that one question only.",
          );
        }

        const interest = str(args, "interest");
        const categories = new Set<string>();
        if (interest) {
          const category = categoriseInterest(interest);
          if (category) categories.add(category);
        }
        if (categories.size === 0) {
          const chunks = await context.graph.listChunks(
            context.principal,
            context.userId,
            50,
          );
          for (const chunk of chunks) {
            const category = categoriseInterest(chunk.text);
            if (category) categories.add(category);
          }
        }
        if (categories.size === 0) {
          return no(
            "Nothing known about what they are into yet. Keep talking instead.",
          );
        }

        const keys = [...categories].map((category) =>
          cohortKey(category, city),
        );
        // `listReady` returns only cohorts with a real group AND an invite link.
        // A cohort without one is a suggestion the user cannot act on.
        const ready = await context.repos.cohorts.listReady(
          context.systemPrincipal,
          keys,
        );
        span.setAttributes({
          cohortCount: keys.length,
          groupCount: ready.length,
        });

        if (ready.length === 0) {
          return no(
            "No group exists for that yet. Say you will keep an eye out — do not invent one and do not promise a date.",
          );
        }

        return ok({
          groups: ready.map((cohort) => ({
            title: cohort.title,
            cohortKey: cohort.cohortKey,
            inviteLink: cohort.inviteLink,
            approximateMembers: cohort.memberHint,
          })),
        });
      },
    );
  },
};
