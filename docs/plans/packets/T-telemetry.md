# Packet T · Telemetry

**Goal.** Record every Foreman turn's usage and show five graphs that answer where the Claude usage goes and when the limit hits (plan §7a, D14). Vignesh and Sohum share one Claude account, so lines are keyed by Ground Control user.

**Port 4481 · worktree `../ground-control-T` · branch `packet/T-telemetry`. Depends on D (warnings) being merged.**

## What exists
- `dashboard/lib/driver.js` receives, per SDK message, the model and usage (tokens by kind) and `total_cost_usd` on the result message (`run.costUsd`); it knows the job, the stage and (later) the section.
- `dashboard/lib/cost.js`: `tokensFromUsage()`, prices per model family, `modelLabel()`; its figures are estimates, Claude Code's own cost is preferred.
- `dashboard/lib/plan-usage.js`: the two meters with percent and `resetsAt`.
- Charts: pick one small library already in `web/package.json` if present; otherwise inline SVG. Read the `dataviz` skill before drawing.

## Owns
`dashboard/lib/usage-log.js` (new: append one line per turn to `~/.ground-control/usage.jsonl`, or the current state folder), one emit call in `dashboard/lib/driver.js` where usage arrives, `dashboard/lib/telemetry.js` (new: windows, aggregations, forecast), the `/api/telemetry/*` routes block in `dashboard/server.js`, `dashboard/test/usage-log.test.js` and `telemetry.test.js` (new, with a 30-day fixture under `dashboard/test/fixtures/telemetry/`), `web/src/views/Telemetry.tsx` (new, replaces the Usage view's body; keep the meters and Read now at the top) plus its test, one route and the nav entry.

## Line shape
`{ t, user, account, job, ticket, stage, section, worker, model, tokens: { input, output, cacheRead, cacheWrite5m, cacheWrite1h }, costUsd, costSource: "cli"|"estimate", meters: { fiveHour: {percent, resetsAt}, week: {percent, resetsAt} } }` where `user` is the Ground Control user (local mode: the OS user name until sign-in exists), `account` the Claude account id if the login exposes it, else null.

## Graphs (exactly these)
1. **Gauge over time** (common): the seven-day percent as a line with reset marks, the five-hour as a thin line, a dotted forecast from the last 24 hours' slope: "At this pace, full on Thursday 14:00".
2. **Usage by day, by job** (private): stacked bars, pattern plus colour per job, click opens the job.
3. **Cost per ticket and per stage** (private): two small bars, last 30 days, in percent of the week and in dollars.
4. **Share by model** (common): one bar per week split by model.
5. **People on the account** (common): one bar per user for the window.
Every graph has a one-sentence fact under it in words and a table view toggle. Window picker: this five hours, this week, 30 days.

## Steps
1. Logger with a write queue and rotation at 50 MB (new file, old kept).
2. Aggregations and the forecast as pure functions over lines; tested against the fixture with hand-computed expectations.
3. Routes: `GET /api/telemetry?window=`, returning the five datasets and the sentences.
4. The page; the "private" and "common" labels are a property on each dataset so v2 can filter.
5. Tests as in §7a.4; no model calls.

## Acceptance
Every turn of a sample job produces one line; the five graphs render from the fixture; the forecast matches the hand calculation; theme and colour checks pass. All tests green.

## Verify
```
PORT=4481 npm start   # open Telemetry
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
