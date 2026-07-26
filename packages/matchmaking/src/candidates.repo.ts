import { getPool, queryOne } from "./db.ts";
import type { Candidate } from "./types.ts";

/**
 * Finds the candidate for a WhatsApp number, creating a bare row (just the
 * phone) if this is their first contact. A candidate exists in the DB before
 * consent is granted — the row itself carries no biodata until they accept.
 */
export async function findOrCreateByPhone(waPhone: string): Promise<Candidate> {
  const existing = await queryOne<Candidate>(
    "SELECT * FROM candidates WHERE wa_phone = $1",
    [waPhone],
  );
  if (existing) return existing;

  // Concurrent first messages from the same number could race here; the
  // unique constraint on wa_phone makes the loser re-select instead of
  // duplicating a row.
  const pool = getPool();
  try {
    const inserted = await pool.query<Candidate>(
      "INSERT INTO candidates (wa_phone) VALUES ($1) RETURNING *",
      [waPhone],
    );
    return inserted.rows[0];
  } catch (error) {
    const again = await queryOne<Candidate>(
      "SELECT * FROM candidates WHERE wa_phone = $1",
      [waPhone],
    );
    if (again) return again;
    throw error;
  }
}

export async function setConsent(
  candidateId: string,
  granted: boolean,
): Promise<void> {
  await getPool().query(
    `UPDATE candidates
     SET consent_granted = $2, consent_at = CASE WHEN $2 THEN now() ELSE consent_at END
     WHERE id = $1`,
    [candidateId, granted],
  );
}

export async function getById(id: string): Promise<Candidate | null> {
  return queryOne<Candidate>("SELECT * FROM candidates WHERE id = $1", [id]);
}
