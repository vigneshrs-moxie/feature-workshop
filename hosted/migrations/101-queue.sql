-- Queued decisions (packet 2B): Go / No go, a reply, send back, stop, allow or deny a permission,
-- and merge next on a stack, made on the site. Each carries what it was made on (the gate's brief
-- mark, the permission's id, the stack's next part). While the laptop is off it waits here; when the
-- laptop is back and has sent its record, it is checked against that record and handed to the
-- runner in order (as a command, site/routes-runner.js), or marked changed if the job moved on.
--   state: waiting (for the laptop) · sent (handed to the runner) · done · failed · changed (the job
--          moved on: nothing ran) · cancelled (by you, before it was sent) · expired (a permission
--          that ran out first)

CREATE TABLE decisions (
  id text PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  runner_id bigint NOT NULL REFERENCES runners (id) ON DELETE CASCADE,
  job text NOT NULL,
  kind text NOT NULL,
  command jsonb NOT NULL,
  made_on jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('waiting', 'sent', 'done', 'failed', 'changed', 'cancelled', 'expired')),
  command_id text,
  expires_at timestamptz,
  error text,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  done_at timestamptz,
  -- Put away by you ("Got it" on a changed or failed one): the cards stop showing it.
  dismissed_at timestamptz
);
CREATE INDEX decisions_runner ON decisions (runner_id, state, created_at);
CREATE INDEX decisions_person ON decisions (person_id, job);

-- The site's copy of every decision, from either side: who, from where (laptop or site), when, what
-- it was made on and how it ended. Rows from the laptop come up as audit events.
CREATE TABLE audit (
  id bigserial PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  runner_id bigint REFERENCES runners (id) ON DELETE SET NULL,
  at timestamptz NOT NULL,
  who text NOT NULL,
  from_where text NOT NULL CHECK (from_where IN ('site', 'laptop')),
  action text NOT NULL,
  job text,
  made_on jsonb,
  outcome text,
  decision_id text,
  -- The laptop's own id for a line it sent up, so a line sent twice is kept once.
  eid text,
  UNIQUE (runner_id, eid)
);
CREATE INDEX audit_person ON audit (person_id, at);
