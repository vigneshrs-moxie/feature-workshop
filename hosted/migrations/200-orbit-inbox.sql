-- The Orbit inbox on the site (packet 2C, decision G11): each person's read-only Orbit token, kept
-- encrypted, and the tickets the poller read with it. Times are written by the site from its own
-- clock, so they are always given, never defaulted.

-- One token per person, sealed with AES-256-GCM under TOKEN_KEY (hosted/lib/token-store.js):
-- `sealed` is v1.<key id>.<iv>.<ciphertext>.<tag>, bound to this person's id, never the token
-- itself. No route returns `sealed`; only the poller opens it, for this person's inbox.
-- The rest is the poller's own state for this person.
CREATE TABLE orbit_tokens (
  person_id bigint PRIMARY KEY REFERENCES people (id) ON DELETE CASCADE,
  sealed text NOT NULL,
  -- Which TOKEN_KEY sealed it (a hash of the key, not the key), so the key can be rotated later.
  key_id text NOT NULL,
  saved_at timestamptz NOT NULL,
  -- What the person said when they pasted it (7, 30 or 90 days), or not known.
  expires_at timestamptz,
  -- Orbit refused it (401: expired or revoked), or this site's key can't open it any more.
  refused_at timestamptz,
  -- The last read that worked (its start), and the last full read (not only what changed).
  polled_at timestamptz,
  full_at timestamptz,
  -- The last read, good or not: also the claim that stops two reads of one inbox at once.
  tried_at timestamptz,
  error text,
  error_kind text,
  -- Orbit asked to slow down (429 with Retry-After): no read before this.
  wait_until timestamptz
);

-- One row per ticket per person: the fields the Inbox shows (lib/orbit.js inboxItem, plus the
-- description cut short), already scrubbed of anything shaped like a token.
CREATE TABLE orbit_inbox (
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  number integer NOT NULL,
  ticket_key text NOT NULL,
  item jsonb NOT NULL,
  changed_at timestamptz,
  stored_at timestamptz NOT NULL,
  PRIMARY KEY (person_id, number)
);

-- Start on a ticket from the site: the start command queued for one of the person's laptops
-- (site/routes-runner.js queueCommand). Whether it was handed out and how it went is the command's.
CREATE TABLE inbox_starts (
  id bigserial PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  ticket_key text NOT NULL,
  runner_id bigint NOT NULL REFERENCES runners (id) ON DELETE CASCADE,
  command_id text REFERENCES commands (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX inbox_starts_person ON inbox_starts (person_id, ticket_key, created_at);
