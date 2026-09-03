-- Phase 1 of the agent engine: mode assignment, per-mode consent, pgvector
-- candidate search, the human-review queue, and the cohort→group registry.
--
-- pgvector must be available on the host. This statement fails loudly rather
-- than the migration silently skipping the vector column and every candidate
-- search returning nothing.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE agent_mode AS ENUM ('matchmaker', 'community_connector');

CREATE TYPE review_kind AS ENUM (
  'create_group',
  'mutual_interest',
  'contact_share',
  'agent_escalation'
);

CREATE TYPE review_state AS ENUM ('open', 'approved', 'declined');

-- One row per namespaced user id ("tg:123", "wa:4477...").
--
-- `active_mode` is which subagent handles their turns now; `enrolled_modes` is
-- every mode they have a profile and a consent grant for. Assignment is not
-- one-way — /switch moves active_mode — but entering a mode for the first time
-- requires that mode's own consent, because the two collect different data.
CREATE TABLE agent_users (
  user_id        text PRIMARY KEY,
  active_mode    agent_mode,
  enrolled_modes agent_mode[] NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_active    timestamptz NOT NULL DEFAULT now()
);

-- Consent is per mode, not per user. Deleting the row revokes it; /forget
-- deletes both this and agent_users, so the router runs again from scratch.
CREATE TABLE mode_consent (
  user_id    text NOT NULL REFERENCES agent_users(user_id) ON DELETE CASCADE,
  mode       agent_mode NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mode)
);

-- Matchmaking similarity search.
--
-- Only the soft, free-text part of a preference is embedded. Age, city, diet,
-- community and marital status are hard SQL filters — embedding a structured
-- field and hoping cosine respects it is how a "must be in Bengaluru" turns
-- into a suggestion in Pune.
--
-- 384 dimensions comes from @calebx/embed (bge-small-en-v1.5). The constant is
-- asserted against this migration in a unit test, so the two cannot drift.
ALTER TABLE candidates
  ADD COLUMN interest_text      text,
  ADD COLUMN interest_embedding vector(384),
  ADD COLUMN discoverable       boolean NOT NULL DEFAULT false;

CREATE INDEX candidates_interest_hnsw
  ON candidates USING hnsw (interest_embedding vector_cosine_ops);

-- The human-in-the-loop queue. One table for every kind of escalation so there
-- is a single surface to work, and a single place to look when something is
-- stuck. `payload` carries kind-specific detail rather than one nullable column
-- per kind.
CREATE TABLE review_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        review_kind  NOT NULL,
  state       review_state NOT NULL DEFAULT 'open',
  user_id     text,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text
);

CREATE INDEX review_tasks_open_idx ON review_tasks (state, created_at)
  WHERE state = 'open';

-- Cohort → Telegram group.
--
-- A bot cannot create a Telegram group (the Bot API has no method; creation
-- needs a user account, which is the MTProto path CLAUDE.md §6.3 bans). So a
-- cohort is registered here first with group_id NULL, an admin creates the group
-- and adds the bot, and /register_group fills in the id and invite link.
CREATE TABLE cohort_groups (
  cohort_key  text PRIMARY KEY,
  group_id    text UNIQUE,
  invite_link text,
  title       text,
  member_hint integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  registered_at timestamptz
);
