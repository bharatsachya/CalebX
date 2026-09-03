import type { Principal } from "@calebx/authz";
import { userPrincipal } from "@calebx/authz";
import type { AgentMode } from "@calebx/core";
import type {
  AgentUsersRepository,
  CandidateSearchRepository,
  CohortGroupsRepository,
  MatchmakingRepository,
  ReviewTasksRepository,
} from "@calebx/db";
import type { EmbeddingProvider } from "@calebx/embed";
import type { GraphStore } from "@calebx/graph";
import {
  COMMUNITY_PERSONA,
  COMMUNITY_TOOLS,
  type CommunityContext,
  type PlacesProvider,
} from "@calebx/community";
import {
  MATCHMAKER_PERSONA,
  MATCHMAKING_TOOLS,
  type MatchmakingContext,
} from "@calebx/matchmaking";
import type { ToolDefinition } from "@calebx/core";
import type { ChatModel } from "./chat.ts";
import type { MemoryPort } from "./memory.ts";
import { createHumanReviewTool } from "./human-review.ts";

/**
 * Everything a turn needs, injected.
 *
 * Assembled once at boot by an entry point and passed down. Nothing in the
 * agent reaches for a module-level client, which is what makes a whole turn
 * testable against fakes — including the parts that decide which half of the
 * data the turn may touch.
 */
export interface AgentDeps {
  model: ChatModel;
  /** Defaults to mem0. Injected in tests so a turn needs no network. */
  memory?: MemoryPort;
  agentUsers: AgentUsersRepository;
  graph: GraphStore;
  embed: EmbeddingProvider;
  places: PlacesProvider;
  repos: {
    matchmaking: MatchmakingRepository;
    search: CandidateSearchRepository;
    review: ReviewTasksRepository;
    cohorts: CohortGroupsRepository;
  };
  /** SHA-256 of the namespaced id — how `candidates` keys ownership. */
  hashUserId(userId: string): string;
  /** Salt for peer handles. Per deployment, never logged. */
  handleSalt: string;
  /** Writes pair records that belong to neither user. */
  pairWriter: Principal;
  /** Cross-user lookups a user may not make (cohort registry). */
  systemPrincipal: Principal;
  /** Resolves the user's candidate row id, if they have one. */
  resolveCandidateId?(userId: string): Promise<string | null>;
  /** Resolves coordinates for place lookups, when the conversation has them. */
  resolveLocation?(
    userId: string,
  ): Promise<
    { latitude: number; longitude: number; city: string | null } | undefined
  >;
  now?(): number;
}

/**
 * The principal for this turn.
 *
 * Carries the namespaced id as its identity and the Postgres hash as an alias,
 * because the matchmaking tables key ownership by the hash while everything else
 * keys it by the id. Both name the same person; see `@calebx/authz`.
 */
export function principalForTurn(
  deps: AgentDeps,
  userId: string,
  mode: AgentMode,
  enrolledModes: readonly AgentMode[],
): Principal {
  return userPrincipal(userId, mode, enrolledModes, [deps.hashUserId(userId)]);
}

export interface SubagentBundle<Context> {
  mode: AgentMode;
  persona: string;
  tools: readonly ToolDefinition<Context>[];
  context: Context;
}

export async function buildMatchmakerBundle(
  deps: AgentDeps,
  userId: string,
  principal: Principal,
): Promise<SubagentBundle<MatchmakingContext>> {
  const context: MatchmakingContext = {
    principal,
    userId,
    userIdHash: deps.hashUserId(userId),
    candidateId: (await deps.resolveCandidateId?.(userId)) ?? null,
    repos: {
      matchmaking: deps.repos.matchmaking,
      search: deps.repos.search,
      review: deps.repos.review,
      agentUsers: deps.agentUsers,
    },
    embed: deps.embed,
    pairWriter: deps.pairWriter,
  };

  return {
    mode: "matchmaker",
    persona: MATCHMAKER_PERSONA,
    tools: [
      ...MATCHMAKING_TOOLS,
      createHumanReviewTool<MatchmakingContext>((ctx) => ({
        principal: ctx.principal,
        userId: ctx.userId,
        review: ctx.repos.review,
      })),
    ],
    context,
  };
}

export async function buildCommunityBundle(
  deps: AgentDeps,
  userId: string,
  principal: Principal,
): Promise<SubagentBundle<CommunityContext>> {
  const context: CommunityContext = {
    principal,
    userId,
    graph: deps.graph,
    embed: deps.embed,
    places: deps.places,
    repos: { cohorts: deps.repos.cohorts, review: deps.repos.review },
    systemPrincipal: deps.systemPrincipal,
    handleSalt: deps.handleSalt,
    now: deps.now,
    location: await deps.resolveLocation?.(userId),
  };

  return {
    mode: "community_connector",
    persona: COMMUNITY_PERSONA,
    tools: [
      ...COMMUNITY_TOOLS,
      createHumanReviewTool<CommunityContext>((ctx) => ({
        principal: ctx.principal,
        userId: ctx.userId,
        review: ctx.repos.review,
      })),
    ],
    context,
  };
}
