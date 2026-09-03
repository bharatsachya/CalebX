import type { Embedding } from "@calebx/embed";

/**
 * The persona graph's shapes.
 *
 * Two things differ deliberately from the original HelixDB-era design:
 * `userId` is the namespaced string used everywhere else (not a numeric
 * platform id), and a `PersonaChunk` is a real node hanging off the user rather
 * than a side table with a foreign key — so chunks can participate in traversal.
 */

export type ChunkCategory =
  "interest" | "location" | "social" | "sentiment" | "preference";

export interface GraphUser {
  userId: string;
  /** Opted in to appearing in other users' people recommendations. */
  discoverable: boolean;
  /** Written by the cohort job. Null until it has run over this user. */
  communityId: number | null;
  createdAt: number;
  lastActive: number;
}

export interface NewChunk {
  text: string;
  category: ChunkCategory;
  embedding: Embedding;
  /** Defaults to now. Injectable so tests can age a chunk. */
  createdAt?: number;
}

/**
 * Chunks are immutable once written. A contradiction produces a new chunk; the
 * old one stays and simply weighs less, because the temporal trail *is* the
 * persona history. There is no `decayWeight` field — decay is computed at read
 * time from `createdAt` (assumptions.md A6).
 */
export interface PersonaChunk {
  chunkId: string;
  userId: string;
  text: string;
  category: ChunkCategory;
  embedding: Embedding;
  createdAt: number;
}

export interface ScoredChunk {
  chunk: PersonaChunk;
  /** Raw cosine similarity, before decay is applied. */
  similarity: number;
}

/** Identity only — see assumptions.md A5 for why no name or coordinates. */
export interface GraphPlace {
  placeId: string;
  ourTags: string[];
  cachedAt: number;
}

export interface GraphGroup {
  groupId: string;
  title: string;
  cohortKey: string;
  inviteLink: string | null;
  category: string;
  memberCount: number;
}

export interface PeerCandidate {
  userId: string;
  discoverable: boolean;
  /** How many mutual connections the requester shares with this peer. */
  sharedConnections: number;
}

/** One `KNOWS` edge, for the cohort job. */
export interface KnowsEdge {
  from: string;
  to: string;
  strength: number;
}

/** A user reduced to their interest vocabulary, for tag-based cohorting. */
export interface UserInterests {
  userId: string;
  interests: string[];
}
