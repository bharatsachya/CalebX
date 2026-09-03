import {
  assertAuthorized,
  filterAuthorized,
  project,
  scopedSql,
  SQL_DISCOVERABLE_MARKER,
  type Principal,
} from "@calebx/authz";
import { EMBEDDING_DIMENSIONS, type Embedding } from "@calebx/embed";
import { ValidationError } from "@calebx/errors";
import { poolExecutor, type SqlExecutor } from "./executor.ts";

/**
 * Matchmaking candidate search: hard SQL filters + pgvector over interest text.
 *
 * The split is the whole design. Age, city, marital status, community and diet
 * are *constraints* — a user who says "must be in Bengaluru" means it, and
 * embedding that alongside their free text produces a suggestion in Pune with a
 * plausible-looking score. Only the soft part ("someone easygoing who travels")
 * goes through the vector, and both sides of that comparison are interest text
 * run through the same model, which is what makes the cosine meaningful.
 */

export interface CandidateCriteria {
  /** The seeker's own candidate row id, excluded from results. */
  selfCandidateId: string;
  /** Embedded interest text. Optional: filters alone are a valid search. */
  embedding?: Embedding;
  minAge?: number;
  maxAge?: number;
  cities?: string[];
  gender?: string;
  community?: string;
  diet?: string;
  maritalStatuses?: string[];
  limit?: number;
}

export interface CandidateMatch {
  id: string;
  userId: string | null;
  city: string | null;
  age: number | null;
  community: string | null;
  occupation: string | null;
  highestEducation: string | null;
  diet: string | null;
  interestText: string | null;
  /** Cosine similarity, or null when the search had no vector. */
  similarity: number | null;
}

interface CandidateRow {
  id: string;
  user_id_hash: string | null;
  city: string | null;
  age: number | null;
  community: string | null;
  occupation: string | null;
  highest_education: string | null;
  diet: string | null;
  interest_text: string | null;
  similarity: number | null;
  discoverable: boolean;
}

/**
 * Built rather than templated so every value is a bound parameter. The
 * `discoverable` predicate is not optional and not caller-supplied — it is the
 * consent boundary, and `assertSqlScoped` refuses this marker without it.
 */
function buildSearch(criteria: CandidateCriteria): {
  sql: string;
  params: unknown[];
} {
  const params: unknown[] = [criteria.selfCandidateId];
  const where = [
    "discoverable = true",
    "state = 'active'",
    "consent_granted = true",
    "id <> $1",
  ];

  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (criteria.minAge !== undefined) {
    where.push(`date_part('year', age(dob)) >= ${bind(criteria.minAge)}`);
  }
  if (criteria.maxAge !== undefined) {
    where.push(`date_part('year', age(dob)) <= ${bind(criteria.maxAge)}`);
  }
  if (criteria.cities?.length) {
    where.push(`city = ANY(${bind(criteria.cities)})`);
  }
  if (criteria.gender !== undefined) {
    where.push(`gender = ${bind(criteria.gender)}`);
  }
  if (criteria.community !== undefined) {
    where.push(`community = ${bind(criteria.community)}`);
  }
  if (criteria.diet !== undefined) {
    where.push(`diet = ${bind(criteria.diet)}`);
  }
  if (criteria.maritalStatuses?.length) {
    where.push(
      `marital_status = ANY(${bind(criteria.maritalStatuses)}::marital_status[])`,
    );
  }

  const hasVector = criteria.embedding !== undefined;
  // pgvector takes its literal as a string; the driver cannot infer the type
  // from a JS array, so it is bound as text and cast.
  const vectorParam = hasVector
    ? bind(`[${criteria.embedding!.join(",")}]`)
    : null;
  where.push("interest_embedding IS NOT NULL");

  const similarity = hasVector
    ? `1 - (interest_embedding <=> ${vectorParam}::vector)`
    : "NULL";
  const order = hasVector
    ? `interest_embedding <=> ${vectorParam}::vector ASC`
    : "last_active_at DESC NULLS LAST";

  const limitParam = bind(criteria.limit ?? 10);

  return {
    sql: `${SQL_DISCOVERABLE_MARKER}
SELECT id, user_id_hash, city,
       date_part('year', age(dob))::int AS age,
       community, occupation, highest_education, diet, interest_text,
       discoverable,
       ${similarity} AS similarity
FROM candidates
WHERE ${where.join("\n  AND ")}
ORDER BY ${order}
LIMIT ${limitParam}`,
    params,
  };
}

function toMatch(row: Partial<CandidateRow>): CandidateMatch {
  return {
    id: String(row.id),
    userId: row.user_id_hash ?? null,
    city: row.city ?? null,
    age: row.age ?? null,
    community: row.community ?? null,
    occupation: row.occupation ?? null,
    highestEducation: row.highest_education ?? null,
    diet: row.diet ?? null,
    interestText: row.interest_text ?? null,
    similarity: row.similarity ?? null,
  };
}

export class CandidateSearchRepository {
  constructor(private readonly executor: SqlExecutor = poolExecutor) {}

  /**
   * Returns anonymized matches.
   *
   * Two independent guards apply: the SQL may only see rows where
   * `discoverable = true` (enforced by the scope checker, not by convention),
   * and every returned row goes back through `filterAuthorized` so the
   * projection is applied rather than assumed. The second is not redundant — it
   * is what catches a future edit to the query that widens what comes back.
   */
  async search(
    principal: Principal,
    criteria: CandidateCriteria,
  ): Promise<CandidateMatch[]> {
    // "May this principal search matchmaking candidates at all?" — asked before
    // the query rather than left to the per-row filter, because a cross-mode or
    // system caller getting an empty list back looks like "no matches" instead
    // of "you should not be here".
    assertAuthorized(principal, "read", {
      kind: "candidate",
      ownerId: principal.kind === "user" ? principal.userId : null,
      mode: "matchmaker",
    });

    if (
      criteria.embedding !== undefined &&
      criteria.embedding.length !== EMBEDDING_DIMENSIONS
    ) {
      throw new ValidationError(
        `interest embedding must have ${EMBEDDING_DIMENSIONS} dimensions, got ${criteria.embedding.length}`,
      );
    }

    const { sql, params } = buildSearch(criteria);
    const rows = await scopedSql(this.executor, principal).query<CandidateRow>(
      sql,
      params,
    );

    return filterAuthorized(principal, "read_anonymized", rows, (row) => ({
      kind: "candidate",
      ownerId: row.user_id_hash ?? `candidate:${row.id}`,
      mode: "matchmaker",
      discoverable: row.discoverable,
    })).map(({ item, decision }) =>
      toMatch(
        project(
          item as unknown as Record<string, unknown>,
          decision.projection,
        ) ?? {},
      ),
    );
  }
}
