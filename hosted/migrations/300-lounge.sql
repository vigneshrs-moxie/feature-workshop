-- The Lounge (packet 2D, decision G13): when each person last had the site open. A session's own
-- last_seen_at is written at most once an hour (site/sessions.js), too coarse to say whether someone
-- is around now, so the Lounge keeps this one time per person, written by GET /api/lounge (at most
-- once a minute; the page asks only while it is in view). Nothing else: no page, no history.
-- Times are written by the site from its own clock, so they are always given, never defaulted.

CREATE TABLE lounge_seen (
  person_id bigint PRIMARY KEY REFERENCES people (id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL
);
