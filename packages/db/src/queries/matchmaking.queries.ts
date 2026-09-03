import { SQL_BULK_MARKER } from "@calebx/authz";

/**
 * Matchmaking SQL, kept out of the repository for the same reason
 * `candidate.queries.ts` is: a 300-line file mixing statements and logic is one
 * where nobody reads the statements.
 */
export const PREFS_COLUMNS = `
  candidate_id, age_min, age_max, community_pref, income_min,
  education_pref, diet_pref, looking_for, pref_tags
`;

export const SELECT_PREFS = `
SELECT ${PREFS_COLUMNS}
FROM partner_prefs p
JOIN candidates c ON c.id = p.candidate_id
WHERE c.user_id_hash = $1
`;

/**
 * Upsert of only the fields supplied.
 *
 * `coalesce(EXCLUDED.x, partner_prefs.x)` rather than a full replace: the agent
 * updates one preference at a time from conversation, and a full replace would
 * silently blank every preference the user did not mention in that turn.
 */
export const UPSERT_PREFS = `
INSERT INTO partner_prefs (
  candidate_id, age_min, age_max, community_pref, income_min,
  education_pref, diet_pref, looking_for, pref_tags, updated_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
ON CONFLICT (candidate_id) DO UPDATE SET
  age_min        = coalesce(EXCLUDED.age_min, partner_prefs.age_min),
  age_max        = coalesce(EXCLUDED.age_max, partner_prefs.age_max),
  community_pref = coalesce(EXCLUDED.community_pref, partner_prefs.community_pref),
  income_min     = coalesce(EXCLUDED.income_min, partner_prefs.income_min),
  education_pref = coalesce(EXCLUDED.education_pref, partner_prefs.education_pref),
  diet_pref      = coalesce(EXCLUDED.diet_pref, partner_prefs.diet_pref),
  looking_for    = coalesce(EXCLUDED.looking_for, partner_prefs.looking_for),
  pref_tags      = coalesce(EXCLUDED.pref_tags, partner_prefs.pref_tags),
  updated_at     = now()
RETURNING ${PREFS_COLUMNS}
`;

export const MATCH_COLUMNS = `
  id, candidate_a, candidate_b, stage, status_a, status_b, reason, score
`;

export const LIST_MATCHES = `
SELECT ${MATCH_COLUMNS}
FROM matches m
JOIN candidates c ON c.id IN (m.candidate_a, m.candidate_b)
WHERE c.user_id_hash = $1
ORDER BY m.created_at DESC
LIMIT $2
`;

export const UPSERT_MATCH = `${SQL_BULK_MARKER}
INSERT INTO matches (candidate_a, candidate_b, source, reason, score)
VALUES ($1, $2, 'algo', $3, $4)
ON CONFLICT (candidate_a, candidate_b) DO UPDATE
  SET reason = coalesce(EXCLUDED.reason, matches.reason)
RETURNING ${MATCH_COLUMNS}
`;

export const SET_STATUS_A = `${SQL_BULK_MARKER}
UPDATE matches SET status_a = $2 WHERE id = $1 RETURNING ${MATCH_COLUMNS}
`;

export const SET_STATUS_B = `${SQL_BULK_MARKER}
UPDATE matches SET status_b = $2 WHERE id = $1 RETURNING ${MATCH_COLUMNS}
`;

export const SET_STAGE = `${SQL_BULK_MARKER}
UPDATE matches SET stage = $2 WHERE id = $1 RETURNING ${MATCH_COLUMNS}
`;
