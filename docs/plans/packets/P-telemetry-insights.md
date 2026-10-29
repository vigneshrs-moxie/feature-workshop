# Packet P · Telemetry insights

**Goal.** Telemetry stops being five usage graphs and becomes up to ten **insight graphs**: each one answers a question that helps decide something about the product, how it's used, or which Claude plan to be on. Each graph is headed by its finding in one sentence, says what to do about it, shows its numbers on request, and can be folded or hidden. Asked for in Vignesh's first review of the Ground Control screens (2026-10-28, `M-screens-review-1.md`, section s-tele): "share by model, by user and maybe by stage makes sense but i want deeper insights … extremely useful insights that will help us make decisions on the product, usage, plans etc … upto 10 graphs, each with a hide button or a fold button."

**Port 4487 · worktree `../ground-control-P` · branch `packet/P-telemetry-insights`. Depends on M (its tokens, `--chart-1` to `--chart-8`, its base pieces and the Telemetry screen's look). Starts after M is merged, beside K2 and Q, and merges last.**

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
0b. **Other use of the account** (Vignesh, 2026-10-29: "other people use the claude account through other means outside of feature workshop … have an others section"). The usage log only sees Ground Control's own turns; the weekly and 5-hour meters see everything on the account (claude.ai, the desktop app, other people's Claude Code). So:
   - **Others = the meters' rise that Ground Control's lines don't explain.** For each stretch between two meter readings, Ground Control's share is its logged cost there times percent per dollar; the rest of the rise is "Other use (outside Ground Control)". Never below zero; a stretch with no reading at both ends is marked unknown, never guessed.
   - **Percent per dollar is taken only from short stretches** (consecutive readings a few minutes apart with Ground Control spend between them), so other people's use doesn't inflate it. Today's `percentPerDollar` counts the whole week's rise against Ground Control's dollars, which over-states it once others use the account; fix that here and test it with a fixture where an outside rise sits between two quiet readings.
   - **Two numbers, kept apart; one total for the limit** (Vignesh, 2026-10-29: "have ground control use and other's use be separate but when calculating stuff related to entire limit, use both … make sure it makes sense to users and is easy to understand who is using it"). Ground Control's use (per person, per job, per stage) and Other use are never mixed in a graph about Ground Control. Anything about the **whole limit** (the dial, the forecast of when it fills, "When the limit goes", the 5-hour meter) counts both, stacked so each part is readable: "This week: 63% used. In this app 22% (Vignesh), other use 41%." The forecast's pace uses the combined rise, and its line says which part is driving it ("At this pace the limit fills Tue 3 pm, mostly from use outside Ground Control").
   - **Who is using it, at a glance**: the top of the page gets one plain line under the dials, "Who used this week's limit", with one segment per person in Ground Control plus **Other use**, each labelled with a name, a percent and a pattern, never colour alone. Tap a segment for that person's graphs. A short note under it says what Other use means ("Use of this Claude account outside Ground Control: claude.ai, the Claude app, or someone's own Claude Code. Ground Control can't see who, so it's one estimate").
   - **Who "other use" can include, in v1.** There is no sign-in yet (local mode, D9's Google sign-in is v2): people are told apart by the computer's user name (`GROUND_CONTROL_USER`, else the OS login), and each laptop keeps its own usage log. So a teammate running this app on their own laptop shows up in **Other use** on yours, not by name. The note under the line says so plainly ("Includes anyone using this app on another computer: they show by name once the team site exists"). In v2 the site gathers every laptop's lines and they move out of Other use into named rows; build the rows so that is a change of source, not of screen.
   - **Name the product only through the one name setting** (`PRODUCT` / `BRAND.name`): the product's name isn't decided, so no string in this packet spells one out.
   - **Where it shows:** graph 1's dial and forecast split the week into "Ground Control" and "Other use" (pattern plus words); graph 5, People on the account, gets an **Others** row ("Outside Ground Control: claude.ai, the app and anyone else on the account; estimated from the meter"); graph 9 counts other use in when the limit goes. Every "Others" number says "estimated" and shows in percent of the limit only, since its dollars aren't known.
   - **The headline names it when it matters**: e.g. "Other use took 41% of this week's limit; Ground Control took 22%." With no meter readings it says "Can't see use outside Ground Control yet: no limit readings this week."
   Tests: a week with only Ground Control use (Others ≈ 0), one with outside use between readings, a reading gap, and a meter reset in the middle.
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
Telemetry shows up to ten graphs, use outside Ground Control shows as an estimated "Others" share in the dial, the forecast and People on the account, each headed by a finding in plain words with a "What to do" line, each can be folded and hidden and comes back from "Show hidden graphs"; the cleaned record drops demo and test lines, counts each turn once and never guesses a missing week; the headlines say "Not enough … yet" rather than guess; charts use `--chart-*` with patterns; Telemetry's keys are in Settings → Keys; the screen matches the approved wireframe at desktop and phone width. All tests green, with no model calls.

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

**Later (2026-10-29):** packet T reads Claude Code's own session logs on this computer, so your Claude Code use outside the app is counted by name and Other use means claude.ai, the Claude app and other people (`T-claude-code-usage.md`).
