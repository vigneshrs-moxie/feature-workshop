-- POST /api/pair/start is public: at most a few pairings a minute from one address (packet 2B, from
-- 2A's hand-back), so nobody can fill the site's cap of waiting pairings. Only the address's SHA-256
-- is kept, for ten minutes.
CREATE TABLE pair_starts (
  address_hash text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX pair_starts_address ON pair_starts (address_hash, at);
