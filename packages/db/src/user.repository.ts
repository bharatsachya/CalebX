import type { User, IUserRepository } from "@calebx/core";
import { query, queryOne } from "./db.ts";
import { hashUserId } from "./hash.ts";
import * as Q from "./queries/candidate.queries.ts";
import type { Candidate } from "./types.ts";

/**
 * Real PostgreSQL-backed UserRepository implementing `@calebx/core`'s IUserRepository.
 * Stores user IDs as deterministic SHA-256 hashes in `candidates.user_id_hash`.
 */
export class PostgresUserRepository implements IUserRepository {
  async createUser(userId: string): Promise<User> {
    const userIdHash = hashUserId(userId);

    const existing = await queryOne<Candidate>(
      Q.SELECT_CANDIDATE_BY_USER_ID_HASH,
      [userIdHash],
    );
    if (existing) {
      return { id: existing.id, userId };
    }

    try {
      const inserted = await query<Candidate>(
        Q.INSERT_CANDIDATE_BY_USER_ID_HASH,
        [userIdHash],
      );
      const candidate = inserted[0];
      return { id: candidate.id, userId };
    } catch {
      const again = await queryOne<Candidate>(
        Q.SELECT_CANDIDATE_BY_USER_ID_HASH,
        [userIdHash],
      );
      if (again) return { id: again.id, userId };
      throw new Error(
        `Failed to create candidate for userIdHash: ${userIdHash}`,
      );
    }
  }

  async getUser(userId: string): Promise<User | null> {
    const userIdHash = hashUserId(userId);
    const candidate = await queryOne<Candidate>(
      Q.SELECT_CANDIDATE_BY_USER_ID_HASH,
      [userIdHash],
    );
    if (!candidate) return null;
    return { id: candidate.id, userId };
  }
}
