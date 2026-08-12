-- Structured columns are hard gates a match must satisfy. looking_for /
-- pref_tags are soft ranking signals written by the LLM extraction step and
-- are never used to exclude a candidate outright.
CREATE TABLE partner_prefs (
  candidate_id uuid PRIMARY KEY REFERENCES candidates (id) ON DELETE CASCADE,

  -- Hard filters
  age_min integer,
  age_max integer,
  community_pref text,
  income_min integer,
  education_pref text,
  diet_pref text,

  -- Soft signals (LLM-written)
  looking_for text,
  pref_tags jsonb NOT NULL DEFAULT '[]'::jsonb,

  updated_at timestamptz NOT NULL DEFAULT now()
);
