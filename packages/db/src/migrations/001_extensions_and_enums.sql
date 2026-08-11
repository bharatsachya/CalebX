-- pgcrypto backfills gen_random_uuid() on Postgres < 13; a no-op on newer versions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE owner_type AS ENUM ('self', 'family');
CREATE TYPE candidate_state AS ENUM ('active', 'paused', 'married', 'withdrawn');
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE match_source AS ENUM ('manual', 'algo');
CREATE TYPE match_status AS ENUM ('pending', 'interested', 'declined');
CREATE TYPE match_stage AS ENUM (
  'suggested',
  'mutual_interest',
  'contact_shared',
  'meeting',
  'progressing',
  'closed'
);
CREATE TYPE photo_visibility AS ENUM ('hidden', 'on_mutual_interest', 'public');
CREATE TYPE marital_status AS ENUM ('never_married', 'single', 'divorced', 'widowed');
