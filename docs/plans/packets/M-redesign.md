# Packet M · The redesign

**Goal.** One new design for the whole web app: clean lines, simple, fluid, professional, with approving and reviewing that feel light (plan G16, §7). The screens are Inbox, Desk, Jobs (the four lanes), Job, Stack, Settings and Telemetry, each with one primary action and its key. The **Ground Control play theme** dresses them in Play full and subtle and is gone in off (G33). **Wireframes come first:** no screen code is written until the wireframes are drawn, reviewed and picked by Vignesh. The chosen options are the brief for the code.

**Port 4481 · worktree `../ground-control-M` · branch `packet/M-redesign`. Depends on A, E and K (A and E are in v1; start after K is merged). Runs beside O, and merges before O.**

## What exists
- **The approved Stack wireframe**, already drawn and reviewed on its own because the Integrate board confused a new user: `~/.claude/wireframes/feature-workshop/stack-page.html` with its build brief `stack-page.brief.md`. Packet K built the Stack page from it (`web/src/views/Stack/`). It is an input here: use its choices (one list in merge order, the four steps, go / no go, the console tiles) for the other screens, and don't redraw it.
- **The wireframe skill's design cache** for this app: `~/.claude/wireframes/feature-workshop/design.md` and `theme.css`, read from `web/src/theme/tokens.css`, `web/src/theme/themes/light.css`, `web/src/app/app.css` and `web/src/app/App.tsx` on 2026-10-28. New pages go next to it (`<slug>.html`, `<slug>.brief.md`), and the gallery is `~/.claude/wireframes/index.html`.
- **The app today**:
  - `web/src/app/App.tsx`: the top bar with the brand "Feature Workshop", the links Telemetry, Inbox, Desk, Crew-dex, Stacks (K), Settings and Classic view, and the usage meters. The top bar doesn't fit at phone width.
  - `web/src/app/router.ts`: home, table, desk, inbox, `settings/<section>`, crew, achievements, job, screens, stacks and stack, telemetry.
  - `web/src/home/` (HomeView, DeskView, FlowMap, TableView).
  - `web/src/panes/Jobs/` (JobsPane, JobRow, jobStatus).
  - `web/src/panes/Foreman/` (JobHeader, GateCard, Composer, ThreadItems, LevelCard and others).
  - `web/src/panes/Preview/` (TryTab, DecisionsTab, CopyForTicket).
  - `web/src/views/` (Inbox, Telemetry with `Telemetry.css`, Settings, Stack, JobLock, Screens, CrewDex, Achievements).
  - `web/src/play/` (crew, eggs, floor; `settings.ts` `PLAY_MODES` full, subtle, off).
  - `web/src/theme/` (`tokens.css`, twelve themes in `themes/`: default, light, glass, light-glass, blueprint, candy-pop, crt, daylight, gold, neon-arcade, pixel-crew, sunset-paper; `THEMING.md`).
  - Buttons are 28 px tall.
- **Lanes:** `dashboard/lib/snapshot.js` groups jobs as needs-you, running, paused, idle, shipping, done, and `dashboard/lib/flow.js` `laneOf()` places them for the Flow map. The plan's four lanes (Working, Needs you, In review, Ready to merge) don't exist yet.
- **Left open from v1:**
  - `web/src/views/JobLock/LockCard.tsx` (`lockFromError`, `LockCard`) is built but used nowhere. G put the lock in the job snapshot (`lock: { owner, pid, branch, acquiredAt }`).
  - `web/src/app/keyRegistry.ts` has no entries for the Inbox's `s` or Telemetry's keys (Read now, the arrow keys on the weekly line), so Settings → Keys doesn't list them.
  - `Telemetry.css` uses its own `--tele-1` to `--tele-8` colours instead of shared chart tokens.
  - Several shapes are typed in the files that use them instead of in `web/src/api/types.ts` (plan usage warnings, the notification `usage` level, Telemetry's data, the Inbox's tickets).

