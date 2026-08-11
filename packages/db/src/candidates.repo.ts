import { query, queryOne } from "./db.ts";
import * as Q from "./queries/candidate.queries.ts";
import type { Candidate, MaritalStatus } from "./types.ts";

/**
 * Validates that candidate marital status is allowed for matchmaking.
 * Married individuals cannot sign up as candidates.
 */
export function validateMaritalStatus(status: string | null): void {
  if (status && status.trim().toLowerCase() === "married") {
    throw new Error(
      "[db] Married individuals cannot sign up as matchmaking candidates.",
    );
  }
}

/**
 * Finds the candidate for a WhatsApp number, creating a bare row if first contact.
 */
export async function findOrCreateByPhone(waPhone: string): Promise<Candidate> {
  const existing = await queryOne<Candidate>(Q.SELECT_CANDIDATE_BY_PHONE, [
    waPhone,
  ]);
  if (existing) return existing;

  try {
    const inserted = await query<Candidate>(Q.INSERT_CANDIDATE_BY_PHONE, [
      waPhone,
    ]);
    return inserted[0];
  } catch (error) {
    const again = await queryOne<Candidate>(Q.SELECT_CANDIDATE_BY_PHONE, [
      waPhone,
    ]);
    if (again) return again;
    throw error;
  }
}

/**
 * Finds or creates a candidate by Telegram ID.
 */
export async function findOrCreateByTelegramId(
  telegramId: number | string,
): Promise<Candidate> {
  const numericId =
    typeof telegramId === "string" ? parseInt(telegramId, 10) : telegramId;
  const existing = await queryOne<Candidate>(
    Q.SELECT_CANDIDATE_BY_TELEGRAM_ID,
    [numericId],
  );
  if (existing) return existing;

  try {
    const inserted = await query<Candidate>(Q.INSERT_CANDIDATE_BY_TELEGRAM_ID, [
      numericId,
    ]);
    return inserted[0];
  } catch (error) {
    const again = await queryOne<Candidate>(Q.SELECT_CANDIDATE_BY_TELEGRAM_ID, [
      numericId,
    ]);
    if (again) return again;
    throw error;
  }
}

/**
 * Finds or creates a candidate by SHA-256 user ID hash.
 */
export async function findOrCreateByUserIdHash(
  userIdHash: string,
): Promise<Candidate> {
  const existing = await queryOne<Candidate>(
    Q.SELECT_CANDIDATE_BY_USER_ID_HASH,
    [userIdHash],
  );
  if (existing) return existing;

  try {
    const inserted = await query<Candidate>(
      Q.INSERT_CANDIDATE_BY_USER_ID_HASH,
      [userIdHash],
    );
    return inserted[0];
  } catch (error) {
    const again = await queryOne<Candidate>(
      Q.SELECT_CANDIDATE_BY_USER_ID_HASH,
      [userIdHash],
    );
    if (again) return again;
    throw error;
  }
}

export async function setConsent(
  candidateId: string,
  granted: boolean,
): Promise<void> {
  await query(Q.UPDATE_CANDIDATE_CONSENT, [candidateId, granted]);
}

export async function getById(id: string): Promise<Candidate | null> {
  return queryOne<Candidate>(Q.SELECT_CANDIDATE_BY_ID, [id]);
}
