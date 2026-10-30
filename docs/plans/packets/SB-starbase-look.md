# Packet SB · Starbase: the theme, Play, the crew and the 3D station

**Goal.** Vignesh, 2026-10-30: "lets also create the 3d theme and play etc for starbase theme, i think foreman works and other crew works but might need a little changing. 3d floor screen needs heavy changes, i would ideally like it to be like a starbase for jobs to be fixed and created. features look different from bug fixes in the floor so they are easy to identify and stuff, lets make it look awesome."

So the app now looks like the place its name describes:
- a **Starbase colour theme**;
- **Play** in Starbase words and pieces;
- the **crew** as station crew;
- the **3D floor** rebuilt as a starbase where features are built and bugs are repaired, which you can tell apart at a glance.

**Port 4519 · worktree `../starbase-SB` · branch `packet/SB-starbase-look`.** Base: `main` after packet Y (the rename) is merged. It runs beside 2D and 2E.

Read first:
- S's brief (`S-builders-3d.md`); its rules all still hold: poses from real state, words always, fixed layout, performance budget, fallbacks;
- R's brief and the design philosophy;
- `web/src/play/floor3d/`;
- `web/src/play/crewPack.ts`;
- the Play pieces from G33.

## 1. The Starbase theme
- **Two new themes, paired** (as Glass and Light glass are):
  - **Starbase:** dark. Deep space navy, brushed hull greys, signal amber and a cool cyan.
  - **Starbase day:** light. Bright hangar white, the same signal colours, darker for contrast.
