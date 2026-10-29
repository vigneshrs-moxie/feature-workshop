# Packet M · The redesign

**Goal.** One new design for the whole web app: clean lines, simple, fluid, professional, with approving and reviewing that feel light (plan G16, §7). The screens are Inbox, Desk, Jobs (the four lanes), Job, Stage (one stop of a job), Stack and Settings, each with one primary action and its key. Telemetry is drawn on the same wireframe page but built by packet P (`P-telemetry-insights.md`) after this one. The **Ground Control play theme** dresses them in Play full and subtle and is gone in off (G33). **Wireframes come first:** no screen code is written until the wireframes are drawn, reviewed and picked by Vignesh. The chosen options are the brief for the code.

**Port 4481 · worktree `../ground-control-M` · branch `packet/M-redesign`. Depends on A, E and K (A and E are in v1; start after K is merged). Runs beside O, and merges before O.**

## What exists
- **The approved Stack wireframe**, already drawn and reviewed on its own because the Integrate board confused a new user: `~/.claude/wireframes/feature-workshop/stack-page.html` with its build brief `stack-page.brief.md`. Packet K built the Stack page from it (`web/src/views/Stack/`). It is an input here: use its choices (one list in merge order, the four steps, go / no go, the console tiles) for the other screens, and don't redraw it.
- **The Ground Control screens wireframe** (step 1, drawn ahead of this packet): `~/.claude/wireframes/feature-workshop/ground-control-screens.html` with `ground-control-screens.brief.md`, published at https://claude.ai/artifact/VWS7nxyvPvG9ruyxszEufF. Vignesh's first review (2026-10-28) is written out with what each note decides in `docs/plans/packets/M-screens-review-1.md`. In short:
  - Desk: option A (one at a time) is the default, B (three columns) is a choice in Settings → Look. Faint grid lines in Play full.
  - Jobs: option A (four lanes) is the default, B (one list) is a choice in Settings → Look. Each stop dot names its stop and state in a tooltip on hover and focus.
  - Job: option A (a map of stops). Every stop opens the new **Stage** screen: who's working it, what each is doing, Open in terminal for each, the folded conversation. A **permission alert** card with Allow once / Deny sits on Job and Stage.
  - The crew stays, in Play full only: small on each stop circle, full size on Stage. Crew roles are generic and come from one swappable crew pack. The product name comes from one place: "Ground Control" is the working name, not final.
  - Inbox: Orbit has no priority any more; severity only.
  - Telemetry: ten insight graphs, each can fold or hide, moved to packet P.
  Revision 2 draws all of this. **Approved on 2026-10-29** ("the design is great"); the open questions take what the page draws, listed under "Review 2" in the same file. Two additions: Telemetry's week starts Wednesday 16:00 local (packet P), and the Classic view becomes an easter egg (step 4).
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
`web/src/**` except what O changes (O doesn't change web files) and the Telemetry page (`web/src/views/Telemetry*`, packet P's), the Stage screen's data (`dashboard/lib/stage-view.js`, new: who is on a stop and what each is doing, from the job's thread and crew events; `dashboard/site/routes-stage.js`, new, and its line in `dashboard/site/index.js`; the "follow a crew member's log in the terminal" command, its one case in `dashboard/runner/index.js` next to the existing continue-in-terminal; `dashboard/test/stage-view.test.js`, new), the crew pack and the product name (`web/src/play/crewPack.ts` and `web/src/app/brand.ts`, new, read by everything that shows a crew name or the product name), the lane function in `dashboard/lib/snapshot.js` (`laneFor`, new, and the lane on each job card), the brand words in `dashboard/public/index.html` and `web/index.html`, the wireframe pages and briefs this packet draws in the wireframe skill's folder for this app (outside the repo, written by the skill), and `dashboard/test/lanes.test.js` (new).

