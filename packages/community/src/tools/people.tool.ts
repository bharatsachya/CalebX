import { anonymizePeer, filterAuthorized } from "@calebx/authz";
import type { ToolDefinition } from "@calebx/core";
import { cosine } from "@calebx/embed";
import type { PeerCandidate } from "@calebx/graph";
import { withSpan } from "@calebx/trace";
import type { CommunityContext } from "../context.ts";
import { peerAffinity, rankChunks } from "../decay.ts";
import { no, num, ok } from "./shared.ts";

export const findLikeMindedPeople: ToolDefinition<CommunityContext> = {
  name: "find_like_minded_people",
  description:
    "Find people the user might click with, through mutual connections. Returns anonymous descriptions only — the other person must agree before anything identifying is shared.",
  parameters: {
    type: "object",
    properties: { limit: { type: "number" } },
    additionalProperties: false,
  },
  async handler(context, args) {
    return withSpan(
      "tool.find_like_minded_people",
      { kind: "tool" },
      async (span) => {
        const now = context.now?.() ?? Date.now();
        const limit = num(args, "limit") ?? 3;

        // Graph first: the candidate set is friends-of-friends, not "everyone".
        const candidates = await context.graph.secondDegreePeers(
          context.principal,
          context.userId,
          limit * 4,
        );
        span.setAttributes({ candidateCount: candidates.length });

        if (candidates.length === 0) {
          return no(
            "No mutual-connection candidates yet. Say so plainly — do not offer strangers instead.",
          );
        }

        // Consent gate: only peers who opted in may be described at all.
        const visible = filterAuthorized(
          context.principal,
          "read_anonymized",
          candidates,
          (peer: PeerCandidate) => ({
            kind: "peer",
            ownerId: peer.userId,
            mode: "community_connector",
            discoverable: peer.discoverable,
          }),
        ).map(({ item }) => item);

        if (visible.length === 0) {
          return no(
            "There are mutual connections, but nobody nearby has opted in to being introduced. Say that honestly.",
          );
        }

        const mine = rankChunks(
          await context.graph.searchOwnChunks(
            context.principal,
            context.userId,
            (await context.embed.embed(["what this person is into"]))[0],
            25,
          ),
          now,
        );

        const scored = [];
        for (const peer of visible) {
          const theirChunks = await context.graph.peerChunks(
            context.principal,
            peer.userId,
            25,
          );
          const affinity = peerAffinity(mine, theirChunks, cosine);
          scored.push({
            card: anonymizePeer(
              {
                userId: peer.userId,
                interests: theirChunks
                  .filter(
                    (chunk) =>
                      chunk.category === "interest" ||
                      chunk.category === "preference",
                  )
                  .map((chunk) => chunk.text)
                  .slice(0, 4),
                area:
                  theirChunks.find((chunk) => chunk.category === "location")
                    ?.text ?? null,
                sharedConnections: peer.sharedConnections,
                discoverable: peer.discoverable,
              },
              context.handleSalt,
            ),
            affinity,
          });
        }

        scored.sort((a, b) => b.affinity - a.affinity);
        const people = scored.slice(0, limit).map(({ card, affinity }) => ({
          ...card,
          affinity: Number(affinity.toFixed(3)),
        }));

        return ok(
          { people },
          "Describe what they are into and how you are connected. Never a name, handle, or photo — they have to agree first.",
        );
      },
    );
  },
};
