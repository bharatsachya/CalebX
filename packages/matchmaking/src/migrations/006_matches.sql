-- v1 matches are created by hand through the internal admin (see PR9) — there
-- is no algorithmic matcher. `reason` is human-written and is what the parent
-- actually reads.
CREATE TABLE matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_a uuid NOT NULL REFERENCES candidates (id),
  candidate_b uuid NOT NULL REFERENCES candidates (id),

  source match_source NOT NULL DEFAULT 'manual',
  algo_version text,
  score integer,
  reason text,

  status_a match_status NOT NULL DEFAULT 'pending',
  status_b match_status NOT NULL DEFAULT 'pending',
  stage match_stage NOT NULL DEFAULT 'suggested',

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Canonical ordering makes the pair-uniqueness constraint below possible
  -- without a second (b, a) row, and is enforced at the repository layer too.
  CONSTRAINT matches_candidate_order CHECK (candidate_a < candidate_b),
  CONSTRAINT matches_pair_unique UNIQUE (candidate_a, candidate_b)
);

CREATE INDEX matches_candidate_a_idx ON matches (candidate_a);
CREATE INDEX matches_candidate_b_idx ON matches (candidate_b);