## Steps
1. **Wireframes first; no screen code before step 2.** Done ahead of this packet and approved (revision 2, 2026-10-29). Start at step 2. The picks are in the screens page's build brief and in `M-screens-review-1.md`; where they and this file disagree, they win. The original instructions, for any later revision: With the `wireframe` skill, hi-fi, in the app's own design (its cache above), draw **Inbox, Desk, Jobs, Job and Telemetry**, and take **Stack** from the approved Stack wireframe instead of redrawing it.
   - Show each screen with the Ground Control play theme in its three modes: full (the status board strip with jobs by lane, the clock in local time and UTC, the gauge; console tiles with a small live readout and a soft blinking light while the Foreman works; gates as go / no go), subtle (tiles and wording, no strip, clock or animation) and off (none of it, same facts).
   - Draw two options side by side wherever there is a real choice: for example the Desk's three columns against a single column with a queue drawer; the Job page's track of pills against a stage list; how a stack row expands in Jobs; the phone-width top bar (a short form against an overflow menu).
   - Mark each screen's one primary action and its key: Inbox Start `s`; Desk Approve `a`, Send back `r`, Reply `c`; Jobs Open `o`; Job by stage; Settings Save; Telemetry Read now.
   - Draw the phone width for each screen.
   - Publish the pages and send Vignesh the links. Stop until he has reviewed them, then read his picks, verdicts and notes back and revise in place until every screen is approved. Record the picks in each page's build brief. Those briefs are this packet's spec from here on; where they and this file disagree, the briefs win.
2. **Tokens and the base pieces.**
   - Buttons, rows, tabs, chips and menu items are at least 40 px tall, with a visible hover and focus state from the tokens.
   - Transitions are 200 ms or shorter, and nothing moves under the pointer (no layout shift on hover, no row that jumps lanes while being pointed at).
   - Shared chart tokens `--chart-1` to `--chart-8` in `tokens.css` and every theme, each with a matching pattern. Packet P moves `Telemetry.css` off `--tele-*` onto them; leave Telemetry's files alone.
   - Every theme gets the same tokens; a theme changes looks only.
   - Put the shared shapes in `web/src/api/types.ts`.