## Owns
`web/src/**` except what O changes (O doesn't change web files), the lane function in `dashboard/lib/snapshot.js` (`laneFor`, new, and the lane on each job card), the brand words in `dashboard/public/index.html` and `web/index.html`, the wireframe pages and briefs this packet draws in the wireframe skill's folder for this app (outside the repo, written by the skill), and `dashboard/test/lanes.test.js` (new).

## Steps
1. **Wireframes first; no screen code before step 2.** With the `wireframe` skill, hi-fi, in the app's own design (its cache above), draw **Inbox, Desk, Jobs, Job and Telemetry**, and take **Stack** from the approved Stack wireframe instead of redrawing it.
   - Show each screen with the Ground Control play theme in its three modes: full (the status board strip with jobs by lane, the clock in local time and UTC, the gauge; console tiles with a small live readout and a soft blinking light while the Foreman works; gates as go / no go), subtle (tiles and wording, no strip, clock or animation) and off (none of it, same facts).
   - Draw two options side by side wherever there is a real choice: for example the Desk's three columns against a single column with a queue drawer; the Job page's track of pills against a stage list; how a stack row expands in Jobs; the phone-width top bar (a short form against an overflow menu).
   - Mark each screen's one primary action and its key: Inbox Start `s`; Desk Approve `a`, Send back `r`, Reply `c`; Jobs Open `o`; Job by stage; Settings Save; Telemetry Read now.
   - Draw the phone width for each screen.
   - Publish the pages and send Vignesh the links. Stop until he has reviewed them, then read his picks, verdicts and notes back and revise in place until every screen is approved. Record the picks in each page's build brief. Those briefs are this packet's spec from here on; where they and this file disagree, the briefs win.
2. **Tokens and the base pieces.**
   - Buttons, rows, tabs, chips and menu items are at least 40 px tall, with a visible hover and focus state from the tokens.
   - Transitions are 200 ms or shorter, and nothing moves under the pointer (no layout shift on hover, no row that jumps lanes while being pointed at).
   - Shared chart tokens `--chart-1` to `--chart-8` in `tokens.css` and every theme, each with a matching pattern, replace `--tele-*` in `Telemetry.css`.
   - Every theme gets the same tokens; a theme changes looks only.
   - Put the shared shapes in `web/src/api/types.ts`.
3. **The four lanes** (`snapshot.js` `laneFor`): Working (running), Needs you (a gate, a permission, a question, a stuck section, a PR feedback card), In review (a PR open and waiting on others), Ready to merge (checks green, approvals in). Each job card carries its lane and the reason in words. `lanes.test.js` covers each case from fixture jobs.
4. **The screens**, built from the approved wireframes:
   - Inbox; Desk; Jobs (the four lanes, a stack as one row that expands); Job (the track, the tabs Brief, Spec, Plan, Code, Tests with L's evidence inline, Review, Decisions, Ship); Stack (keep K's page, restyled only where the tokens change); Settings (the sections, in the new look; no separate wireframe, it follows the picks for the others); Telemetry.
   - The brand becomes "Ground Control" in the top bar and the page titles.
   - The top bar at phone width uses the picked short form or overflow menu.
   - The old Home, Map and Table views go only if the wireframe review says so; otherwise they get the new look.
5. **The play theme** (`web/src/play/`): the status strip, the console tiles and the go / no go framing, shown in Play full, partly in subtle, none in off, as drawn. Animation stops when the system asks for reduced motion. The existing crew, eggs and Play page stay and keep working.
6. **The lock on the page (left open from v1).** `LockCard` shows in the Composer and on the GateCard when the job's snapshot has a `lock` held elsewhere, or when a send or a gate answer comes back refused with the lock error (`lockFromError`): "This job is being driven from a terminal (pid 4182, branch feature/orbit-479-x) since 14:02." While it shows, the reply box and the gate's buttons are off, with the reason next to them.
7. **Keys (left open from v1).** Every page key is in `keyRegistry.ts` with its scope: Inbox's `s`; Telemetry's Read now and its arrow keys; the Desk's, Jobs' and Job's primary keys; K's Stack keys kept. Settings → Keys lists them all. Keys never fire while typing or with a dialog open.
8. **Checks a person doesn't have to do by hand.**
   - CSS tests in the style of the existing `*Css.test.ts`: every interactive class has a 40 px minimum height; no transition is longer than 200 ms; no literal colour outside the theme files.
   - The theme tests check every theme defines every token.
   - Tests that status always has words or an icon next to its colour.
   - Using L's Playwright setup (on this packet's port only), screenshots of each screen at 390 px wide in each theme, in light and dark, and a check that the page's width is never wider than the window (no horizontal scroll).
9. **Vignesh's click-through.** Hand back with a list of every screen × the three Play modes × every theme, the address of each, and space for his notes. Fix what he finds, then ask again.

## Acceptance
§7's screens exist with their keys, every theme is checked, status is never shown by colour alone, and nothing scrolls sideways at phone width (plan §11 M). The wireframes for Inbox, Desk, Jobs, Job and Telemetry were drawn and approved before any screen code, and the screens match the picks. The Stack page matches the approved Stack wireframe. The lock card shows when a job is held elsewhere; every page key is in Settings → Keys; charts use `--chart-*`. And §7's quality bar, word for word:

> Nothing chunky, nothing hard to click, nothing that needs explaining. Every clickable thing is at least 40 px tall with a visible hover and focus state. Every screen has one obvious next step. Transitions are under 200 ms. No element moves under the pointer. The design packet is not accepted until Vignesh has clicked through every screen in all three play modes and every theme without finding one thing that feels off.

All tests green.

## Verify
```
PORT=4481 npm start   # http://127.0.0.1:4481/next/: every screen, Play full / subtle / off, every theme, at 390 px wide too
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
