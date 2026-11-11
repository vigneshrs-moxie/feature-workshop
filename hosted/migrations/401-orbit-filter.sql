-- The Inbox lists only tickets assigned to the person. Orbit can set the "assigned to me" filter
-- aside for a token (its answer names the filter in `ignored`), and then what it sends is everyone's
-- tickets. The poller writes this on every read: true while Orbit does not apply the filter, false
-- after a clean read, and the Inbox shows no tickets while it is true. `orbit_audience` is who
-- Orbit says the token reads as (tech or participant), kept for the line the Inbox says about it.
-- Both have defaults, so this is safe to run before the code that writes them is released.

ALTER TABLE orbit_tokens ADD COLUMN IF NOT EXISTS assignee_ignored boolean NOT NULL DEFAULT false;
ALTER TABLE orbit_tokens ADD COLUMN IF NOT EXISTS orbit_audience text NOT NULL DEFAULT 'tech';
