import type { Principal } from "@calebx/authz";
import type { Embedding } from "@calebx/embed";
import {
  requireOwn,
  requirePeer,
  requireSharedRead,
  requireSystem,
} from "./access.ts";
import { MemoryGraphData } from "./memory.data.ts";
import type { GraphStore } from "./store.ts";
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
 * A complete in-memory `GraphStore`.
 *
 * Not a stub with `throw new Error("not implemented")` in half its methods — it
 * runs the same traversals as Neo4j (in `MemoryGraphData`) and the same
 * authorization checks (in `access.ts`, shared with the Neo4j store). A fake
 * that is more permissive than the real thing turns every passing test into a
 * false negative, so neither half is written twice.
 *
 * It is also a usable local backend when Aura is not reachable.
 */
export class MemoryGraphStore implements GraphStore {
  private readonly data: MemoryGraphData;

  constructor(now: () => number = () => Date.now()) {
    this.data = new MemoryGraphData(now);
  }

  async ensureUser(principal: Principal, userId: string): Promise<GraphUser> {
    requireOwn(principal, userId, "persona_chunk", "write");
    return this.data.ensureUser(userId);
  }

  async getUser(
    principal: Principal,
    userId: string,
  ): Promise<GraphUser | null> {
    requireOwn(principal, userId, "persona_chunk", "read");
    return this.data.getUser(userId);
  }

  async setDiscoverable(
    principal: Principal,
    userId: string,
    discoverable: boolean,
  ): Promise<void> {
    requireOwn(principal, userId, "persona_chunk", "write");
    this.data.setDiscoverable(userId, discoverable);
  }

  async addChunks(
    principal: Principal,
    userId: string,
    incoming: NewChunk[],
  ): Promise<string[]> {
    requireOwn(principal, userId, "persona_chunk", "write");
    return this.data.addChunks(userId, incoming);
  }

  async listChunks(
    principal: Principal,
    userId: string,
    limit = 50,
  ): Promise<PersonaChunk[]> {
    requireOwn(principal, userId, "persona_chunk", "read");
    return this.data.listChunks(userId, limit);
  }

  async searchOwnChunks(
    principal: Principal,
    userId: string,
    embedding: Embedding,
    limit = 10,
  ): Promise<ScoredChunk[]> {
    requireOwn(principal, userId, "persona_chunk", "read");
    return this.data.searchChunks(userId, embedding, limit);
  }

  async linkKnows(
    principal: Principal,
    userId: string,
    otherUserId: string,
    strength = 1,
  ): Promise<void> {
    requireOwn(principal, userId, "persona_chunk", "write");
    this.data.linkKnows(userId, otherUserId, strength);
  }

  async secondDegreePeers(
    principal: Principal,
    userId: string,
    limit = 10,
  ): Promise<PeerCandidate[]> {
    requireOwn(principal, userId, "peer", "read");
    return this.data.secondDegree(userId, limit);
  }

  async peerChunks(
    principal: Principal,
    peerUserId: string,
    limit = 20,
  ): Promise<PersonaChunk[]> {
    requirePeer(principal, peerUserId, this.data.isDiscoverable(peerUserId));
    return this.data.listChunks(peerUserId, limit);
  }

  async recordVisit(
    principal: Principal,
    userId: string,
    placeId: string,
    _tags: string[],
  ): Promise<void> {
    requireOwn(principal, userId, "place", "write");
    // Matches the Cypher, which does `MATCH (u:User …)` rather than MERGE: a
    // visit is a fact about a user we are already in conversation with, so an
    // unknown user here means a caller skipped `ensureUser`, and inventing a
    // half-initialised node would hide that.
    if (!this.data.hasUser(userId)) return;
    this.data.recordVisit(userId, placeId);
  }

  async joinGroup(
    principal: Principal,
    userId: string,
    groupId: string,
  ): Promise<void> {
    requireOwn(principal, userId, "group", "write");
    this.data.joinGroup(userId, groupId);
  }

  async listMyGroups(
    principal: Principal,
    userId: string,
  ): Promise<GraphGroup[]> {
    requireOwn(principal, userId, "group", "read");
    requireSharedRead(principal, "group");
    return this.data.myGroups(userId);
  }

  async deleteUser(principal: Principal, userId: string): Promise<void> {
    requireOwn(principal, userId, "persona_chunk", "delete");
    this.data.deleteUser(userId);
  }

  async upsertGroup(principal: Principal, group: GraphGroup): Promise<void> {
    requireSystem(principal, "group", "write");
    this.data.upsertGroup(group);
  }

  async groupsByCohort(
    principal: Principal,
    cohortKey: string,
  ): Promise<GraphGroup[]> {
    requireSystem(principal, "group");
    return this.data.groupsByCohort(cohortKey);
  }

  async knowsEdges(principal: Principal): Promise<KnowsEdge[]> {
    requireSystem(principal, "peer");
    return this.data.knowsEdges();
  }

  async allUserInterests(principal: Principal): Promise<UserInterests[]> {
    requireSystem(principal, "persona_chunk");
    return this.data.allUserInterests();
  }

  async setCommunityId(
    principal: Principal,
    userId: string,
    communityId: number | null,
  ): Promise<void> {
    requireSystem(principal, "community_label", "write");
    this.data.setCommunityId(userId, communityId);
  }

  async close(): Promise<void> {
    /* nothing to close */
  }
}
