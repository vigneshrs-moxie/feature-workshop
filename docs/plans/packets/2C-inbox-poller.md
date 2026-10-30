# Packet 2C · The Orbit inbox fills while the laptop is off

**Goal.** Decision G11: the site keeps each person's Orbit read-only token, encrypted, and polls their inbox, so tickets are waiting even when the laptop is closed. Start from a ticket then goes to that person's laptop.

**Port 4511 · worktree `../ground-control-2C` · branch `packet/2C-inbox-poller`.** Base: `main` after 2A is merged. It runs beside 2B.

## 1. The token store
**Settings → Orbit** on the site: paste your token. The site then:
- checks it with one call;
- stores it encrypted with AES-256-GCM under `TOKEN_KEY` (32 bytes, base64), with a key id so the key can be rotated later;
- shows only "Saved · expires 12 Dec" and Remove.

The token is never:
- logged;
- returned by any route;
- sent to a runner;
- put in an event, the mirror or the audit.

Tests grep every stored row, response and log line for `orbfb_` (the existing scrubber).

When the token expires or is refused, the Inbox shows the banner "Your Orbit token expired. Paste a new one in Settings → Orbit". It shows once, it is calm, and it never covers the page.

## 2. The poller
- **Trigger:** Vercel Cron calls `/api/cron/inbox` every 3 minutes (the entry 2A declared). It needs `Authorization: Bearer ${CRON_SECRET}`.
- **Each run, for each person with a token:**
  - fetch their assigned and following open tickets, reusing `dashboard/lib/orbit.js`'s client and its lenient key parse;
  - only what changed, with `datefield=updated&from=<day>`, then filter to the minute (plan §3.1).
- **Store** one row per ticket per person, with the fields the Inbox shows.
- **Stay inside one run:**
  - at most N people per run, in turn;
  - time-boxed under the function's limit;
  - one person's failure doesn't stop the others.
- **While someone has the Inbox open,** the page asks for a refresh of their own inbox, at most once a minute.

## 3. The hosted Inbox and Start
- The existing Inbox screen, in hosted mode, reads the stored inbox.
- "You're already on this" uses the mirror (2A/2B).
- **Start** queues a `start` command to the person's laptop.
  - If they have more than one laptop, it asks which, with R's Choice control.
  - If the laptop is offline, the card says "Starts when your laptop is back".
- **The Foreman still reads the ticket itself,** through the Orbit MCP, with the laptop's own token (unchanged).

## Checks
- Tests with a fake Orbit server: encryption round trip and a wrong key; expiry; the cron refusing without the secret; paging; incremental fetch; one person's error isolated; Start online and offline; no token anywhere it shouldn't be.
- Playwright shots at 1512 and 390 px:
  - Settings → Orbit, empty and saved;
  - the Inbox from the site;
  - the expiry banner;
  - choosing a laptop.

## Owns
- `hosted/`: `routes-orbit.js`, `lib/token-store.js`, `lib/poller.js` and the cron handler;
- web hosted-mode bits of the Inbox and Settings → Orbit.

2B works in `hosted/` too. Keep to your own files, and add only your own line to the router list.

## Rules
The same as `2A-site-service.md`'s rules section, with this packet's own worktree, branch and port 4511.

## From 2A's hand-back (2026-10-30)
- `/api/cron/inbox` exists: it answers 204, and 401 without `CRON_SECRET`. Fill it.
- `TOKEN_KEY` and `ORBIT_BASE_URL` are read by `hosted/site/config.js` but not used yet.
- The hosted tests run with `npm test -w hosted`. Run them as well before each commit.
