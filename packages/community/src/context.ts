import type { Principal } from "@calebx/authz";
import type { CohortGroupsRepository, ReviewTasksRepository } from "@calebx/db";
import type { EmbeddingProvider } from "@calebx/embed";
import type { GraphStore } from "@calebx/graph";
import type { PlacesProvider } from "./places.client.ts";

/**
 * Everything a community tool may touch.
 *
 * `systemPrincipal` is here because two legitimate operations cross users — the
 * cohort→group registry lookup, and reading a peer's discoverability. Giving the
 * tools an explicit system principal for those is what keeps them from being
 * done with the user's own principal, which would be a much wider hole.
 */
export interface CommunityContext {
  principal: Principal;
  userId: string;
  graph: GraphStore;
  embed: EmbeddingProvider;
  places: PlacesProvider;
  repos: {
    cohorts: CohortGroupsRepository;
    review: ReviewTasksRepository;
  };
  /** Used only for cross-user lookups the user is not allowed to make. */
  systemPrincipal: Principal;
  /** Salt for peer handles; per deployment, never logged. */
  handleSalt: string;
  /** Injectable clock so decay is deterministic in tests. */
  now?: () => number;
  /** The user's coordinates, when the conversation has established them. */
  location?: { latitude: number; longitude: number; city: string | null };
}
