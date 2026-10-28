# Packet D · Usage warnings at 80, 90 and full

**Goal.** The plan meters warn once at 80 %, once at 90 % and once when full, per reset window, as a banner and a notification; nothing is ever stopped (plan G20, D8).

**Port 4485 · worktree `../ground-control-D` · branch `packet/D-usage-warnings`.**

## What exists
- `dashboard/lib/plan-usage.js` reads `GET https://api.anthropic.com/api/oauth/usage` with the Claude Code login and returns `{ fiveHour: { percent, resetsAt }, week: { percent, resetsAt } }`; it already handles a failed read and 429 (see the last two commits on `redesign/orbit-ready`).
- The top bar shows the meters; clicking opens a panel (`web/src/…` usage panel, find it by the string "Read now").
- `dashboard/lib/notify.js` sends the desktop notification; `dashboard/lib/limits.js` and `driver.js` handle the hard usage-limit case (`usage-limit` event).

## Owns
`dashboard/lib/usage-warnings.js` (new: thresholds, once-per-window memory in the state folder), one hook into the poll result in `dashboard/lib/plan-usage.js`, one notification type in `dashboard/lib/notify.js`, the banner component in `web/src/` (new file) and its mount in the top bar (one line), `dashboard/test/usage-warnings.test.js` (new), the web test for the banner.

## Steps
1. `check(meters, memory)` → list of warnings to fire now: for each meter, 80, 90, 100, each at most once per `resetsAt`; memory keyed by meter and resetsAt, written to `~/.ground-control/usage-warnings.json` (or the current state folder).
2. Banner text in plain words: "Weekly Claude usage is at 82 %. It resets Thursday 14:00." Word and number, never colour alone; dismissable per warning; reappears at the next threshold.
3. Notification with the same text through `notify.js`; Settings → Notifications gets one toggle.
4. Tests: thresholds fire once, reset window resets the memory, no warning when the read failed.

## Acceptance
Warnings at 80, 90 and full, each once per reset window, as a banner and a notification; status never by colour alone. All tests green.

## Verify
```
PORT=4485 npm start
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
