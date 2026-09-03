import type { Principal } from "@calebx/authz";
import type { Embedding } from "@calebx/embed";
import type {
  GraphGroup,
  GraphUser,
  KnowsEdge,
  NewChunk,
  PeerCandidate,
  PersonaChunk,
  ScoredChunk,
  UserInterests,
} from "./types.ts";

/**
 * The persona graph port.
 *
 * Every method takes a `Principal` as its first argument, and every
 * implementation checks it before touching data. That is not ceremony: it means
 * there is no way to reach the graph without having said who is asking, and a
 * new method that forgets the check fails its own test rather than quietly
 * becoming a hole.
 */
export interface GraphStore {
  /** Creates the user node if absent; refreshes `lastActive` either way. */
  ensureUser(principal: Principal, userId: string): Promise<GraphUser>;

  getUser(principal: Principal, userId: string): Promise<GraphUser | null>;

  /** The people-discovery opt-in. Off until the user says otherwise. */
  setDiscoverable(
    principal: Principal,
    userId: string,
    discoverable: boolean,
  ): Promise<void>;

  /** Appends immutable chunks. Returns the ids written. */
  addChunks(
    principal: Principal,
    userId: string,
    chunks: NewChunk[],
  ): Promise<string[]>;

  listChunks(
    principal: Principal,
    userId: string,
    limit?: number,
  ): Promise<PersonaChunk[]>;

  /** Vector search restricted to the user's own chunks. */
  searchOwnChunks(
    principal: Principal,
    userId: string,
    embedding: Embedding,
    limit?: number,
  ): Promise<ScoredChunk[]>;

  linkKnows(
    principal: Principal,
    userId: string,
    otherUserId: string,
    strength?: number,
  ): Promise<void>;

  /** Friend-of-friend candidates, before any visibility filtering. */
  secondDegreePeers(
    principal: Principal,
    userId: string,
    limit?: number,
  ): Promise<PeerCandidate[]>;

  /**
   * A peer's chunks, for ranking a candidate against the requester. Only ever
   * returns anything for a discoverable peer, and the caller receives text and
   * vectors — never the peer's identity beyond the id it already had.
   */
  peerChunks(
    principal: Principal,
    peerUserId: string,
    limit?: number,
  ): Promise<PersonaChunk[]>;

  recordVisit(
    principal: Principal,
    userId: string,
    placeId: string,
    tags: string[],
  ): Promise<void>;

  joinGroup(
    principal: Principal,
    userId: string,
    groupId: string,
  ): Promise<void>;

  listMyGroups(principal: Principal, userId: string): Promise<GraphGroup[]>;

  /** Erases the user and every chunk they own. Backs `/forget`. */
  deleteUser(principal: Principal, userId: string): Promise<void>;

  // --- system-principal surface: the cohort job and the group registrar ---

  upsertGroup(principal: Principal, group: GraphGroup): Promise<void>;

  groupsByCohort(
    principal: Principal,
    cohortKey: string,
  ): Promise<GraphGroup[]>;

  knowsEdges(principal: Principal): Promise<KnowsEdge[]>;

  allUserInterests(principal: Principal): Promise<UserInterests[]>;

  setCommunityId(
    principal: Principal,
    userId: string,
    communityId: number | null,
  ): Promise<void>;

  close(): Promise<void>;
}