3. **The four lanes** (`snapshot.js` `laneFor`): Working (running), Needs you (a gate, a permission, a question, a stuck section, a PR feedback card), In review (a PR open and waiting on others), Ready to merge (checks green, approvals in). Each job card carries its lane and the reason in words. `lanes.test.js` covers each case from fixture jobs.
4. **The screens**, built from the approved wireframes:
   - Inbox (severity only: no priority in the rows, the card, the next-step bar or the sort; "most urgent" is the highest severity, then the oldest); Desk; Jobs (the four lanes, a stack as one row that expands, the stop-dot tooltip on hover and focus); Job (the map of stops, each stop opening its Stage; the tabs Brief, Spec, Plan, Code, Tests with L's evidence inline, Review, Decisions, Ship); Stage (`#/job/<slug>/stage/<stop>`: who's on the stop, what each is doing in one plain line, Open in terminal for each and for the job's folder, the stop's folded conversation and the message box); Stack (keep K's page, restyled only where the tokens change); Settings (the sections in the new look, as drawn for Settings → Look). Telemetry is packet P's.
   - **Layout choices in Settings → Look**, kept in the browser like the theme: Desk layout "One at a time" (default) or "Three columns", and Jobs layout "Four lanes" (default) or "One list". Both layouts of each are built and tested; the setting only picks one.
   - **Permission alert**: the card on Job and Stage (and in the Desk queue) as drawn: what the Foreman wants to do in words, the exact command folded underneath, why it asked, Allow once and Deny, "Always allow for this job" only where the permission setting allows remembering it, never for hard-line actions, and `a` never allows a hard-line action. "2 more waiting" under it, oldest first. Built on `web/src/components/permissions/PermissionCard.tsx`.
   - **Open in terminal on Stage** uses the terminal app chosen in Try it. The Foreman's row continues the job's own session there (today's continue-in-terminal). A crew member's row follows its live log, read-only: a crew member's run can't be taken over, so the row says "Watch in terminal" and the Foreman stays the one to talk to.
   - **Classic view is an easter egg.** Take every mention out of the new app: the top-bar link (`App.tsx`), the gear menu, help text (the Foreman pane's "links to its classic page" and the like), the `?` key sheet and Settings → Keys. The only way in from the new app is the command box: ⌘K (Ctrl+K), type `classic`, Enter. That command has no row in the list and appears only on that exact word; it opens the classic page for the job you have open, else its home, as `classicHref` does today. The classic page keeps its "New view" button. A test checks the word "Classic" appears nowhere in the rendered app, and that the exact word in the command box opens it.
   - **The product name comes from `brand.ts`**: the top bar, page titles and both `index.html` files read it. It says "Ground Control" for now; the name isn't settled, so nothing else spells it.
   - The top bar at phone width uses the picked short form or overflow menu.
   - The old Home, Map and Table views go only if the wireframe review says so; otherwise they get the new look.
5. **The play theme** (`web/src/play/`): the status strip, the console tiles and the go / no go framing, shown in Play full, partly in subtle, none in off, as drawn. Animation stops when the system asks for reduced motion. The existing crew, eggs and Play page stay and keep working. **The crew in the new screens, Play full only:** a small face on each stop circle of the Job map (who works that stop) and the full-size crew member on each Stage row; subtle and off show initials and the role word. **The crew is generic and swappable:** names, roles, hats and tools move from `crew.ts` into one crew pack (`crewPack.ts`) with generic roles (Planner, Builder, Tester, Reviewer and the rest, matching `dashboard/lib/stages.js` AGENTS), so renaming the product or its theme means changing that one file. The Crew-dex reads the pack.
6. **The lock on the page (left open from v1).** `LockCard` shows in the Composer and on the GateCard when the job's snapshot has a `lock` held elsewhere, or when a send or a gate answer comes back refused with the lock error (`lockFromError`): "This job is being driven from a terminal (pid 4182, branch feature/orbit-479-x) since 14:02." While it shows, the reply box and the gate's buttons are off, with the reason next to them.
7. **Keys (left open from v1).** Every page key is in `keyRegistry.ts` with its scope: Inbox's `s`; the Desk's, Jobs', Job's and Stage's primary keys (Telemetry's keys are packet P's); K's Stack keys kept. Settings → Keys lists them all. Keys never fire while typing or with a dialog open.
8. **Checks a person doesn't have to do by hand.**
   - CSS tests in the style of the existing `*Css.test.ts`: every interactive class has a 40 px minimum height; no transition is longer than 200 ms; no literal colour outside the theme files.
   - The theme tests check every theme defines every token.
   - Tests that status always has words or an icon next to its colour.
   - Using L's Playwright setup (on this packet's port only), screenshots of each screen at 390 px wide in each theme, in light and dark, and a check that the page's width is never wider than the window (no horizontal scroll).
9. **Vignesh's click-through.** Hand back with a list of every screen × the three Play modes × every theme, the address of each, and space for his notes. Fix what he finds, then ask again.

## Acceptance
§7's screens exist with their keys, every theme is checked, status is never shown by colour alone, and nothing scrolls sideways at phone width (plan §11 M). The wireframes for Inbox, Desk, Jobs, Job, Stage and Settings → Look were drawn and approved before any screen code, and the screens match the picks: both layouts of the Desk and of Jobs work and Settings → Look switches them; every stop on the Job map opens its Stage, and each agent there opens in the terminal; the permission alert answers in place; the crew shows in Play full only; the product name and the crew come from one file each; the Inbox never shows priority. The Stack page matches the approved Stack wireframe. The lock card shows when a job is held elsewhere; every page key is in Settings → Keys; charts use `--chart-*`. And §7's quality bar, word for word:

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
