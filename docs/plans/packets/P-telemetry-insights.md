# Packet P · Telemetry insights

**Goal.** Telemetry stops being five usage graphs and becomes up to ten **insight graphs**: each one answers a question that helps decide something about the product, how it's used, or which Claude plan to be on. Each graph is headed by its finding in one sentence, says what to do about it, shows its numbers on request, and can be folded or hidden. Asked for in Vignesh's first review of the Ground Control screens (2026-10-28, `M-screens-review-1.md`, section s-tele): "share by model, by user and maybe by stage makes sense but i want deeper insights … extremely useful insights that will help us make decisions on the product, usage, plans etc … upto 10 graphs, each with a hide button or a fold button."

**Port 4487 · worktree `../ground-control-P` · branch `packet/P-telemetry-insights`. Depends on M (its tokens, `--chart-1` to `--chart-8`, its base pieces and the Telemetry screen's look). Starts after M is merged, beside O if O is still running, and merges after O.**

## What exists
- **The approved Telemetry wireframe**: the s-tele section of the Ground Control screens page (`~/.claude/wireframes/feature-workshop/ground-control-screens.html`, its build brief `ground-control-screens.brief.md`, published at https://claude.ai/artifact/VWS7nxyvPvG9ruyxszEufF). Build the screen exactly as drawn there once Vignesh has approved it; where it and this brief disagree, the wireframe wins.
- **The record**: `dashboard/lib/usage-log.js` writes one line per Foreman turn and worker to `~/.ground-control/usage.jsonl`: time, user, account, job, ticket, stage, section, worker, model, tokens (input, output, cache read, cache writes), cost and its source, the 5-hour and weekly meters, turn and session ids.
- **The five graphs today**: `dashboard/lib/telemetry.js` (pure functions: windows, sums, the forecast, `percentPerDollar`), served by `dashboard/site/routes-telemetry.js` (`GET /api/telemetry?window=5h|week|30d`), drawn by `web/src/views/Telemetry.tsx` with `Telemetry.css` (its own `--tele-1` to `--tele-8` colours) and `Telemetry.test.tsx`.
- **Other sources the new graphs join**: the audit log (`~/.ground-control/audit.jsonl` through `dashboard/lib/state.js`: gate answers, send-backs, new jobs), each job's `status.json` (stage times, route size, PR numbers), `dashboard/lib/cost.js` (`PRICES`, `modelFamily`, `whatIfConductor`), and the temp-folder rule in `dashboard/lib/history.js` (`isTemp`).
- **Left open from v1**: Telemetry's keys (Read now, the arrow keys on the weekly line) aren't in `web/src/app/keyRegistry.ts`, so Settings → Keys doesn't list them.

## Owns
`dashboard/lib/telemetry.js`, `dashboard/lib/insights.js` (new), `dashboard/site/routes-telemetry.js`, `web/src/views/Telemetry.tsx`, `Telemetry.css`, `Telemetry.test.tsx` and any new files under `web/src/views/Telemetry/`, Telemetry's entries in `web/src/app/keyRegistry.ts`, the Telemetry shapes in `web/src/api/types.ts`, `dashboard/test/telemetry.test.js` and `dashboard/test/insights.test.js` (new).

## Steps
0. **The plan week starts Wednesday 16:00, local time** (Vignesh, 2026-10-29: the Claude plan's weekly reset; his Mac is on America/Phoenix, no daylight time). `windowRange('week')` uses the weekly meter's reset when there is a reading, and otherwise the last Wednesday 16:00 in the dashboard's local time zone, not the rolling seven days it falls back to today. Every per-week graph (2, 6, 7, 10, and the model share) buckets on the same Wednesday-16:00 boundaries, and its labels say so ("Week from Wed 28 Oct, 4 pm"). Tests cover a reading, no reading, a line just before and just after 16:00 on a Wednesday, and a time zone with daylight time.
1. **The cleaned record** (`insights.js`): one pass that reads the usage lines and gives every graph the same tidy rows.
   - Drop demo lines and lines from test folders (the `isTemp` rule).
   - Count each turn once: a turn's lines share a `turn` id; sums never add a turn's cost twice.
   - Fold model ids into families (`modelFamily`).
   - A resumed session's cost is taken by difference, as usage-log already does; never re-add a running total.
   - A week with no meter reading is marked as such, never guessed.
   - Outliers stay in the table but are capped on the graph, with a note saying so.
   - Join with the audit log and job status for send-backs, gate waits, route size and PR #1 times.
   Unit tests on fixture lines cover each rule.
2. **The ten graphs**, each a pure function returning its data, its headline (the finding, in words), its "What to do" line and its table:
   1. Weekly limit and forecast (kept from today).
   2. Cost per finished ticket, by week: median and spread for tickets that reached the finish line.
   3. Where the spend goes, by stage: this month against last month.
   4. Models: share of spend by family, and what moving the costliest stage to the next model down would save (`whatIfConductor`).
   5. People on the account (kept from today): no job names.
   6. Rework: cost spent after a send-back, by stage.
   7. Waiting on you: hours jobs sat in Needs you per week, and the median time to answer.
   8. Time to PR #1, by job size (small against large route).
   9. When the limit goes: hour of day × weekday.
   10. Cache reuse: share of input read from cache by week, and the jobs that reused least.
   A headline never claims more than the data holds: with too little data it says "Not enough jobs yet to say (3 of 5 needed)". Private graphs (your own jobs, with names) and account-wide ones (no job names) stay as today, marked with the lock or the people icon.
3. **The route**: `GET /api/telemetry` returns the ten graphs for the window, each with an id, so the page can fold and hide by id. The old five keep their shapes until the page moves over in the same packet.
4. **The page**, as the approved wireframe draws it: the two dials and Read now first, then the graphs in a two-column grid (one column on a phone, folded). Each card has Fold (keeps the headline) and Hide (moves it to "Show hidden graphs (n)"), remembered per person in the browser. Table ▸ shows the numbers. Colours from `--chart-*` with a pattern each (M's tokens); `--tele-*` goes. Status and every series are in words or patterns too, never colour alone.
5. **Keys**: Read now and the arrow keys on the weekly line go into `keyRegistry.ts` with their scope, so Settings → Keys lists them.

## Acceptance
Telemetry shows up to ten graphs, each headed by a finding in plain words with a "What to do" line, each can be folded and hidden and comes back from "Show hidden graphs"; the cleaned record drops demo and test lines, counts each turn once and never guesses a missing week; the headlines say "Not enough … yet" rather than guess; charts use `--chart-*` with patterns; Telemetry's keys are in Settings → Keys; the screen matches the approved wireframe at desktop and phone width. All tests green, with no model calls.

## Verify
```
PORT=4487 npm start   # http://127.0.0.1:4487/next/#/telemetry: every graph, fold, hide, show hidden, at 390 px wide too
npm test && (cd web && npx vitest run)
```


## Rules that apply to every packet (read once, obey always)

- **Base:** `main` of the Ground Control repo after M is merged.
- **Worktree and branch:** `git worktree add ../ground-control-P -b packet/P-telemetry-insights main` from the main checkout. Work only there.
- **Port:** run the dashboard with `PORT=4487 npm start` in the worktree. **Never use 4477 (Vignesh's live dashboard), 4479 (his demo) or 4485 (his test server).** The screens server takes `<port>+1`.
- **Owned files only.** Touch nothing outside the "Owns" list. If you need a change elsewhere, write it under "Needs from others" in your hand-back and stop at that point.
- **Tests:** `npm test` (node:test, `dashboard/test/*.test.js`) and `cd web && npx vitest run`. Both green before hand-back. **No model calls in tests:** the server under test runs with a fake query (`WORKSHOP_DEMO=1`); never import the Agent SDK in a test. Server tests use `startDashboard()` from `dashboard/test/helpers/dashboard.js`.
- **Never push, never open a PR, never merge.** Commit locally, one commit per step, plain messages. Hand back the branch name and the last SHA.
- **Status is never shown by colour alone; themes change looks only; keys never fire while typing or with a dialog open.** Use the theme tokens, not literal colours.
- **Plain words** in every string a person reads. No jargon.
- **Hand-back format:** packet id, branch, last SHA, what was done per step, test output tail, anything not done and why, "Needs from others".
