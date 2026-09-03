import { CHUNK_VECTOR_INDEX } from "./schema.ts";

/**
 * Every Cypher statement the Neo4j store runs, in one file.
 *
 * Two reasons they are not inlined at their call sites: a unit test asserts that
 * *every* statement exported from here is either `$ownerId`-scoped or carries the
 * explicit bulk marker (see cypher.test.ts), and that test is only possible if
 * the statements are enumerable. A query written inline is a query nobody
 * checks.
 */

export const ENSURE_USER = `
MERGE (u:User {userId: $ownerId})
ON CREATE SET u.createdAt = $now, u.lastActive = $now,
              u.discoverable = false, u.communityId = null
ON MATCH SET u.lastActive = $now
RETURN u.userId AS userId, u.discoverable AS discoverable,
       u.communityId AS communityId, u.createdAt AS createdAt,
       u.lastActive AS lastActive
`;

export const GET_USER = `
MATCH (u:User {userId: $ownerId})
RETURN u.userId AS userId, u.discoverable AS discoverable,
       u.communityId AS communityId, u.createdAt AS createdAt,
       u.lastActive AS lastActive
`;

export const SET_DISCOVERABLE = `
MATCH (u:User {userId: $ownerId})
SET u.discoverable = $discoverable
RETURN u.discoverable AS discoverable
`;

export const ADD_CHUNK = `
MATCH (u:User {userId: $ownerId})
CREATE (u)-[:HAS_CHUNK]->(c:PersonaChunk {
  chunkId: $chunkId, text: $text, category: $category,
  embedding: $embedding, createdAt: $createdAt
})
RETURN c.chunkId AS chunkId
`;

export const LIST_CHUNKS = `
MATCH (u:User {userId: $ownerId})-[:HAS_CHUNK]->(c:PersonaChunk)
RETURN c.chunkId AS chunkId, c.text AS text, c.category AS category,
       c.embedding AS embedding, c.createdAt AS createdAt
ORDER BY c.createdAt DESC
LIMIT $limit
`;

/**
 * Vector search constrained to one user's chunks.
 *
 * The vector index is global, so it is queried for a generous `k` and then
 * filtered down to the owner. That ordering is deliberate: never run an
 * unconstrained ANN and hand the results to a user — the filter is a privacy
 * boundary, not an optimisation.
 */
export const SEARCH_OWN_CHUNKS = `
CALL db.index.vector.queryNodes('${CHUNK_VECTOR_INDEX}', $probe, $embedding)
YIELD node AS c, score
MATCH (u:User {userId: $ownerId})-[:HAS_CHUNK]->(c)
RETURN c.chunkId AS chunkId, c.text AS text, c.category AS category,
       c.embedding AS embedding, c.createdAt AS createdAt, score
ORDER BY score DESC
LIMIT $limit
`;

export const LINK_KNOWS = `
MATCH (a:User {userId: $ownerId})
MATCH (b:User {userId: $otherId})
MERGE (a)-[k:KNOWS]->(b)
SET k.strength = $strength
RETURN k.strength AS strength
`;

/**
 * Friend-of-friend, excluding people already known and the requester.
 *
 * `discoverable` comes back with each candidate rather than being filtered in
 * the query, so the authorization layer makes the visibility decision in one
 * place instead of it being implicit in a `WHERE` clause here.
 */
export const SECOND_DEGREE = `
MATCH (me:User {userId: $ownerId})-[:KNOWS]-(friend:User)-[:KNOWS]-(peer:User)
WHERE peer.userId <> $ownerId
  AND NOT (me)-[:KNOWS]-(peer)
RETURN peer.userId AS userId,
       coalesce(peer.discoverable, false) AS discoverable,
       count(DISTINCT friend) AS sharedConnections
ORDER BY sharedConnections DESC, peer.userId ASC
LIMIT $limit
`;

