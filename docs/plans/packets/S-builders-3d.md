# Packet S · Builders in 3D

**Goal.** Make the agents feel like real builders you are steering. Each job is a workbench on a small 3D workshop floor. The Foreman and its crew are simple, nameless figures at the bench. What each figure is doing is what that agent is really doing: reading, building, running tests, waiting for you, stuck, done. Asked for by Vignesh on 2026-10-28: "add a little bit of a 3d element … have it feel like the agents working on them (for now, nameless and not any theme specific …) are actually real agents aka a personification of this agentic ai building so that it can feel like im actually controlling several actual builders". On 2026-10-29 he said "just build it anyway, assume i said yes to it".

**Port 4495 · worktree `../ground-control-S` · branch `packet/S-builders-3d`.** It runs beside R in two runs:
- **First run, now:** only new files, plus one host change on the existing workshop floor.
- **Second run, after R is merged:** wiring into Jobs, the Stage and Settings → Look, so it is built on R's controls and layout instead of being restyled.

## Where it lives (and where it doesn't)
The 3D floor is part of **Play full**. Play subtle and Play off never load or draw any 3D. This keeps it in line with R's "simple by default" rule and the review-1 rule that the crew is Play full only. It shows in two places:
1. **The floor.** A third Jobs layout, "Floor", beside Four lanes and One list (Settings → Look, and a switch in the Jobs header in Play full). It replaces the 2D workshop floor (`web/src/play/WorkshopFloor.tsx`) in Play full, and that 2D floor stays as the fallback.
2. **The Stage strip.** In Play full, the Stage shows that job's bench in 3D at the top: a fixed 220 px band that folds to a slim line. The crew rows stay below it, unchanged.

Nowhere else gets 3D: no 3D on the Desk, Inbox, Telemetry or Settings.

## The builders
- **One figure for everyone:** simple, friendly and low-poly. A rounded body, a round head with no face, and two hands. No names, no theme skins, no faces.
- **Roles by prop, in words on hover:**
  - the Foreman holds a clipboard;
  - the Builder has a hammer;
  - the Tester has a flask;
  - a Reviewer has a magnifier;
  - the Planner has a ruler.
  The props come from the generic tools already in `play/crewPack.ts`. The role's word ("Builder") is shown on hover and in the label. Crew names and hats from the crew pack are not used.
- **Colours from the theme's tokens** (accent, neutrals, the status tints), read from CSS at run time, so the floor fits every one of the 11 themes and changes when the theme changes. No colours of its own.
- **Poses from real state** (a pure function, `poseFor(agent)`, from the same data the Stage uses: `lib/stage-view.js`, the crew activity, the job card):
  | What the agent is doing | Pose | Label under it (always, in words) |
  |---|---|---|
  | reading files or searching | holds a sheet, head tilts as it reads | "Builder · reading merge.ts" |
  | editing files | works at the bench (hammer taps or typing) | "Builder · editing merge.ts" |
  | running a command or tests | turns a crank; a small lamp counts up | "Tester · running npm test · 212 of 577" |
  | waiting for you (a gate, a question) | turns to face you and raises a hand | "Foreman · waiting for your go-ahead · 35m" |
  | asking permission | holds up a card | "Builder · asks to run a command" |
  | stuck or failed | sits on a crate, with a "!" sign | "Tester · stopped: 3 tests failed" |
  | paused for the usage limit | sits, with a small clock | "Paused until the limit resets, 4 pm" |
  | finished | tidies the bench, then rests | "Done" |
  Status is never shown by colour or pose alone: every figure always has its words.
- **Helpers come and go.** A sub-agent walks in from the floor's door to its job's bench when it starts, and walks out when it finishes. The Foreman stays at the head of the bench.

## The floor
- **Benches in a fixed grid**, in the order the jobs started. A new job takes the next free bench, and a finished job's bench stays where it is until the next visit. Benches never reshuffle (R's "nothing moves that you didn't move").
- **Camera:** a fixed three-quarter view from above with a soft, still light. No dragging the camera around. There is a slight parallax on pointer move, which is off with reduced motion, and a "Fit all" button. Zoom with the pinch or scroll gesture, kept within limits.
- **Driving it:**
  - Hovering over a figure shows its now line in the app's Tooltip.
  - Clicking a bench or a figure opens the job's **peek sheet** (R's), with the ask and Go / No go, so you can steer each builder without leaving the floor.
  - Keys: arrows or `j`/`k` move between benches, Enter opens the peek, `o` opens the job, and Esc closes. They are registered in `keyRegistry.ts` under a `floor` scope.
