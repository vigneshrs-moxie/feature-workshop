-- What a command from the site may carry beyond the command itself (packet 2B), handed to the
-- runner with it: what a decision was made on (made_on, lib/made-on.js), who made it (by_name), and
-- for a live answer (a commit's diff) the public half of the asking request's key (answer_key).
ALTER TABLE commands ADD COLUMN made_on jsonb;
ALTER TABLE commands ADD COLUMN by_name text;
ALTER TABLE commands ADD COLUMN answer_key text;

-- A live answer on its way to the request that asked: sealed to that request's key (lib/sealed.js),
-- which only that request holds, in memory. Deleted as soon as it is collected, and after a minute
-- whatever happens, so a readable diff is never kept.
CREATE TABLE command_answers (
  command_id text PRIMARY KEY REFERENCES commands (id) ON DELETE CASCADE,
  sealed jsonb NOT NULL,
  at timestamptz NOT NULL
);
