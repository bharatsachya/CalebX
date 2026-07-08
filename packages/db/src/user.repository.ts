import type { IUserRepository, User, UserProfile } from "@calebx/core";
import type { MatchableUser } from "@calebx/types";
import { run, toNumber } from "./driver.ts";

function dedupeLower(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== "string") continue;
    const key = v.trim().toLowerCase();
    if (key.length > 0 && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

export class Neo4jUserRepository implements IUserRepository {
  async createUser(
    telegramId: number,
    profile?: { username?: string } & Partial<UserProfile>,
  ): Promise<User> {
    const now = Date.now();
    await run(
      `MERGE (u:User { telegram_id: $telegramId })
       ON CREATE SET u.created_at = $now, u.consent_granted = true
       SET u.username = $username,
           u.name = coalesce($name, u.name),
           u.city = coalesce($city, u.city),
           u.age = coalesce($age, u.age),
           u.purpose = coalesce($purpose, u.purpose),
           u.last_active = $now`,
      {
        telegramId,
        now,
        username: profile?.username ?? "",
        name: profile?.name ?? null,
        city: profile?.city ?? null,
        age: profile?.age ?? null,
        purpose: profile?.purpose ?? null,
      },
    );
    return { id: String(telegramId), telegramId };
  }

  async getUserByTelegramId(telegramId: number): Promise<User | null> {
    const result = await run(
      `MATCH (u:User { telegram_id: $telegramId }) RETURN u.telegram_id AS id`,
      { telegramId },
    );
    if (result.records.length === 0) return null;
    return { id: String(telegramId), telegramId };
  }

  async updateUserProfile(
    telegramId: number,
    profile: UserProfile,
  ): Promise<void> {
    await run(
      `MATCH (u:User { telegram_id: $telegramId })
       SET u.name = $name, u.city = $city, u.age = $age,
           u.purpose = $purpose, u.last_active = $now`,
      {
        telegramId,
        name: profile.name,
        city: profile.city,
        age: profile.age,
        purpose: profile.purpose,
        now: Date.now(),
      },
    );
  }

  async setPhoto(telegramId: number, photoFileId: string): Promise<void> {
    await run(
      `MATCH (u:User { telegram_id: $telegramId }) SET u.photo_file_id = $photoFileId`,
      { telegramId, photoFileId },
    );
  }

  async listMatchable(): Promise<MatchableUser[]> {
    const result = await run(
      `MATCH (u:User)
       WHERE u.consent_granted = true
         AND u.name IS NOT NULL AND u.name <> ''
         AND u.city IS NOT NULL AND u.city <> ''
       OPTIONAL MATCH (u)-[:HAS_SUMMARY]->(s:Summary)
       WITH u, collect(s.interests) AS lists
       WITH u, reduce(acc = [], l IN lists | acc + l) AS interests
       RETURN u.telegram_id AS telegramId, u.username AS username, u.name AS name,
              u.city AS city, u.age AS age, u.purpose AS purpose,
              u.photo_file_id AS photoFileId, interests`,
    );
    return result.records.map((r) => ({
      telegramId: toNumber(r.get("telegramId")),
      username: (r.get("username") as string | null) ?? "",
      name: (r.get("name") as string | null) ?? "",
      city: (r.get("city") as string | null) ?? "",
      age: (r.get("age") as string | null) ?? "",
      purpose: (r.get("purpose") as string | null) ?? "",
      photoFileId: (r.get("photoFileId") as string | null) ?? undefined,
      interests: dedupeLower(r.get("interests")),
    }));
  }

  async deleteUser(telegramId: number): Promise<void> {
    await run(
      `MATCH (u:User { telegram_id: $telegramId })
       OPTIONAL MATCH (u)-[:HAS_SUMMARY]->(s:Summary)
       DETACH DELETE u, s`,
      { telegramId },
    );
  }
}
