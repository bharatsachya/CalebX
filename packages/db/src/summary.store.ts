import type { ISummaryStore } from "@calebx/core";
import type { SummaryRecord } from "@calebx/types";
import { run, toNumber } from "./driver.ts";

export class Neo4jSummaryStore implements ISummaryStore {
  async addSummary(
    telegramId: number,
    text: string,
    interests: string[],
  ): Promise<void> {
    const id = `sum_${telegramId}_${Date.now()}`;
    await run(
      `MATCH (u:User { telegram_id: $telegramId })
       CREATE (s:Summary { id: $id, text: $text, interests: $interests, created_at: $now })
       CREATE (u)-[:HAS_SUMMARY]->(s)`,
      {
        telegramId,
        id,
        text,
        interests: interests.map((i) => i.trim().toLowerCase()).filter(Boolean),
        now: Date.now(),
      },
    );
  }

  async getSummaries(
    telegramId: number,
    limit: number,
  ): Promise<SummaryRecord[]> {
    const result = await run(
      `MATCH (u:User { telegram_id: $telegramId })-[:HAS_SUMMARY]->(s:Summary)
       RETURN s.id AS id, s.text AS text, s.interests AS interests, s.created_at AS created_at
       ORDER BY s.created_at DESC
       LIMIT toInteger($limit)`,
      { telegramId, limit },
    );
    return result.records.map((r) => ({
      id: r.get("id") as string,
      text: r.get("text") as string,
      interests: (r.get("interests") as string[] | null) ?? [],
      created_at: toNumber(r.get("created_at")),
    }));
  }
}
