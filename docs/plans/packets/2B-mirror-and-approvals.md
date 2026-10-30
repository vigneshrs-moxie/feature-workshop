# Packet 2B · The full mirror, queued approvals and the Desk on a phone

**Goal.** The hosted site shows a job the way the laptop does, and lets you decide from anywhere.

**v2's finish line (D9):**
- a gate is approved from a phone while the laptop is closed;
- the card says "waiting for your laptop";
- when the laptop wakes, the runner picks the approval up and the job moves on.

**Port 4509 · worktree `../ground-control-2B` · branch `packet/2B-mirror-and-approvals`.** Base: `main` after 2A is merged. It runs beside 2C.

## 1. The full record, mirrored
- **What the runner sends up (G9):**
  - status, briefs, the Foreman's documents, gate and permission cards, test reports, decisions, costs and timing, branch and PR names;
  - the crew activity and the now line, as the Stage gets them;
  - Stacks, with their parts.
- **What it never sends:** source, diffs, `.env`, database contents or a token. The site checks this again (2A's check) and refuses a record that fails.
- **Evidence** (screenshots and videos) goes to the private Vercel Blob store `site-files`. Private Blob is generally available; on Vercel, functions reach it with Vercel's own short-lived OIDC token, not a stored key. Check the current docs: https://vercel.com/docs/vercel-blob/private-storage.
  - The runner asks the site for a one-time client upload token scoped to that job's path, then uploads straight to Blob.
  - The site serves a file only to its owner, through a short-lived signed link.
  - Tests use a fake Blob.
- **On the site, the "runner" the routes call is a mirror runner.**
  - `read` answers from Postgres.
  - `handle` queues a command for the owner's laptop.
  - So the existing `dashboard/site/routes-*.js` serve the hosted Desk, Jobs, a Job, the Stage, Stacks and a part with as little new code as possible.
  - Where a route needs the laptop, such as a file's diff, the Screens server or Try it, it asks the runner live through the link while the laptop is online. Otherwise it says "Your laptop is off; this shows when it's back".
  - A diff answer goes back to the one page that asked. It is never stored.
- **Live updates:**
  - Server-sent events from `/api/events`, with `Last-Event-ID`.
  - The function ends each stream before Vercel's time limit and the browser reconnects, resuming where it left off. It must not look like a reconnect: no flash and no jump.
  - Falls back to polling every 5 s.

## 2. Queued approvals
- **What can be queued:** Go / No go, reply, send back, stop, allow or deny a permission, and merge next on a stack.
- **Each decision carries what it was made on:** the brief hash, or the permission's id.
- **When the laptop is offline,** the card says "Waiting for your laptop: it runs when the laptop is back", with Cancel.
- **When the laptop comes back,** the runner runs queued decisions in order. If the job moved on meanwhile (another stage, a different brief, the permission already answered on the laptop), it runs nothing. The site then shows "This changed on your laptop. Look again", with the new card.
- **A permission card expires** where the Foreman's request does. The site shows "Asked 12m ago · expires in 3m".
- **Every decision is audited** on both sides: who, from where (laptop or site), when, and what it was made on.

## 3. The Desk on a phone
At 390 px, the Desk works on the hosted site:
- one decision at a time;
- Go / No go as large buttons, at least 44 px;
- the ask in plain words;
- "Read the brief" as a sheet;
- the laptop's state in words.

No horizontal scroll. R's rules apply: nothing jumps, and no native controls.

## Checks
- Tests, using PGlite, fake Blob and fake runners:
  - the mirror round trip;
  - refusals of "never carries";
  - Blob scoping (another person gets 404);
  - every queued decision kind, online and offline;
  - stale decisions refused;
  - permission expiry;
  - the audit.
- **`hosted/e2e/phone-approval.mjs`**, the D9 scenario end to end:
  1. a fake runner reaches a gate;
  2. it goes offline;
  3. the phone-width page approves;
  4. the card waits;
  5. the runner reconnects and the job moves on.

  Take shots at 390 and 1512 px.

## Owns
- `hosted/`, for the mirror, Blob, events and queue;
- `dashboard/runner/site-link.js` and the upload side in `dashboard/runner/evidence.js`;
- `dashboard/lib/protocol.js`, for new event types only;
- web hosted-mode states, in `web/src/views/Hosted/` plus the "waiting for your laptop" state on the Desk's and the Job's cards;
- the Desk's phone layout.

2C works in `hosted/` too. Keep 2B to its own files: `hosted/site/routes-mirror.js`, `hosted/lib/queue.js` and so on. Neither packet edits the router list beyond adding its own line.

## Rules
The same as `2A-site-service.md`'s rules section, with this packet's own worktree, branch and port 4509.

## From 2A's hand-back (2026-10-30)
- **Build on 2A's internal `queueCommand`.** Command results today carry only `{ ok, error }`. Add answer data for the live diff here, sent straight back to the page that asked and never stored.
- **`POST /api/pair/start` is public and capped only at 100 waiting pairings in total.** Add a per-address limit (for example 5 a minute) so nobody can fill the cap, with a test.
- **The hosted tests run with `npm test -w hosted`.** Run them as well before each commit.
