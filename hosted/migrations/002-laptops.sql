-- Laptops (their runners) and pairing them (packet 2A step 3).

-- A paired laptop's runner, for one person. Only the SHA-256 of its token is kept; a removed laptop
-- keeps its row (for the record) with no token, so it can't call in again.
CREATE TABLE runners (
  id bigserial PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  -- A random id the laptop made for itself (not a secret): a new login on the same laptop
  -- rotates this runner's token instead of adding a second laptop.
  device_id text NOT NULL,
  name text NOT NULL,
  os text NOT NULL,
  version text NOT NULL DEFAULT '',
  token_hash text UNIQUE,
  paired_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX runners_person_device ON runners (person_id, device_id) WHERE revoked_at IS NULL;
CREATE INDEX runners_person ON runners (person_id);

-- `ground-control login` asking to pair: the short code both sides show, the laptop's long secret
-- (by its SHA-256) it polls with, and who said yes. Ten minutes, once.
CREATE TABLE pairings (
  id bigserial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  secret_hash text NOT NULL UNIQUE,
  device_id text NOT NULL,
  name text NOT NULL,
  os text NOT NULL,
  version text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  approved_by bigint REFERENCES people (id) ON DELETE CASCADE,
  approved_at timestamptz,
  finished_at timestamptz,
  runner_id bigint REFERENCES runners (id) ON DELETE SET NULL
);
