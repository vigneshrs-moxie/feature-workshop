-- Team Telemetry (packet 2E): each laptop's usage numbers, gathered on the site so everyone on the
-- shared Claude account sees one picture of its limit. Numbers only: never text, prompts, file or
-- folder names. A row is one of
--   app          one line of the app's usage log (a Foreman turn's worker and model): the job's slug,
--                its stage, the model, the tokens by kind, the cost and both plan meters
--   claude-code  one Claude Code reply outside the app (packet U): the model family, tokens and cost
--   reading      one reading of the plan meters, with no use of its own
-- The person is the laptop's person on the site, never anything the laptop says. A line sent twice
-- (the link delivers at least once) keeps its first copy: the id is the laptop's own hash of it.

CREATE TABLE usage_lines (
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('app', 'claude-code', 'reading')),
  id text NOT NULL,
  -- The laptop it came from; a removed laptop's lines stay, since they are the account's use.
  runner_id bigint REFERENCES runners (id) ON DELETE SET NULL,
  t timestamptz NOT NULL,
  job text,
  stage text,
  -- app: the model id; claude-code: the model family.
  model text,
  input bigint NOT NULL DEFAULT 0,
  output bigint NOT NULL DEFAULT 0,
  cache_read bigint NOT NULL DEFAULT 0,
  cache_write_5m bigint NOT NULL DEFAULT 0,
  cache_write_1h bigint NOT NULL DEFAULT 0,
  usd double precision NOT NULL DEFAULT 0,
  week_percent double precision,
  week_resets_at timestamptz,
  five_hour_percent double precision,
  five_hour_resets_at timestamptz,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (person_id, kind, id)
);
CREATE INDEX usage_lines_t ON usage_lines (t);

-- What each laptop last said about its usage upload: whether its Claude Code use outside the app is
-- counted (counted, off, reading, not-sent), and when it last sent anything.
CREATE TABLE usage_sources (
  runner_id bigint PRIMARY KEY REFERENCES runners (id) ON DELETE CASCADE,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  claude_code text NOT NULL DEFAULT 'not-sent' CHECK (claude_code IN ('counted', 'off', 'reading', 'not-sent')),
  sent_at timestamptz NOT NULL
);
