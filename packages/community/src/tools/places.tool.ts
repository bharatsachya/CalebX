import type { ToolDefinition } from "@calebx/core";
import { withSpan } from "@calebx/trace";
import { categoriseInterest } from "../cohort.ts";
import type { CommunityContext } from "../context.ts";
import { no, num, ok, str } from "./shared.ts";

export const getCuratedPlaces: ToolDefinition<CommunityContext> = {
  name: "get_curated_places",
  description:
    "Find places near the user that fit how they like to spend time. Needs their location; ask for it if unknown.",
  parameters: {
    type: "object",
    properties: {
      category: {
        type: "string",
        description:
          "cafe | coworking | fitness | outdoors | music | books | food",
      },
      radiusMeters: { type: "number" },
      limit: { type: "number" },
    },
    additionalProperties: false,
  },
  async handler(context, args) {
    return withSpan(
      "tool.get_curated_places",
      { kind: "tool" },
      async (span) => {
        if (!context.location) {
          return no(
            "Their location is not known. Ask which neighbourhood they are in — that one question only.",
          );
        }

        let category = str(args, "category");
        if (!category) {
          const chunks = await context.graph.listChunks(
            context.principal,
            context.userId,
            50,
          );
          for (const chunk of chunks) {
            const guess = categoriseInterest(chunk.text);
            if (guess) {
              category = guess;
              break;
            }
          }
        }
        if (!category) {
          return no(
            "Nothing known about what kind of place suits them. Ask about that.",
          );
        }

        const places = await context.places.nearby({
          latitude: context.location.latitude,
          longitude: context.location.longitude,
          radiusMeters: num(args, "radiusMeters") ?? 5_000,
          category,
          limit: num(args, "limit") ?? 6,
        });
        span.setAttributes({ category, placeCount: places.length });

        if (places.length === 0) {
          return no("Nothing nearby fits. Say so and offer to widen the area.");
        }

        // Place identity is recorded so a later visit can be counted; the
        // human-readable fields are never persisted (assumptions.md A5).
        return ok(
          { places },
          "Describe what these are like, not their ratings.",
        );
      },
    );
  },
};
