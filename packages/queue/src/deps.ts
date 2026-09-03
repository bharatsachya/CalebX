import { adminPrincipal, systemPrincipal } from "@calebx/authz";
import {
  AgentUsersRepository,
  CandidateSearchRepository,
  CohortGroupsRepository,
  MatchmakingRepository,
  ReviewTasksRepository,
  hashUserId,
} from "@calebx/db";
import { createEmbeddingProvider } from "@calebx/embed";
import { Neo4jGraphStore } from "@calebx/graph";
import { PlacesClient, StubPlacesClient } from "@calebx/community";
import { env } from "@calebx/config";
import { openRouterModel, type AgentDeps } from "@calebx/agent";

const e = env("agent");

/**
 * Builds the real dependency graph, once per process.
 *
 * The bots and the workers both call this, so a turn behaves identically
 * whether it ran inline or came off a queue — which is what makes the inline
 * mode a legitimate way to run the product rather than a second implementation.
 */
let cached: AgentDeps | null = null;

export async function buildAgentDeps(): Promise<AgentDeps> {
  if (cached) return cached;

  const embed = await createEmbeddingProvider();
  const graph = new Neo4jGraphStore();

  // Without a Places key the community subagent still works — it just cannot
  // suggest venues, and says so, rather than the process refusing to boot.
  const placesKey = e.optional("GOOGLE_PLACES_API_KEY", "");
  const places =
    placesKey === "" ? new StubPlacesClient([]) : new PlacesClient();

  cached = {
    model: openRouterModel,
    agentUsers: new AgentUsersRepository(),
    graph,
    embed,
    places,
    repos: {
      matchmaking: new MatchmakingRepository(),
      search: new CandidateSearchRepository(),
      review: new ReviewTasksRepository(),
      cohorts: new CohortGroupsRepository(),
    },
    hashUserId,
    handleSalt: e.optional("AUTHZ_HANDLE_SALT", "calebx-local-salt"),
    // Pair records belong to neither user, so they are written as the service
    // rather than as one of the two people involved.
    pairWriter: adminPrincipal("calebx-pair-writer"),
    systemPrincipal: systemPrincipal("agent-lookups"),
  };
  return cached;
}
