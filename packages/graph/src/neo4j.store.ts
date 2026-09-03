import neo4j, { type Driver } from "neo4j-driver";
import { Neo4jError } from "@calebx/errors";
import {
  scopedCypher,
  type CypherExecutor,
  type Principal,
} from "@calebx/authz";
import type { Embedding } from "@calebx/embed";
import {
  requireOwn,
  requirePeer,
  requireSharedRead,
  requireSystem,
} from "./access.ts";
import * as Q from "./cypher.ts";
import { getGraphConfig, type GraphConfig } from "./config.ts";
import { Neo4jConnection } from "./neo4j.driver.ts";
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
 * Neo4j-backed `GraphStore`.
 *
 * Every query goes through `scopedCypher`, which refuses a statement that
 * neither binds `$ownerId` nor carries the explicit bulk marker. So the
 * authorization story here is two independent layers: `access.ts` decides
 * whether the caller may do this at all, and the scoped executor decides whether
 * the query itself is allowed to leave one user's subgraph.
 */
export class Neo4jGraphStore implements GraphStore {
  private readonly connection: Neo4jConnection;

  constructor(config: GraphConfig = getGraphConfig()) {
    this.connection = new Neo4jConnection(config);
  }

  /** Raw executor. Never used directly — always wrapped by `scopedCypher`. */
  private raw(): CypherExecutor {
    return this.connection.raw();
  }

  private exec(principal: Principal): CypherExecutor {
    return scopedCypher(this.raw(), principal);
  }

  async ensureUser(principal: Principal, userId: string): Promise<GraphUser> {
    requireOwn(principal, userId, "persona_chunk", "write");
    const [user] = await this.exec(principal).run<GraphUser>(Q.ENSURE_USER, {
      ownerId: userId,
      now: Date.now(),
    });
    if (!user) throw new Neo4jError(`ensureUser returned no node`);
    return user;
  }

  async getUser(
    principal: Principal,
    userId: string,
  ): Promise<GraphUser | null> {
    requireOwn(principal, userId, "persona_chunk", "read");
    const [user] = await this.exec(principal).run<GraphUser>(Q.GET_USER, {
      ownerId: userId,
    });
    return user ?? null;
  }

  async setDiscoverable(
    principal: Principal,
    userId: string,
    discoverable: boolean,
  ): Promise<void> {
    requireOwn(principal, userId, "persona_chunk", "write");
    await this.ensureUser(principal, userId);
    await this.exec(principal).run(Q.SET_DISCOVERABLE, {
      ownerId: userId,
      discoverable,
    });
  }

  async addChunks(
    principal: Principal,
    userId: string,
    chunks: NewChunk[],
  ): Promise<string[]> {
    requireOwn(principal, userId, "persona_chunk", "write");
    if (chunks.length === 0) return [];
    await this.ensureUser(principal, userId);

    const executor = this.exec(principal);
    const ids: string[] = [];
    for (const chunk of chunks) {
      const chunkId = crypto.randomUUID();
      await executor.run(Q.ADD_CHUNK, {
        ownerId: userId,
        chunkId,
        text: chunk.text,
        category: chunk.category,
        embedding: chunk.embedding,
        createdAt: chunk.createdAt ?? Date.now(),
      });
      ids.push(chunkId);
    }
    return ids;
  }

  async listChunks(
    principal: Principal,
    userId: string,
    limit = 50,
  ): Promise<PersonaChunk[]> {
    requireOwn(principal, userId, "persona_chunk", "read");
    const rows = await this.exec(principal).run<Omit<PersonaChunk, "userId">>(
      Q.LIST_CHUNKS,
      { ownerId: userId, limit },
    );
    return rows.map((row) => ({ ...row, userId }));
  }

  async searchOwnChunks(
    principal: Principal,
    userId: string,
    embedding: Embedding,
    limit = 10,
  ): Promise<ScoredChunk[]> {
    requireOwn(principal, userId, "persona_chunk", "read");
    const rows = await this.exec(principal).run<
      Omit<PersonaChunk, "userId"> & { score: number }
    >(Q.SEARCH_OWN_CHUNKS, {
      ownerId: userId,
      embedding,
      limit,
      // The vector index is global, so it is probed wider than `limit` and then
      // narrowed to this user. Without the multiplier, a user with few chunks
      // in a large index gets nothing back.
      probe: Math.max(limit * 10, 50),
    });
    return rows.map(({ score, ...chunk }) => ({
      chunk: { ...chunk, userId },
      similarity: score,
    }));
  }

