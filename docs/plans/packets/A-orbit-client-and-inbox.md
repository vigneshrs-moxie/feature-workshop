# Packet A · Orbit client and inbox

**Goal.** Ground Control reads Portal Feedback tickets with the person's own read-only token (ORBIT-479) and shows an inbox. No write path exists, and a test proves it.

**Port 4483 · worktree `../ground-control-A` · branch `packet/A-orbit-client-and-inbox`.**

## What exists
- ORBIT-479 (repo `~/Projects/orbit-feedback-api-mcp`, unmerged): `GET /api/feedback/v1/tickets` (the tracker's query string; page size 50; `datefield=updated&from=<YYYY-MM-DD>`), `/v1/tickets/{ref}` (detail with timeline), `/v1/tickets/{ref}/references`, `/v1/views`; `Authorization: Bearer orbfb_<43 chars>`; scopes `tickets:read`, `views:read`; lenient key parse `/^(?:orbit-?)?#?(\d{1,9})$/i`. Read `app/src/app/api/feedback/v1/**` and `app/src/lib/feedback/operations/read.ts` there for the exact response shapes; copy nothing, just match the shapes.
- `dashboard/lib/plan-usage.js` shows how the dashboard reads a credential and polls with backoff; follow its style for the token and polling.
- Settings live in `~/.feature-workshop/settings.json` (soon `~/.ground-control/`); `dashboard/lib/state.js` reads and writes it.

## Owns
`dashboard/lib/orbit.js` (new: token store, client, polling, key parse, scrub), `dashboard/lib/orbit-token.js` (new: OS credential store with a file fallback under the state folder, mode 600), the `/api/orbit/*` routes block in `dashboard/server.js`, `dashboard/test/orbit.test.js` and `dashboard/test/fixtures/orbit/*.json` (new), `web/src/views/Inbox.tsx` (new) plus test, the Settings "Orbit token" field (one component file under `web/src/views/settings/`), one route and one nav entry.

## Steps
1. Token: `setToken(token)` validates the `orbfb_` prefix and length, stores it in the OS credential store (`keytar` if present, else the 600 file), and writes the Claude Code MCP entry for the Foreman into `~/.claude/settings.json` under `mcpServers.orbit-feedback` as `{"type":"http","url":"<orbit>/api/mcp/feedback","headers":{"Authorization":"Bearer ${ORBIT_FEEDBACK_TOKEN}"}}` with the env var exported by the driver (do not write the token literal into the file). `clearToken()` reverses both.
2. Client: `listTickets(query)`, `getTicket(ref)`, `listReferences(ref)`, `listViews()`; page through 50s; 401 → "token expired or revoked"; 429 → honour `Retry-After`; day-granular `from=` then filter to the minute client-side.
3. Poller: every 3 minutes while a browser has the inbox open (an SSE subscriber exists), every 15 otherwise; one in-flight request at a time; last list cached with its time for offline display.
4. Scrub: `scrub(text)` replaces `orbfb_[A-Za-z0-9_-]{43}` and the other prefixes listed in plan §5 T7; every outbound record and every audit line passes through it (apply where `audit.jsonl` is written: one call, in `dashboard/lib/history.js` only if that file writes audit; otherwise where it is written, and say so in the hand-back).
5. Routes: `GET /api/orbit/inbox`, `GET /api/orbit/tickets/:ref`, `GET /api/orbit/tickets/:ref/references`, `GET /api/orbit/views`, `POST /api/orbit/token`, `DELETE /api/orbit/token`, `GET /api/orbit/status` (token present, expires, last poll, last error).
6. Inbox page: list with key, title, priority, severity, age, assignee, "you are already on this" if a job folder with that key exists (read `status.json` `ticket.key` when packet B lands; until then match the slug prefix `orbit-<n>-`); tabs from saved views; one primary action "Start" (key `s`) that, until packet B exists, opens the New job form with the key and title filled in.
7. Tests: a fake Orbit server (http module) serving the fixtures; list, detail, pagination, 401, 429, polling cadence with fake timers, scrub, and a test that greps the whole `dashboard/lib` for any `fetch(`/request to `/api/feedback` with a method other than GET.

## Acceptance
Inbox lists the person's tickets with priority, severity, age; detail opens; token in the OS store and never in any record (test); no non-GET call to Orbit exists (test). All tests green.

## Verify
```
PORT=4483 npm start   # Settings → Orbit token → paste; open Inbox
npm test && (cd web && npx vitest run)
```


## Rules that apply to every packet (read once, obey always)

- **Base:** `main` of the Ground Control repo (today `~/Projects/feature-workshop`, to be renamed `ground-control`) after Vignesh has fast-forwarded `redesign/orbit-ready` into it. If `git log main..redesign/orbit-ready` is not empty, stop and tell Vignesh; do not base on `main` then.
- **Worktree and branch:** `git worktree add ../ground-control-<id> -b packet/<id>-<name> main` from the main checkout. Work only there.
- **Port:** run the dashboard with `PORT=<port> npm start` in the worktree. **Never use 4477 (Vignesh's live dashboard) or 4479 (his demo).** The screens server takes `<port>+1`.
- **Owned files only.** Touch nothing outside the "Owns" list. If you need a change elsewhere, write it under "Needs from others" in your hand-back and stop at that point.
- **Tests:** `npm test` (node:test, `dashboard/test/*.test.js`) and `cd web && npx vitest run`. Both green before hand-back. **No model calls in tests:** the server under test runs with a fake query (`WORKSHOP_DEMO=1`); never import the Agent SDK in a test.
- **Never push, never open a PR, never merge.** Commit locally, one commit per step, plain messages. Hand back the branch name and the last SHA.
- **Status is never shown by colour alone; themes change looks only; keys never fire while typing or with a dialog open.** Use the theme tokens, not literal colours.
- **Plain words** in every string a person reads. No jargon.
- **Hand-back format** (paste into the integration board's notes or tell Vignesh): packet id, branch, last SHA, what was done per step, test output tail, anything not done and why, "Needs from others".
