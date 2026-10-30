-- The first mirror: each person's jobs, one row per job on each of their laptops (packet 2A step 5).
-- Filled from the runner's job-list (all of them, replacing what was there) and status events
-- (one job). Only these fields cross: nothing of a job's code, diff, files or conversation.

CREATE TABLE jobs (
  id bigserial PRIMARY KEY,
  runner_id bigint NOT NULL REFERENCES runners (id) ON DELETE CASCADE,
  -- The laptop's person, kept here so every read is "WHERE person_id = me".
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  ticket_key text,
  stage text,
  state text,
  state_words text,
  now_line text,
  updated_at timestamptz,
  mirrored_at timestamptz NOT NULL,
  UNIQUE (runner_id, slug)
);
CREATE INDEX jobs_person ON jobs (person_id);