- **A plain list mirrors the floor** for screen readers and for anyone who prefers words. It has one row per bench with the job, the stop, and each figure's label, and it can be switched to with "Show as a list".
- **Phone width:** the floor becomes a single column of benches, each seen from the front at the same height. Or, if that runs poorly, it falls back to the 2D floor.

## Built to be light
- **three.js** is bundled from npm with an exact version at least two weeks old, in a chunk that loads only when the floor or the strip is first shown in Play full. All geometry is built in code: no model files, no textures to fetch. The chunk is at most 250 KB gzipped.
- **Rendering:**
  - One renderer per page; the pixel ratio is capped at 2.
  - It renders only while something moves, at most 30 frames a second, and stops when the tab is hidden or the floor scrolls out of view.
  - Everything is disposed when you leave.
  - The target is under 4 ms a frame on an Apple-silicon Mac with 12 benches and 30 figures.
- **Fallbacks:**
  - Without WebGL, the 2D floor shows instead, with the same words.
  - With reduced motion, figures hold their pose and don't walk or animate.

## Owns
**First run:**
- `web/src/play/floor3d/` (new): the scene, figure, bench, props, poses, animation, the data hook, the list mirror and tests;
- `web/src/play/WorkshopFloor.tsx`, only to host the 3D floor in Play full with the 2D fallback;
- `three` in `web/package.json` and the lock file.

**Second run (after R is merged):**
- the Jobs layout switch (Floor);
- the Stage strip;
- the Look setting;
- the `floor` key scope in `keyRegistry.ts` and the keys sheet group;
- the peek sheet hook-up.

## Steps
**First run** (stop after step 3 and hand back):
1. **The scene kit:**
   - the figure, with its parts and the five role props;
   - the bench, the floor, the door and the light;
   - the token-driven materials, which update when the theme changes;
   - every pose and the walk in and out, as small, readable animations (120–600 ms each, eased);
   - a test page reachable only by address (`#/floor-lab`, never linked or named) that shows every pose for every role in Light and Default, for checking by eye.
   - **Tests:** pose mapping, the token read and disposal (with three mocked where needed).
2. **Real data to poses:**
   - `poseFor` and `labelFor` from the job card and the crew activity, with unit tests for every row of the table above;
   - stable bench assignment, with a test that benches never reshuffle as jobs come, wait and finish;
   - the demo's jobs drive the floor: Working, Needs you, a permission, a failed test, a limit pause, done.
3. **The floor itself:**
   - in Play full it replaces the 2D workshop floor, at its current place;
   - hover, click to the job, the plain list mirror, reduced motion, the no-WebGL fallback, and phone width;
   - Playwright screenshots at 1512, 1728 and 390 px in Light and Default, using Chromium's software WebGL, plus a frame-time check over 10 seconds with 12 benches.

**Second run** (after R is merged):

4. Floor as a Jobs layout, with its keys, the peek sheet, and the Look setting.
5. The Stage strip.
6. Full checks across themes and widths, and before/after shots.

## Acceptance
- In Play full, the floor shows each running job as a bench with its Foreman and crew, and each figure's pose and words match what that agent is really doing.
- Helpers walk in and out.
- Clicking a bench lets you steer that job.
- Benches never reshuffle.
- Play subtle and off load no 3D at all.
- There is a list mirror and a no-WebGL fallback.
- Frame time is under budget.
- All 11 themes work.
- All tests are green, with no model calls.

## Rules that apply to every packet (read once, obey always)
- **Base:** `main` of the dashboard repo.
- **Worktree and branch:** `git worktree add ../ground-control-S -b packet/S-builders-3d main` from the main checkout. Work only there.
- **Port:** 4495 (screens server 4496).
  - **Never use 4477 (Vignesh's live dashboard), 4479 (his demo) or 4485 (his test server).**
  - 4481, 4483, 4487, 4489, 4491 and 4493 are demos or R's; leave them alone.
- **Owned files only.** If you need a change elsewhere, write it under "Needs from others" in your hand-back. R is restyling everything else at the same time, so don't touch R's files.
- **Tests:** `npm test` and `cd web && npx vitest run` (and `npx tsc --noEmit -p .`), green before each commit. **No model calls in tests.**
- **Never push, never open a PR, never merge.** Commit locally, one commit per step, plain messages.
- **Status is never shown by colour alone; themes change looks only; keys never fire while typing or with a dialog open.** Use theme tokens, not literal colours.
- **Plain words** in every string a person reads. The product's name is "Dashboard" for now; take it from `BRAND`/`PRODUCT`, never spell a name.
- **The design philosophy applies:** `docs/design/design-philosophy.md`. Calm, one line of "now", nothing jumps, no browser look, every small part meticulously made.
- **Hand-back format:** packet id, branch, last SHA, what was done per step, test output tail, anything not done and why, "Needs from others".
