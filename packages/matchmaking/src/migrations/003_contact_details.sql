-- SENSITIVE. Must never appear in any candidate or match payload sent to
-- another user — released only on mutual interest, and that release is a
-- manual admin step (see PR12), never automatic.
CREATE TABLE contact_details (
  candidate_id uuid PRIMARY KEY REFERENCES candidates (id) ON DELETE CASCADE,
  phone text,
  email text,
  address text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
