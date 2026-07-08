import type { IRecommendationStore } from "@calebx/core";
import type {
  RecommendationRecord,
  RecommendationStatus,
  RecommendationView,
} from "@calebx/types";
import type { Record as Neo4jRecord } from "neo4j-driver";
import { run, toNumber } from "./driver.ts";

/**
 * A RECOMMENDED edge is stored directed (a)-[:RECOMMENDED]->(b); `a` is the start
 * node, `b` the end node. Every read/mutation below is gated on the caller being a
 * party to the edge — there is no query anywhere that returns a user the caller was
 * not explicitly recommended. This is the entire cross-user visibility boundary.
 */

const RETURN_CLAUSE = `RETURN r.id AS id, a.telegram_id AS aId, b.telegram_id AS bId,
       r.score AS score, r.shared AS shared, r.status AS status,
       r.a_accepted AS aAccepted, r.b_accepted AS bAccepted, r.created_at AS createdAt`;

function mapRecord(record: Neo4jRecord): RecommendationRecord {
  return {
    id: record.get("id") as string,
    aTelegramId: toNumber(record.get("aId")),
    bTelegramId: toNumber(record.get("bId")),
    score: Number(record.get("score")),
    shared: (record.get("shared") as string[] | null) ?? [],
    status: record.get("status") as RecommendationStatus,
    aAccepted: Boolean(record.get("aAccepted")),
    bAccepted: Boolean(record.get("bAccepted")),
    createdAt: toNumber(record.get("createdAt")),
  };
}

/** Edge-gated view relative to the requesting user (built by VIEW_RETURN below). */
const VIEW_RETURN = `WITH r,
       CASE WHEN a.telegram_id = $telegramId THEN b ELSE a END AS other,
       CASE WHEN a.telegram_id = $telegramId THEN r.a_accepted ELSE r.b_accepted END AS youAccepted,
       CASE WHEN a.telegram_id = $telegramId THEN r.b_accepted ELSE r.a_accepted END AS theyAccepted
     RETURN r.id AS id, r.score AS score, r.shared AS shared, r.status AS status,
            youAccepted, theyAccepted,
            other.telegram_id AS otherId, other.name AS name, other.age AS age,
            other.city AS city, other.username AS username, other.photo_file_id AS photoFileId,
            r.created_at AS createdAt`;

function mapView(record: Neo4jRecord): RecommendationView {
  const status = record.get("status") as RecommendationStatus;
  const view: RecommendationView = {
    id: record.get("id") as string,
    score: Number(record.get("score")),
    shared: (record.get("shared") as string[] | null) ?? [],
    status,
    youAccepted: Boolean(record.get("youAccepted")),
    theyAccepted: Boolean(record.get("theyAccepted")),
    other: {
      telegramId: toNumber(record.get("otherId")),
      name: (record.get("name") as string | null) ?? "",
      age: (record.get("age") as string | null) ?? "",
      city: (record.get("city") as string | null) ?? "",
    },
  };
  // Contact-level fields are exposed ONLY after mutual acceptance.
  if (status === "revealed") {
    view.reveal = {
      username: (record.get("username") as string | null) ?? "",
      photoFileId: (record.get("photoFileId") as string | null) ?? undefined,
    };
  }
  return view;
}

export class Neo4jRecommendationStore implements IRecommendationStore {
  async create(
    aTelegramId: number,
    bTelegramId: number,
    score: number,
    shared: string[],
  ): Promise<RecommendationRecord> {
    const id = `rec_${aTelegramId}_${bTelegramId}_${Date.now()}`;
    const result = await run(
      `MATCH (a:User { telegram_id: $aTelegramId }), (b:User { telegram_id: $bTelegramId })
       CREATE (a)-[r:RECOMMENDED {
         id: $id, score: $score, shared: $shared, status: 'pending',
         a_accepted: false, b_accepted: false, created_at: $now
       }]->(b)
       ${RETURN_CLAUSE}`,
      { aTelegramId, bTelegramId, id, score, shared, now: Date.now() },
    );
    return mapRecord(result.records[0]!);
  }

  async existingPairKeys(): Promise<Set<string>> {
    const result = await run(
      `MATCH (a:User)-[r:RECOMMENDED]->(b:User)
       RETURN a.telegram_id AS aId, b.telegram_id AS bId`,
    );
    const keys = new Set<string>();
    for (const record of result.records) {
      const a = toNumber(record.get("aId"));
      const b = toNumber(record.get("bId"));
      keys.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
    return keys;
  }

  async listForUser(telegramId: number): Promise<RecommendationView[]> {
    const result = await run(
      `MATCH (a:User)-[r:RECOMMENDED]->(b:User)
       WHERE (a.telegram_id = $telegramId OR b.telegram_id = $telegramId)
         AND r.status <> 'declined'
       ${VIEW_RETURN}
       ORDER BY r.created_at DESC`,
      { telegramId },
    );
    return result.records.map(mapView);
  }

  async accept(
    id: string,
    telegramId: number,
  ): Promise<RecommendationView | null> {
    const result = await run(
      `MATCH (a:User)-[r:RECOMMENDED { id: $id }]->(b:User)
       WHERE a.telegram_id = $telegramId OR b.telegram_id = $telegramId
       SET r.a_accepted = CASE WHEN a.telegram_id = $telegramId THEN true ELSE r.a_accepted END,
           r.b_accepted = CASE WHEN b.telegram_id = $telegramId THEN true ELSE r.b_accepted END
       WITH a, b, r, (r.a_accepted AND r.b_accepted) AS both
       SET r.status = CASE WHEN both THEN 'revealed' ELSE r.status END
       ${VIEW_RETURN}`,
      { id, telegramId },
    );
    if (result.records.length === 0) return null;
    return mapView(result.records[0]!);
  }

  async decline(id: string, telegramId: number): Promise<boolean> {
    const result = await run(
      `MATCH (a:User)-[r:RECOMMENDED { id: $id }]->(b:User)
       WHERE a.telegram_id = $telegramId OR b.telegram_id = $telegramId
       SET r.status = 'declined'
       RETURN r.id AS id`,
      { id, telegramId },
    );
    return result.records.length > 0;
  }
}
