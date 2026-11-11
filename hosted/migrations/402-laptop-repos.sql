-- A laptop says which repositories it has registered (names only, never folders) each time it
-- connects, so the website's Start form can offer them. [{ "name": "orbit", "default": true }, ...]
-- It has a default, so this is safe to run before the code that writes it is released.

ALTER TABLE runners ADD COLUMN IF NOT EXISTS repos jsonb NOT NULL DEFAULT '[]'::jsonb;
