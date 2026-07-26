-- The consent gate (packages/whatsapp-bot) must run before anything else
-- touches a candidate's data. Tracked as columns on candidates itself rather
-- than a separate ledger — one database, one source of truth.
ALTER TABLE candidates
  ADD COLUMN consent_granted boolean NOT NULL DEFAULT false,
  ADD COLUMN consent_at timestamptz;