  async linkKnows(
    principal: Principal,
    userId: string,
    otherUserId: string,
    strength = 1,
  ): Promise<void> {
    requireOwn(principal, userId, "persona_chunk", "write");
    await this.exec(principal).run(Q.LINK_KNOWS, {
      ownerId: userId,
      otherId: otherUserId,
      strength,
    });
  }

  async secondDegreePeers(
    principal: Principal,
    userId: string,
    limit = 10,
  ): Promise<PeerCandidate[]> {
    requireOwn(principal, userId, "peer", "read");
    return this.exec(principal).run<PeerCandidate>(Q.SECOND_DEGREE, {
      ownerId: userId,
      limit,
    });
  }

  async peerChunks(
    principal: Principal,
    peerUserId: string,
    limit = 20,
  ): Promise<PersonaChunk[]> {
    // Discoverability is read with a system principal precisely because the
    // requester is not allowed to read the peer's node — only to be told
    // whether the peer opted in.
    const [peer] = await this.raw().run<{ discoverable: boolean }>(Q.GET_USER, {
      ownerId: peerUserId,
    });
    requirePeer(principal, peerUserId, peer?.discoverable ?? false);

    const rows = await this.exec(principal).run<Omit<PersonaChunk, "userId">>(
      Q.PEER_CHUNKS,
      { ownerId: peerUserId, limit },
    );
    return rows.map((row) => ({ ...row, userId: peerUserId }));
  }

  async recordVisit(
    principal: Principal,
    userId: string,
    placeId: string,
    tags: string[],
  ): Promise<void> {
    requireOwn(principal, userId, "place", "write");
    await this.exec(principal).run(Q.RECORD_VISIT, {
      ownerId: userId,
      placeId,
      tags,
      now: Date.now(),
    });
  }

  async joinGroup(
    principal: Principal,
    userId: string,
    groupId: string,
  ): Promise<void> {
    requireOwn(principal, userId, "group", "write");
    await this.exec(principal).run(Q.JOIN_GROUP, {
      ownerId: userId,
      groupId,
      now: Date.now(),
    });
  }

  async listMyGroups(
    principal: Principal,
    userId: string,
  ): Promise<GraphGroup[]> {
    requireOwn(principal, userId, "group", "read");
    requireSharedRead(principal, "group");
    return this.exec(principal).run<GraphGroup>(Q.LIST_MY_GROUPS, {
      ownerId: userId,
    });
  }

  async deleteUser(principal: Principal, userId: string): Promise<void> {
    requireOwn(principal, userId, "persona_chunk", "delete");
    await this.exec(principal).run(Q.DELETE_USER, { ownerId: userId });
  }

  async upsertGroup(principal: Principal, group: GraphGroup): Promise<void> {
    requireSystem(principal, "group", "write");
    await this.exec(principal).run(Q.UPSERT_GROUP, { ...group });
  }

  async groupsByCohort(
    principal: Principal,
    cohortKey: string,
  ): Promise<GraphGroup[]> {
    requireSystem(principal, "group");
    return this.exec(principal).run<GraphGroup>(Q.GROUPS_BY_COHORT, {
      cohortKey,
    });
  }

  async knowsEdges(principal: Principal): Promise<KnowsEdge[]> {
    requireSystem(principal, "peer");
    return this.exec(principal).run<KnowsEdge>(Q.ALL_KNOWS_EDGES);
  }

  async allUserInterests(principal: Principal): Promise<UserInterests[]> {
    requireSystem(principal, "persona_chunk");
    return this.exec(principal).run<UserInterests>(Q.ALL_USER_INTERESTS);
  }

  async setCommunityId(
    principal: Principal,
    userId: string,
    communityId: number | null,
  ): Promise<void> {
    requireSystem(principal, "community_label", "write");
    await this.exec(principal).run(Q.SET_COMMUNITY_ID, { userId, communityId });
  }

  async close(): Promise<void> {
    await this.connection.close();
  }
}