export const PEER_CHUNKS = `
MATCH (peer:User {userId: $ownerId})-[:HAS_CHUNK]->(c:PersonaChunk)
RETURN c.chunkId AS chunkId, c.text AS text, c.category AS category,
       c.embedding AS embedding, c.createdAt AS createdAt
ORDER BY c.createdAt DESC
LIMIT $limit
`;

export const RECORD_VISIT = `
MATCH (u:User {userId: $ownerId})
MERGE (p:Place {placeId: $placeId})
ON CREATE SET p.ourTags = $tags, p.cachedAt = $now
ON MATCH SET p.cachedAt = $now
MERGE (u)-[v:VISITED]->(p)
ON CREATE SET v.count = 1, v.lastVisitedAt = $now
ON MATCH SET v.count = coalesce(v.count, 0) + 1, v.lastVisitedAt = $now
RETURN v.count AS count
`;

export const JOIN_GROUP = `
MATCH (u:User {userId: $ownerId})
MATCH (g:Group {groupId: $groupId})
MERGE (u)-[m:MEMBER_OF]->(g)
ON CREATE SET m.joinedAt = $now, g.memberCount = coalesce(g.memberCount, 0) + 1
RETURN g.memberCount AS memberCount
`;

export const LIST_MY_GROUPS = `
MATCH (u:User {userId: $ownerId})-[:MEMBER_OF]->(g:Group)
RETURN g.groupId AS groupId, g.title AS title, g.cohortKey AS cohortKey,
       g.inviteLink AS inviteLink, g.category AS category,
       coalesce(g.memberCount, 0) AS memberCount
ORDER BY g.title ASC
`;

/** /forget. Detaches everything the user owns, chunks included. */
export const DELETE_USER = `
MATCH (u:User {userId: $ownerId})
OPTIONAL MATCH (u)-[:HAS_CHUNK]->(c:PersonaChunk)
DETACH DELETE c, u
`;

// --- statements that legitimately cross users; system principals only ---

export const UPSERT_GROUP = `// authz:bulk
MERGE (g:Group {groupId: $groupId})
SET g.title = $title, g.cohortKey = $cohortKey, g.category = $category,
    g.inviteLink = $inviteLink,
    g.memberCount = coalesce(g.memberCount, $memberCount)
RETURN g.groupId AS groupId
`;

export const GROUPS_BY_COHORT = `// authz:bulk
MATCH (g:Group {cohortKey: $cohortKey})
RETURN g.groupId AS groupId, g.title AS title, g.cohortKey AS cohortKey,
       g.inviteLink AS inviteLink, g.category AS category,
       coalesce(g.memberCount, 0) AS memberCount
`;

export const ALL_KNOWS_EDGES = `// authz:bulk
MATCH (a:User)-[k:KNOWS]->(b:User)
RETURN a.userId AS from, b.userId AS to, coalesce(k.strength, 1.0) AS strength
`;

export const ALL_USER_INTERESTS = `// authz:bulk
MATCH (u:User)-[:HAS_CHUNK]->(c:PersonaChunk)
WHERE c.category IN ['interest', 'preference']
RETURN u.userId AS userId, collect(c.text) AS interests
`;

export const SET_COMMUNITY_ID = `// authz:bulk
MATCH (u:User {userId: $userId})
SET u.communityId = $communityId
RETURN u.communityId AS communityId
`;

/** Every statement above, for the scope test. Keep in sync — the test fails loudly if not. */
export const ALL_STATEMENTS: Readonly<Record<string, string>> = {
  ENSURE_USER,
  GET_USER,
  SET_DISCOVERABLE,
  ADD_CHUNK,
  LIST_CHUNKS,
  SEARCH_OWN_CHUNKS,
  LINK_KNOWS,
  SECOND_DEGREE,
  PEER_CHUNKS,
  RECORD_VISIT,
  JOIN_GROUP,
  LIST_MY_GROUPS,
  DELETE_USER,
  UPSERT_GROUP,
  GROUPS_BY_COHORT,
  ALL_KNOWS_EDGES,
  ALL_USER_INTERESTS,
  SET_COMMUNITY_ID,
};
