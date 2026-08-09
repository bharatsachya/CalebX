CREATE TABLE photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  url text NOT NULL,
  visibility photo_visibility NOT NULL DEFAULT 'hidden',
  is_primary boolean NOT NULL DEFAULT false,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX photos_candidate_id_idx ON photos (candidate_id);

-- At most one primary photo per candidate.
CREATE UNIQUE INDEX photos_one_primary_per_candidate
  ON photos (candidate_id)
  WHERE is_primary;
