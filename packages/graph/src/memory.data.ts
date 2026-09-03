import { cosine, type Embedding } from "@calebx/embed";
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
 * The in-memory graph itself: storage and traversal, with no authorization.
 *
 * Kept apart from `MemoryGraphStore` so that file is nothing but the access
 * checks and this one is nothing but the data structures. Nothing outside the
 * store may hold an instance — every method here would happily read any user's
 * subgraph, which is exactly why the checks live one layer up.
 */
export class MemoryGraphData {
  private readonly users = new Map<string, GraphUser>();
  private readonly chunks = new Map<string, PersonaChunk[]>();
  private readonly knows = new Map<string, Map<string, number>>();
  private readonly visits = new Map<string, Map<string, number>>();
  private readonly groups = new Map<string, GraphGroup>();
  private readonly memberships = new Map<string, Set<string>>();
  private nextChunk = 1;

  constructor(private readonly now: () => number = () => Date.now()) {}

  hasUser(userId: string): boolean {
    return this.users.has(userId);
  }

  ensureUser(userId: string): GraphUser {
    const existing = this.users.get(userId);
    if (existing) {
      existing.lastActive = this.now();
      return { ...existing };
    }
    const created: GraphUser = {
      userId,
      // Opt-in, never opt-out: a user who has never been asked is not findable.
      discoverable: false,
      communityId: null,
      createdAt: this.now(),
      lastActive: this.now(),
    };
    this.users.set(userId, created);
    return { ...created };
  }

  getUser(userId: string): GraphUser | null {
    const user = this.users.get(userId);
    return user ? { ...user } : null;
  }

  setDiscoverable(userId: string, discoverable: boolean): void {
    const user = this.ensureUser(userId);
    this.users.set(userId, { ...user, discoverable });
  }

  isDiscoverable(userId: string): boolean {
    return this.users.get(userId)?.discoverable ?? false;
  }

  addChunks(userId: string, incoming: NewChunk[]): string[] {
    this.ensureUser(userId);
    const list = this.chunks.get(userId) ?? [];
    const ids: string[] = [];
    for (const chunk of incoming) {
      const chunkId = `c${this.nextChunk++}`;
      list.push({
        chunkId,
        userId,
        text: chunk.text,
        category: chunk.category,
        embedding: [...chunk.embedding],
        createdAt: chunk.createdAt ?? this.now(),
      });
      ids.push(chunkId);
    }
    this.chunks.set(userId, list);
    return ids;
  }

  /** Newest first. Returns copies, so a caller cannot mutate stored vectors. */
  listChunks(userId: string, limit: number): PersonaChunk[] {
    return [...(this.chunks.get(userId) ?? [])]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((chunk) => ({ ...chunk, embedding: [...chunk.embedding] }))
      .slice(0, limit);
  }

  searchChunks(
    userId: string,
    embedding: Embedding,
    limit: number,
  ): ScoredChunk[] {
    return this.listChunks(userId, Number.MAX_SAFE_INTEGER)
      .map((chunk) => ({
        chunk,
        similarity: cosine(embedding, chunk.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  linkKnows(userId: string, otherUserId: string, strength: number): void {
    // Stored both ways: the second-degree traversal is undirected, and
    // reversing it at query time on every hop is needless work.
    for (const [from, to] of [
      [userId, otherUserId],
      [otherUserId, userId],
    ]) {
      const edges = this.knows.get(from) ?? new Map<string, number>();
      edges.set(to, strength);
      this.knows.set(from, edges);
    }
  }

  secondDegree(userId: string, limit: number): PeerCandidate[] {
    const direct = this.knows.get(userId) ?? new Map<string, number>();
    const shared = new Map<string, Set<string>>();

    for (const friend of direct.keys()) {
      for (const peer of (this.knows.get(friend) ?? new Map()).keys()) {
        if (peer === userId || direct.has(peer)) continue;
        const via = shared.get(peer) ?? new Set<string>();
        via.add(friend);
        shared.set(peer, via);
      }
    }

    return [...shared.entries()]
      .map(([peerId, via]) => ({
        userId: peerId,
        discoverable: this.isDiscoverable(peerId),
        sharedConnections: via.size,
      }))
      .sort(
        (a, b) =>
          b.sharedConnections - a.sharedConnections ||
          a.userId.localeCompare(b.userId),
      )
      .slice(0, limit);
  }

  recordVisit(userId: string, placeId: string): void {
    const places = this.visits.get(userId) ?? new Map<string, number>();
    places.set(placeId, (places.get(placeId) ?? 0) + 1);
    this.visits.set(userId, places);
  }

  upsertGroup(group: GraphGroup): void {
    const existing = this.groups.get(group.groupId);
    this.groups.set(group.groupId, {
      ...group,
      memberCount: existing?.memberCount ?? group.memberCount,
    });
  }

  joinGroup(userId: string, groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    const mine = this.memberships.get(userId) ?? new Set<string>();
    if (!mine.has(groupId)) {
      mine.add(groupId);
      this.groups.set(groupId, {
        ...group,
        memberCount: group.memberCount + 1,
      });
    }
    this.memberships.set(userId, mine);
  }

  myGroups(userId: string): GraphGroup[] {
    return [...(this.memberships.get(userId) ?? [])]
      .map((groupId) => this.groups.get(groupId))
      .filter((group): group is GraphGroup => group !== undefined)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  groupsByCohort(cohortKey: string): GraphGroup[] {
    return [...this.groups.values()].filter((g) => g.cohortKey === cohortKey);
  }

  knowsEdges(): KnowsEdge[] {
    const out: KnowsEdge[] = [];
    for (const [from, edges] of this.knows) {
      for (const [to, strength] of edges) out.push({ from, to, strength });
    }
    return out;
  }

  allUserInterests(): UserInterests[] {
    return [...this.chunks.entries()].map(([userId, chunks]) => ({
      userId,
      interests: chunks
        .filter((c) => c.category === "interest" || c.category === "preference")
        .map((c) => c.text),
    }));
  }

  setCommunityId(userId: string, communityId: number | null): void {
    const user = this.users.get(userId);
    if (user) this.users.set(userId, { ...user, communityId });
  }

  /** Removes the user everywhere, including edges other people hold to them. */
  deleteUser(userId: string): void {
    this.users.delete(userId);
    this.chunks.delete(userId);
    this.visits.delete(userId);
    this.memberships.delete(userId);
    this.knows.delete(userId);
    for (const edges of this.knows.values()) edges.delete(userId);
  }
}
