-- The person being matched, merged with their account. Login identity is
-- wa_phone: there is no separate accounts table, the candidate row IS the account.
CREATE TABLE candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Login / account
  wa_phone text UNIQUE,
  telegram_id bigint UNIQUE,
  user_id_hash text UNIQUE,
  owner_type owner_type NOT NULL DEFAULT 'self',
  language text,
  last_active_at timestamptz,

  -- Biodata
  full_name text,
  gender text,
  dob date,
  birth_place text,
  city text,
  complexion text,
  height integer,
  marital_status marital_status CONSTRAINT candidate_not_married CHECK (marital_status IS NULL OR marital_status::text != 'married'),
  community text,
  highest_education text,
  occupation text,
  income_band text,
  diet text,
  father_name text,
  father_occupation text,
  mother_name text,
  mother_occupation text,
  brothers integer,
  brothers_married integer,
  sisters integer,
  sisters_married integer,

  state candidate_state NOT NULL DEFAULT 'active',
  -- Flexible extras that don't warrant a column yet.
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX candidates_state_idx ON candidates (state);
