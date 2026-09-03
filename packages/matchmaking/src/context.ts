import type { Principal } from "@calebx/authz";
import type { EmbeddingProvider } from "@calebx/embed";
import type {
  AgentUsersRepository,
  CandidateSearchRepository,
  MatchmakingRepository,
  ReviewTasksRepository,
} from "@calebx/db";

/**
 * Everything a matchmaker tool is allowed to touch.
 *
 * Passed in rather than imported so a tool can be unit-tested against fakes,
 * and so the set of capabilities a tool has is visible at a glance instead of
 * hidden in its import list.
 */
export interface MatchmakingContext {
  principal: Principal;
  /** Namespaced id ("tg:123"). */
  userId: string;
  /** SHA-256 of the namespaced id — how `candidates` stores ownership. */
  userIdHash: string;
  /** The caller's own candidate row, if they have completed a profile. */
  candidateId: string | null;
  repos: {
    matchmaking: MatchmakingRepository;
    search: CandidateSearchRepository;
    review: ReviewTasksRepository;
    agentUsers?: AgentUsersRepository;
  };
  embed: EmbeddingProvider;
  /** Admin principal used only to write pair records neither user owns. */
  pairWriter: Principal;
}
