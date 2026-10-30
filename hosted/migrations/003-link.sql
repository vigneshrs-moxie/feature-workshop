-- The link between a laptop's runner and the site (packet 2A step 4).

-- Commands for a runner, from REMOTE_COMMANDS only (dashboard/lib/protocol.js, checked again as
-- each is queued and as each is handed out). Delivered at least once: one handed out and not
-- answered within 30 seconds is handed out again, and the runner skips the ids it has done.
CREATE TABLE commands (
  id text PRIMARY KEY,
  runner_id bigint NOT NULL REFERENCES runners (id) ON DELETE CASCADE,
  command jsonb NOT NULL,
  queued_by bigint REFERENCES people (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  delivered_at timestamptz,
  deliveries int NOT NULL DEFAULT 0,
  done_at timestamptz,
  ok boolean,
  error text
);
CREATE INDEX commands_waiting ON commands (runner_id, created_at) WHERE done_at IS NULL;

-- What runners sent up, each checked again here against the "never carries" rule (plan §2.4).
-- eid is the runner's own id for the event, so a batch sent twice is stored once.
CREATE TABLE events (
  id bigserial PRIMARY KEY,
  runner_id bigint NOT NULL REFERENCES runners (id) ON DELETE CASCADE,
  eid text NOT NULL,
  type text NOT NULL,
  job text,
  data jsonb NOT NULL,
  received_at timestamptz NOT NULL,
  UNIQUE (runner_id, eid)
);
CREATE INDEX events_received ON events (runner_id, received_at);
