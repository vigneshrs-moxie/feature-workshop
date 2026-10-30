# Packet 2A · The hosted site on Vercel: sign-in, laptops, the link

**Goal.** Start v2 (plan §9, decisions G11, G34 and G35). Build the hosted site as a Vercel project:
- Moxie Google sign-in, with people and roles;
- pairing a laptop's runner once, with a one-time code;
- the link the runner and the site talk over;
- the first mirror: each person's job list.

**Done when:**
- two laptops (here: two fake runners) are paired;
- each person sees only their own jobs;
- everything runs and is tested locally, against fake Google and a local Postgres.

Vignesh pushes and Vercel deploys. Setup steps for him are in `docs/hosting/vercel-setup.md`; read them first, because this packet must match them exactly: the folder, the env names, the redirect path and the cron job.

**Port 4507 · worktree `../ground-control-2A` · branch `packet/2A-site-service`.**
- 4505 is kept for Vignesh's own local trial of the site. Don't use it.
- Base: `main`.

## Shape (from G34)
- **`hosted/`** is the Vercel project's Root Directory.
  - `hosted/vercel.json` sets the build:
    - the web build;
    - the migrations;
    - the output: the static `web/dist`, served at `/`;
    - the rewrite of `/api/(.*)` to one Node function, `hosted/api/index.js`;
    - the cron entry for packet 2C, declared now as `/api/cron/inbox` every 3 minutes, which answers 204 until 2C fills it.
  - `hosted/package.json` is a workspace of the root.
- **One function, one router:** `hosted/site/router.js`, with its routes in `hosted/site/routes-*.js`. The same handler runs locally under `node:http` (`npm run dev -w hosted`, port 4507 in this packet), so tests and the local run use exactly the code Vercel runs.
- **Postgres:**
  - Production: `pg` with a pool. Use `attachDatabasePool` from `@vercel/functions` for Fluid compute, per Vercel's current guidance; check their docs.
  - Tests: `@electric-sql/pglite`, in-process, so no Docker or server is needed.
  - SQL migrations live in `hosted/migrations/NNN-*.sql`. `hosted/scripts/migrate.js` applies them in a transaction with a lock, and is safe to run on every build.
- **Pin every new dependency** to an exact version at least two weeks old.

## 1. Sign-in, people and roles
- **Google OpenID Connect:** authorization code flow with PKCE, a `state` and a `nonce`.
  - The callback path is `/api/auth/callback`.
  - Verify the ID token's signature against Google's keys with `jose`, then its issuer, audience and expiry.
  - Then require `email_verified` and `hd === ALLOWED_DOMAIN`. Anyone else sees "This site is for Moxie accounts only" and gets no session.
- **Sessions:**
  - a random id in an httpOnly, Secure, SameSite=Lax cookie, signed with `SESSION_SECRET`;
  - stored in a `sessions` table, so it can be revoked;
  - 30 days, with a sliding renewal.
- **Writes** need the session plus a same-origin check: `Origin` or `Sec-Fetch-Site`.
- **People:**
  - The first sign-in with `OWNER_EMAIL` becomes `owner`. Everyone else starts as `member`.
  - The owner can make someone a `manager` or a `member` in Settings → People. Planned: Raj manager, Vignesh and Sohum members. Never hard-code a real name or email anywhere; tests use made-up people at `example.test`.
  - Roles change nothing about whose jobs you see. Everyone sees only their own; the Lounge (2D) and team Telemetry (2E) are the shared views.
- **Fake Google for tests and local dev:**
  - a small OIDC issuer: discovery, JWKS, authorize and token;
  - switched on only by `AUTH_FAKE=1`, which a production build refuses to start with.
  - Tests cover: wrong domain, `email_verified` false, a bad signature, an expired token, a replayed state and a wrong nonce.

## 2. Pairing a laptop
- **On the laptop:** `ground-control login --site <url>`.
  1. It asks the site for a pairing (`POST /api/pair/start`), which returns a short code (8 characters, no look-alike letters), a long device secret and a link.
  2. It prints the link and the code.
- **On the site:** the signed-in person opens the link, sees the laptop's name, OS and the same code, and presses **Pair this laptop**.
- **The laptop then:**
  - polls `POST /api/pair/finish` with its device secret, and receives a **runner token** (32 random bytes);
  - stores the token in the OS credential store, as the Orbit token is stored (`dashboard/lib/orbit.js` has the helper);
  - from then on, sends the token as `Authorization: Bearer`.
- **The site keeps only a hash** of the token. A pairing code lives 10 minutes and works once.
- **Settings → Laptops** on the site lists your laptops: name, OS, last seen, online or not. Remove revokes a token. A `login` on a laptop rotates its token.
- **`ground-control logout`** forgets the token and tells the site.

## 3. The link (runner ↔ site)
This is the runner half: `dashboard/runner/site-link.js`, started by the runner when a site is configured.
- **Up:** `POST /api/runner/events` carries batched events made by `lib/protocol.js` `makeEvent` (already scrubbed).
  - At most 256 KB a batch.
  - Retried with backoff.
  - Kept in an on-disk queue while offline, so nothing is lost across a restart.
