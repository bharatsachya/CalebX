import { EMBEDDING_DIMENSIONS, EMBEDDING_SIMILARITY } from "@calebx/embed";

/**
 * Constraints and indexes, as idempotent statements applied in order.
 *
 * All `IF NOT EXISTS`, so applying the schema to a live database is safe and
 * repeatable — there is no migration table for Neo4j because there is nothing
 * here that is not convergent.
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
  "CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.userId IS UNIQUE",
  "CREATE CONSTRAINT group_id IF NOT EXISTS FOR (g:Group) REQUIRE g.groupId IS UNIQUE",
  "CREATE CONSTRAINT place_id IF NOT EXISTS FOR (p:Place) REQUIRE p.placeId IS UNIQUE",
  "CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:PersonaChunk) REQUIRE c.chunkId IS UNIQUE",

  // Cohort lookups scan by key; group titles are never queried by prefix.
  "CREATE INDEX group_cohort IF NOT EXISTS FOR (g:Group) ON (g.cohortKey)",
  "CREATE INDEX user_community IF NOT EXISTS FOR (u:User) ON (u.communityId)",
  "CREATE INDEX chunk_category IF NOT EXISTS FOR (c:PersonaChunk) ON (c.category)",

  // The dimension comes from @calebx/embed so it cannot disagree with the
  // provider or with the Postgres column. Changing the model means reindexing.
  `CREATE VECTOR INDEX chunk_embedding IF NOT EXISTS
   FOR (c:PersonaChunk) ON c.embedding
   OPTIONS { indexConfig: {
     \`vector.dimensions\`: ${EMBEDDING_DIMENSIONS},
     \`vector.similarity_function\`: '${EMBEDDING_SIMILARITY}'
   } }`,
] as const;

/** Vector index name, needed by the query that reads it. */
export const CHUNK_VECTOR_INDEX = "chunk_embedding";
