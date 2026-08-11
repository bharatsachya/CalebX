import { createHash } from "node:crypto";

/**
 * Returns a deterministic hex SHA-256 hash of a user ID string.
 * Ensures user IDs stored in Postgres are always hashed.
 */
export function hashUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}
