# Handoff: Feature Workshop after the Light round (written 2026-10-22, for the next chat)

**Where the work is**
- **Dashboard:** `~/Projects/feature-workshop` is `main @ 2a8b12c` (old). The redesign is in the worktree `~/Projects/feature-workshop-phase1` on **`redesign/orbit-ready`** (7 commits on top of main, `git log 2a8b12c..`), **pushed** to `origin/redesign/orbit-ready`. Not merged.
- **Skill repo:** `~/Projects/claude-feature-workflow` `main @ 8592c03`, pushed; linked into `~/.claude/skills` and `~/.claude/agents`, so edits are live. It also carries a restructure from another chat (`4898eeb`): a generic `wireframe` skill, with `feature-wireframe` as its job-mode wrapper and the `feature-wireframer` worker.
- **Plan:** `docs/plans/light-2026-10-21.md` (the asks, the Kingdom wireframe takeaways, §1–§12). **Screenshots:** `docs/design/light-2026-10-21/` with a README (demo walk-through 48/48, no console errors).

**Running it**
- Work in the worktree: `cd ~/Projects/feature-workshop-phase1`. Build the web app with `npm run web:build` (writes `web/dist/` and the classic page's `theme.css`).
- The user's real dashboard on **4477** (pid may differ) was still the OLD main checkout at the time of writing. To run the new code for real, stop it first (two real dashboards would drive the same Foreman sessions), then `npm start` from the worktree and open http://127.0.0.1:4477/next/. The screens page is served from a second local origin on **PORT+1** (4478); `WIREFRAMES_PORT` overrides it.
- A demo of the new build may still be up on **4482** (started 2026-10-21 from this worktree with its own state dir; harmless; `lsof -iTCP:4482` to check, kill it when done). Port **4479** is the user's own demo: never touch it.
- Isolated demo: `PORT=4480 TMPDIR=<scratch> WORKSHOP_STATE_DIR=<scratch>/state node dashboard/demo/run-demo.js`. Headless Chrome scripts from the walk-through (DevTools protocol, no npm deps) were in the old session's scratchpad (`light/harness.mjs`, `walk.mjs`, `shots*.mjs`); rebuild one if needed.
- Tests: `npm test` (dashboard, 352), `npm run web:test` (721), `cd web && npx tsc --noEmit -p .`.

**Rules**
- Never push or merge without the user's request. Confirm before anything outward-facing.
- Theme tokens only; check all **11** themes (`?theme=<id>`: default, neon-arcade, blueprint, pixel-crew, sunset-paper, candy-pop, glass, light, light-glass, crt, gold). Floating or sticky surfaces in both Glass themes use `--glass-float`.
- Status is never shown by colour alone. Keys never fire while typing or with a dialog open, and only through the registry.
- Play Off: the page is the phase 2 page plus this round's gate-card change; its inline snapshot is in `web/src/panes/Foreman/ThreadCrew.test.tsx`.
- No model calls in tests. The dashboard never publishes, merges or calls a model.

## What the Light round built (and where)

1. **Finish line** (Settings → Workflow, `settings.workflow.finishLine`: `pr1-open` · `pr1-merged` (default) · `staging` · `main` · `marked`). `dashboard/lib/finish.js` (`finishLineReached`); every card carries `finish: { reached, at, by, landed }`; used by `lib/play.js` (quest done), `lib/snapshot.js` `groupFor` (new **Shipping** group between Idle and Done), `server.js` `flowNotices` (Done once; "Landed in staging/main" quiet). The trail's goal flag follows it (`web/src/play/extrasModel.ts` `goalStop`).
2. **Keys**: `web/src/app/keyRegistry.ts` (`KEYS`, scopes desk > gate > job > map > rows > table > settings > sheet > global, chords `g h/t/d/s/x`, Enter/Space never steal a focused control), `keysSetting.ts` (`fw.keys` on/off, hints), `components/Kbd.tsx`, the `?` sheet `views/JobSheets/KeysSheet.tsx` generated from it. Gate keys `a e r o . v 1–3`; desk `j k ↑ ↓ o a d b`; map `j k Enter o / 1–4`; job `n i [ ]`; settings `j k /`.
3. **Look**: text size `web/src/theme/textSize.ts` (`workshop.textSize`, `--ui-scale` in `tokens.ts`), themes `themes/light.css` and `themes/light-glass.css`, Follow the system (`workshop.themeFollow`, pairs in `theme.ts`), swatch grid `views/Settings/ThemePicker.tsx` + `theme/look.css`; the classic page follows via `dashboard/public/theme-boot.js` and `ui.js`.
4. **Settings**: `views/Settings/SettingsView.tsx` (rail, search, `sections.ts`), `WorkflowSettings.tsx` (finish line, `wireframes`, `clarify` defaults → `lib/state.js` `workflowSettings`, applied to new jobs' options in `lib/options.js`), `KeysSettings.tsx`, `LookSettings.tsx`; routes `#/settings/<section>` in `app/router.ts`. The in-browser alerts live in Notifications now.
5. **Home**: `web/src/home/FlowMap.tsx` (rows, `ShipTrack`, release line, chips, Done fold, `map` keys), `homeModel.ts` (`nextHint`, `whereLine`, `trackStops`, `finishStop`, `groupLanes`, `releaseLine`), `home.css`. Table: Shipping chip and a Where column.
6. **Job view**: sticky header (`app.css` `.pane-foreman .job-header`, `--job-header-h`, scroll-padding), `panes/Foreman/GateCard.tsx` (one primary, link-buttons, `<details class="gate-adjust">`, `<details class="gate-decided">`, "Approve is off:" list), `JobHeader.tsx` (facts line: cost only over $0.10, policy only when not default). The trail names only the current stop, the goal and the first stop after it (`QuestStop.named`).
7. **Desk**: `home/DeskView.tsx` (three columns, brief open, `b`), `home/nudges.ts` (`deskEntries`, Decided today store); server `lib/nudges.js` (`nudgesFor`: pr1-merge, pr2-open, pr2-review, pr2-changes, pr2-merge; `afterLine`), routes `POST /api/job/:slug/nudge/:id/dismiss` and `/yes` (sent only after the send starts; `sentNudges`/`dismissedNudges` in the session record). The Desk count (top bar only) = decisions + nudges before the line.
8. **Screens stage and Clarify**: stages `clarify` (before spec) and `wireframe` ("Screens", after refine) in `lib/stages.js`, `lib/options.js` LEVELS (L0/L1 skip both unless `always`), web `panes/Jobs/stages.ts`, `lib/levels.ts`, `play/extrasModel.ts`, `play/crew.ts` (wireframer → Painter). The page: `lib/docs.js` `readWireframes`; the **screens server** in `server.js` (second origin, `GET /job/:slug/wireframes` only, `frame-ancestors` the dashboard, `meta.wireframesOrigin`, null when its port is taken); web `panes/Preview/wireframes.ts` + `ScreensTab.tsx` (origin-checked postMessage: `wireframes`, `wireframes-goto`, `wireframes-feedback`, `wireframes-escape`), `views/Screens/ScreensView.tsx` (`#/job/<slug>/screens`), gate card `ScreensRow`; `questions[].options[].consequence` rendered under options. Demo jobs: `tag-filter-screens` (Screens gate), `office-hours` (Clarify).

## Reviews so far

Three independent reviews (rounds 1–2, round 3, the fixes) and the demo walk-through; every finding was fixed, including a blocker (the wireframe page first ran in the dashboard's origin). Known leftovers: the "Approve is off" list has no "hard line" source on a gate; reviewer names aren't in the flow's PR data (hints say "Waiting for a review on PR #2 · 3 d"); the wireframe gate card shows named chips, not thumbnails; a sent `pr2-review` nudge stays hidden if the review state later goes back to "review required" on the same PR.

## Bugs the user found (to do first)

The user tested the new build and found a few bugs. Ask for the list (or read it from the message that opens the next chat), reproduce each on the isolated demo or the real dashboard, fix with a test, run both suites and tsc, and commit on `redesign/orbit-ready`. Keep the rules above.

## Then, each on the user's word

Merge `redesign/orbit-ready` into `main`; run `install.sh` in the skill repo (backs up current skills first); a shakedown Orbit job at L0 or L1.