- **Calm, with colour that pops on small marks** (R's colour rule). Big areas stay quiet.
- **The rules:**
  - every token set, so X's token coverage test passes;
  - the theme sweep (`web/e2e/themeSweep.mjs`) passes with "Every theme passes";
  - contrast holds;
  - no hard-coded colours.
- **Light stays the default theme.** Only Vignesh changes that. In the hand-back, recommend whether Starbase day should become the default.

## 2. Play in Starbase words
Play full and subtle keep their structure (G33 and R's rules), and their wording and pieces become Starbase's:
- the status strip reads as the station's status;
- go / no go stays: it fits;
- bays and docks replace "benches" in Play words;
- Achievements and the Crew-dex get Starbase art and wording.

Plain words still win:
- every Play word sits beside the plain one, or is the plain one;
- Play off shows no theme words at all.

## 3. The crew
**Keep the roles and their names:** Foreman, Builder, Tester, Reviewer, Planner. Vignesh likes them. Change their look:
- **Station crew:** a suit with a helmet. The visor stands in for the face, so they stay nameless and faceless.
- **A shoulder patch** in the colour of the stop they work in.
- **Starbase tools:**
  - Foreman: a holo-slate;
  - Builder: a welder or a multitool;
  - Tester: a scanner;
  - Reviewer: an inspection lens;
  - Planner: a holo-tablet showing a blueprint.
- **Poses and labels** stay tied to real state through `poseFor` and `labelFor`.
- **Helpers** walk in and out through an airlock.
- Update the 2D crew (crewPack) to match, so Play subtle and the 2D fallback agree with the 3D crew.

## 4. The 3D station (the heavy part)
Rebuild the 3D floor as a starbase deck. Rename the Jobs layout from "Floor" to **"Station"** in Look, the switch and the keys sheet.

**Two kinds of bay, told apart by shape first, then by sign and colour.** The kind comes from the job's `kind`: feature or bug. A stack's parts are features.
- **Features: construction bays.**
  - A new module is being built inside a scaffold frame, with a crane or robotic arm above.
  - The module grows with the job's stage:
    - frame (spec and plan);
    - hull plates going on (build);
    - lights coming on (tests);
    - sealed and polished (review);
    - launched, or docked to the station, when merged.
  - Cool cyan work lights. Its sign reads "Building · Invoice export" with a plus-in-a-hex icon.
- **Bug fixes: repair docks.**
  - An existing craft sits in a dry dock with a visible damaged panel.
  - While it's being fixed: sparks, a repair beam, a patch plate.
  - When fixed, the panel is clean, and the craft undocks when merged.
  - Amber hazard stripes on the dock floor. Its sign reads "Repairing · Footer typo" with a wrench icon.
- **A stack (a big feature)** is a larger module made of sections, one per part, assembled in merge order: merged sections are joined, sections at work have their own small crew, and waiting ones are dim frames. Clicking a section opens that part's quick look.

**State on the bay, always in words as well:**
- **Needs you:** a slow amber beacon above the bay; the Foreman turns to you and raises a hand.
- **Asks permission:** a crew member holds up a card.
- **Stuck or failed:** a red hazard light, the "!" sign, and the crew sitting.
- **Paused for the usage limit:** the bay lights dim, with a small clock.
- **Done:** the launch or undock moment plays once, gently; then the bay rests, tidy, with "Done".

**The station around them:**
- a deck with a fixed grid of bays, in the order the jobs started, never reshuffled (S's rule);
- an airlock door;
- big windows on space, with a few still stars, a far planet's edge, no flicker. In Starbase day it's a bright hangar with daylight through the windows.

**Light and colour:**
- read from the theme's tokens, so every theme still works;
- stop hues on small marks, as S's run 2 does;
- the sweep's 3:1 rule for drawn marks applies.

**Driving it** (unchanged):
- hover shows the now line in R's Tooltip;
- click or Enter opens the Peek with Go / No go;
- `j`/`k` and the arrow keys move between bays; `o` opens the job;
- "Fit all", and pinch or scroll zoom within limits;
- the list mirror, for screen readers and for anyone who prefers words;
- reduced motion holds every pose still;
- with no WebGL, the 2D fallback is restyled to match.

**Budget** (unchanged from S):
- 4 ms a frame or less with 12 bays and 30 crew;
- the 3D chunk 250 KB gzipped or less, loaded only in Play full;
- geometry built in code, with no model files.

**Make it look awesome, and check it by eye.** Render each bay kind at every stage and in every state in `#/floor-lab` (rename it `#/station-lab`), in Starbase, Starbase day, Light and Default. Look at the shots at 1× and 2× and keep refining until it's calm, charming and readable. In particular:
- a feature and a fix must be told apart from across the room, even in greyscale (check a greyscale copy of the shot);
- nothing may look like a toy or a placeholder.

## 5. The Stage strip
It shows the job's bay (construction or repair) at its current stage, in the same style.

## Checks
- **Tests:**
  - `kind` → bay type;
  - stage → build progress;
  - every state → its words;
  - stable bay placement;
  - the stack sections;
  - Play off loads no 3D.
- **The theme sweep and contrast for all themes** (now 13 with the Starbase pair), the no-jump check, and the frame-time check with 12 bays.
- **Shots:**
  - before and after at 1512 and 390 px, in Starbase, Starbase day, Light and Default;
  - a station-lab sheet of every bay stage and state;
  - **a 10-second recording** (Playwright video) of the demo's station in Play full, for Vignesh.

## Owns
- `web/src/play/` (all of it, including `floor3d/` and `crewPack.ts`);
- the new theme files in `web/src/theme/themes/` and their entries in `theme.ts`;
- Play wording in the Look settings;
- the Jobs layout name and keys entries;
- the Stage strip;
- the demo's job kinds, if a feature and a fix are both needed in each state;
- the tests for each.

2D and 2E run beside this packet in `hosted/` and the Lounge and Telemetry views. Don't touch those.

## Steps (one commit each, tests green)
1. The Starbase theme pair.
2. The crew: look and props, in 3D and 2D.
3. The station: deck, windows, airlock, bay grid, both bay kinds, and their stages.
4. States on the bays, stacks as modules, and the launch and undock moment.
5. Play words, Achievements and the Crew-dex art, the Stage strip, and the layout renamed "Station".
6. Checks, shots and the recording. Hand back.

## Rules that apply to every packet (read once, obey always)
- **Worktree and branch:** `git worktree add ../starbase-SB -b packet/SB-starbase-look main`. Work only there.
- **Port 4519.** **Never use 4477, 4479, 4485, 4491 or 4505.**
- **Never push, never open a PR, never merge.**
- **Tests:** `npm test`, `npm test -w hosted`, `cd web && npx vitest run` and `npx tsc --noEmit -p .`, green before each commit. **No model calls in tests.**
- **Status is never shown by colour alone. Theme tokens only. Plain words in every string a person reads.** The product is Starbase: take it from `BRAND`/`PRODUCT`.
- **The design philosophy applies.**
- **Hand-back format:** packet id, branch, last SHA, what was done per step, test output tail, anything not done and why, "Needs from others".
