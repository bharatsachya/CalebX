/**
 * SQL queries for the candidates table.
 * Keeps SQL queries decoupled from repository code.
 */

export const SELECT_CANDIDATE_BY_PHONE = `
  SELECT * FROM candidates WHERE wa_phone = $1
`;

export const INSERT_CANDIDATE_BY_PHONE = `
  INSERT INTO candidates (wa_phone) VALUES ($1) RETURNING *
`;

export const SELECT_CANDIDATE_BY_TELEGRAM_ID = `
  SELECT * FROM candidates WHERE telegram_id = $1
`;

export const INSERT_CANDIDATE_BY_TELEGRAM_ID = `
  INSERT INTO candidates (telegram_id) VALUES ($1) RETURNING *
`;

export const SELECT_CANDIDATE_BY_USER_ID_HASH = `
  SELECT * FROM candidates WHERE user_id_hash = $1
`;

export const INSERT_CANDIDATE_BY_USER_ID_HASH = `
  INSERT INTO candidates (user_id_hash) VALUES ($1) RETURNING *
`;

export const UPDATE_CANDIDATE_CONSENT = `
  UPDATE candidates
  SET consent_granted = $2, consent_at = CASE WHEN $2 THEN now() ELSE consent_at END
  WHERE id = $1
`;

export const SELECT_CANDIDATE_BY_ID = `
  SELECT * FROM candidates WHERE id = $1
`;
