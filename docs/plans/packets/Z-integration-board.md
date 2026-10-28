# Packet Z · Integration board

**Goal.** A page in the dashboard that lists the packet worktrees and merges them in order with the tests, so Vignesh never carries prompts between terminal windows. It is the seed of the stack page (plan §6.4) and is replaced by it in v1.5.

**Port 4481 · worktree `../ground-control-Z` · branch `packet/Z-integration-board`.**

## What exists
- `dashboard/server.js` serves the API and the React app; routes are added near the other `/api/*` handlers; writes go through `checkWrite(req.headers, { port, token })`.
- `dashboard/lib/git.js` has read-only git helpers; reuse its spawn pattern.
- `dashboard/lib/repos.js` finds repos; do not change it.
- The web app is React + Vite in `web/src` (`app/router.ts` for routes, `views/` for pages, `components/`).

## Owns
`dashboard/lib/integrate.js` (new), the `/api/integrate/*` routes in `dashboard/server.js` (one block, marked with a comment), `dashboard/test/integrate.test.js` (new), `web/src/views/Integrate.tsx` (new) plus its test, one route entry in `web/src/app/router.ts`, one nav entry.

## Steps
1. `integrate.js`: `listPackets({ root })` finds worktrees whose branch matches `packet/<id>-*` (`git worktree list --porcelain`), and for each returns id, name, path, branch, base, ahead, behind, last commit (sha, subject, time), `testsState` (`unknown` | `running` | `green` | `red`, from the last run this process did), and `touchedOutsideOwned` (paths changed vs base that are not in the packet file's "Owns" list; read `docs/plans/packets/<id>-*.md` and parse the Owns paragraph leniently; unknown means the list could not be read).
2. `mergeNext({ root, order })`: `order` is the packet id list from the plan (§11 integration order) stored in `~/.ground-control/integrate.json` (editable in the page). Merges the first packet in order that is not yet merged (`git merge --no-ff packet/<id>-... -m "Merge packet <id>: <name>"`) into the main checkout, then runs `npm test` and `cd web && npx vitest run`, streaming output to the page. On conflict: abort nothing, list conflicted files, stop, show "Open in editor". Never pushes. Never runs on 4477's checkout while a job is running there: refuse if `~/.ground-control` or `~/.feature-workshop` holds a session marked running for that repo.
3. Routes: `GET /api/integrate` (list + order + last result), `POST /api/integrate/order` (save order), `POST /api/integrate/merge-next`, `POST /api/integrate/run-tests` (for one packet, in its worktree), `GET /api/integrate/stream` (SSE for the running step).
4. Page: a table (id, name, branch, ahead/behind, last commit, tests, outside-owned), the order as a numbered list with up/down, a "packets at once" number (stored in `integrate.json`, default 3, changeable any time, shown as "N of M slots in use" where N counts worktrees whose branch is not yet merged), one primary button "Merge next" (key `m`), a log pane. State words always next to any colour.
5. Tests: fixtures with a temp git repo and two packet branches; list, order, merge next success, merge next conflict, refusal while a job runs.

## Acceptance
Lists the packet worktrees with their state; the slots number is changeable and the "in use" count is right; "Merge next" merges in order, runs both test suites, shows the result; a conflict lists files and stops; never pushes. All tests green.

## Verify
```
PORT=4481 npm start   # open http://127.0.0.1:4481/next/ → Integrate
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
