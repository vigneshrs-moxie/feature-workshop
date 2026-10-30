-- The full mirror (packet 2B): each laptop's job record as the laptop shows it now, one row per
-- part (its kind and key): the board, each open job, its documents, decisions and evidence, the
-- stacks and their parts. Every value passed the "never carries" check (site/events.js) on the way
-- in. A part the laptop says is gone is deleted, and a removed laptop takes its rows with it.

CREATE TABLE records (
  runner_id bigint NOT NULL REFERENCES runners (id) ON DELETE CASCADE,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  kind text NOT NULL,
  key text NOT NULL,
  -- The job it belongs to (its slug), when it is about one job: so a job's parts go with it.
  job text,
  value jsonb NOT NULL,
  hash text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (runner_id, kind, key)
);
CREATE INDEX records_person ON records (person_id, kind);

-- When each laptop last sent its whole record after connecting (its "synced" mark): until then,
-- queued decisions for it wait, so they are never checked against an old copy.
CREATE TABLE record_syncs (
  runner_id bigint PRIMARY KEY REFERENCES runners (id) ON DELETE CASCADE,
  synced_at timestamptz NOT NULL,
  hello_at timestamptz NOT NULL
);

-- What changed for a person, numbered: the site's live stream (/api/events) sends these in order,
-- and a browser that comes back says the last number it had (Last-Event-ID). A week is kept.
CREATE TABLE site_events (
  seq bigserial PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  type text NOT NULL,
  job text,
  data jsonb NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX site_events_person ON site_events (person_id, seq);
