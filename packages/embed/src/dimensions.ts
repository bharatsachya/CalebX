/**
 * The embedding model, fixed in one place.
 *
 * This number is compiled into the Neo4j vector index and the Postgres
 * `vector(N)` column type. Changing it means reindexing both stores, so it lives
 * here alone and is imported by the schema, the migration test, and every
 * provider — a mismatch fails a unit test instead of silently returning garbage
 * neighbours.
 *
 * `bge-small-en-v1.5` at 384 dimensions was chosen over `nomic-embed-text` at 768:
 * persona chunks and interest lines are short, and 384-dim vectors are
 * materially cheaper in both indexes. See assumptions.md A4.
 */
export const EMBEDDING_MODEL = "bge-small-en-v1.5";

export const EMBEDDING_DIMENSIONS = 384;

/** Cosine, because both indexes are built for cosine. Not configurable. */
export const EMBEDDING_SIMILARITY = "cosine" as const;