- **Down:** `GET /api/runner/commands?wait=25` is a long-poll.
  - The site holds the request until a command is queued for this runner, or up to 25 s.
  - Each command has an id. The runner runs it through `parseCommand` (a command not on the closed list is refused, as today), then answers `POST /api/runner/commands/:id/result`.
  - Delivery is at least once. The runner remembers the ids it has done, so a repeat is a no-op.
- **Heartbeat:** a laptop counts as online if it was seen in the last 60 s.
- **Rules:**
  - The site never sends anything that isn't a `REMOTE_COMMANDS` command.
  - The runner never sends source code, diffs, `.env`, database contents or any token (§2.4).
  - Extend `lib/protocol.js`'s tests: every event the site stores passes the "never carries" check again on the site side, and is refused if not.
- **No WebSocket.** G34 says why.

## 4. The first mirror: my jobs
- The runner sends a `job-list` snapshot on connect, and `status` events as today.
- The site keeps one row per job: runner, owner, slug, title, ticket key, stage, state, the now line, updated time.
- **The hosted web app** is the same `web/` build.
  - `/api/meta` says `mode: 'hosted'`. The API client then uses the session cookie instead of `X-Workshop-Token`, and shows **Sign in with Google** when there is no session.
  - In hosted mode Jobs lists my jobs from the mirror, grouped by laptop when there is more than one. Each card shows whether its laptop is online.
  - Screens 2A doesn't serve yet show a calm placeholder, never an error: "Open this on your laptop for now — the hosted site shows it once this part is built". Those are a job's page, the Desk, Stacks and Telemetry.
- **Each person sees only their own runners' jobs.** There is a test with two people and two runners, plus a test that a guessed job id from another person gets 404.

## 5. Checks and safety
- **Tests (node:test with PGlite and fake Google), covering:**
  - sign-in, every refusal, sessions, logout and revocation;
  - pairing, expiry and reuse;
  - the long-poll: a command queued while waiting arrives at once; at 25 s the answer is empty);
  - at-least-once delivery with no double run;
  - the offline queue;
  - isolation between people;
  - the scrubber on stored events;
  - the cron route refusing without `CRON_SECRET`;
  - `AUTH_FAKE` refused in production.
- **A local end-to-end script, `hosted/e2e/two-laptops.mjs`:**
  1. Start the site on 4507 with PGlite, fake Google and two fake runners: the existing demo's runner with `WORKSHOP_DEMO=1`, each with its own temporary home.
  2. Sign in as two made-up people.
  3. Pair one laptop each.
  4. Check that each sees only their own jobs.
  5. Take Playwright shots at 1512 and 390 px, in Light and Default: sign-in, the "Moxie accounts only" refusal, pair, Laptops, People, and Jobs in hosted mode.
- **Security notes for the hand-back:**
  - what the site stores;
  - what crosses the network;
  - how each secret env var is used.

## Owns
- `hosted/` (all new);
- `dashboard/runner/site-link.js` (new) and its hook-up in `dashboard/runner/index.js`;
- the `login` and `logout` commands in `bin/`;
- `dashboard/lib/protocol.js`, for new event types `job-list` and `hello` only, with tests;
- `web/src/api/client.ts`, for hosted-mode auth only;
- new `web/src/views/Hosted/` (sign-in, pair, Laptops, People and the placeholder);
- the router entries for those;
- the root `package.json` workspaces line.

Packet X is fixing themes in `web/src/theme` and CSS at the same time. Don't touch those; use the existing tokens and R's controls.

## Steps (one commit each, tests green)
1. `hosted/` skeleton: `vercel.json`, the router, the local dev server, migrations, PGlite tests.
2. Sign-in, sessions, people and roles, and fake Google.
3. Pairing, with the CLI `login` and `logout`.
4. The link: events up, long-poll down, the offline queue and heartbeat.
5. The mirror of my jobs, and the hosted mode in the web app.
6. The two-laptops end-to-end run and shots. Hand back.

## Rules that apply to every packet (read once, obey always)
- **Worktree and branch:** `git worktree add ../ground-control-2A -b packet/2A-site-service main` from the main checkout. Work only there.
- **Port 4507.** **Never use 4477, 4479, 4485, 4491 or 4505.** Leave 4503–4504 (packet X) alone.
- **Never push, never deploy, never run `vercel` against a real account, never open a PR, never merge.** No real Google, Orbit or GitHub calls, in tests or otherwise; fakes only. No real people's names or emails anywhere.
- **No secrets in the repo.** `.env.example` lists the names with empty values.
- **Tests:**
  - `npm test`, `cd web && npx vitest run`, `npx tsc --noEmit -p .`, and the hosted tests, all green before each commit;
  - no model calls in tests.
- **Status is never shown by colour alone. Theme tokens and R's controls only. Plain words in every string a person reads.**
  - The product is "Dashboard" for now (`BRAND`/`PRODUCT`). The Vercel project and subdomain are `feature-workshop`; take the site's URL from `SITE_URL`, never spell it.
- **The design philosophy applies:** `docs/design/design-philosophy.md`.
- **Hand-back format:** packet id, branch, last SHA, what was done per step, test output tail, anything not done and why, "Needs from others", and anything Vignesh must set in Vercel or Google that differs from `docs/hosting/vercel-setup.md`.
