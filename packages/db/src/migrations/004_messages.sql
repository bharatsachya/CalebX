-- Raw WhatsApp log. The matchmaking product is a structured-form +
-- human-matchmaker flow, not a persona engine, and the matchmaker needs the
-- actual conversation to do their job.
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  wa_message_id text NOT NULL UNIQUE,
  direction message_direction NOT NULL,
  body text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_candidate_id_idx ON messages (candidate_id, created_at);
