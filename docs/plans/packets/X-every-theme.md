# Packet X · Every element works in every theme

**Goal.** Vignesh, 2026-10-30: "glass theme breaks a lot of things, make sure to check ui there and make sure every ui element in every theme works exactly as expected." R, S, V and W were built and checked mostly in Light and Default. This packet checks every screen and every control in all 11 themes, Glass and Light glass first, and fixes what breaks. It also leaves a check behind, so a theme can't quietly break again.

He also said text boxes and dropdowns "look okay", so their quiet edges stay as they are. Don't make field edges louder.

**Port 4503 (screens 4504) · worktree `../ground-control-X` · branch `packet/X-every-theme`.** Base: `main`.

## The themes
These are the ids in `web/src/theme/theme.ts`:
- **Original:** default, light, neon-arcade, blueprint, pixel-crew, sunset-paper, candy-pop, glass, light-glass.
- **Unlocked:** crt, gold. Unlock them in the demo, or set them directly through settings.
- **Following the system:** check the dark and light pair switching too.

## 1. Find what breaks (look first, fix second)
Build a Playwright sweep, `web/e2e/themeSweep.mjs`, that visits every screen in every theme. It must be re-runnable.
- **Screens:**
  - Jobs in each layout (lanes, list, floor), Map and Table;
  - the Desk, the Inbox, a Job and the Stage;
  - Screens, the Crew-dex and Achievements;
  - Stacks, the build stack, a Stack in Board, Map and Timeline, and a Part page;
  - Telemetry;
  - every Settings section;
  - floor-lab, Not found, the classic page and #/gallery (R's control gallery, which has every control in every state).
- **Overlays:** open each kind at least once per theme:
  - a Peek sheet, a dialog, a Select menu, a Tooltip, the command search and the keys sheet;
  - a toast, the level sheet, a confirm (Merge asks first), a permission card and the next-step bar.
- **States:** hover, focus-visible (keyboard), pressed, disabled, selected, loading (`Pending`), empty, error.
- **Widths and modes:** 1512 and 390 px, in Play full and in Play off.
- **For each visit, record:**
  - console errors;
  - text contrast (4.5:1 for body text, 3:1 for large text and marks);
  - see-through surfaces that make text unreadable: text over the aurora, or a menu or tooltip with no solid enough backing;
  - elements with no visible edge or fill, where a control can't be told from the page;
  - focus rings that can't be seen;
  - horizontal scroll;
  - anything clipped or overlapping;
  - SVG and canvas pieces (graphs, the 3D floor, the merge map, sparklines) that use a colour invisible on that theme.
- **Output:** a contact sheet per theme in the scratchpad, and a findings list (theme, screen, element, what's wrong, measured numbers).

Write the findings list before fixing anything, then fix by cause, not one screen at a time. Most breaks will come from a few shared causes:
- tokens a theme doesn't set;
- R's or V's new tokens (status marks, stop hues, the quiet mark) that the themes never got;
- see-through surfaces used where a solid one is needed;
- hard-coded colours.

## 2. Fix
- **Fix in the theme files first** (`web/src/theme/themes/*.css`, `tokens.css`). Each theme must set every token the app reads, or get a sensible fallback from `tokens.css`. Add a test that lists the tokens the app reads and fails if any theme leaves one unset without a fallback.
- **Glass and Light glass:**
  - Overlays must be readable: menus, tooltips, sheets, dialogs, toasts and the command search. Use a solid enough surface, or a blur with a tint dense enough that body text over the busiest part of the aurora still passes 4.5:1. Measure it against the aurora behind it, not against the token.
  - Frosted panes keep their look, but text on them must pass.
- **Graphs, the merge map, the floor and the step dots** read colours from tokens and must pass 3:1 against their own background in every theme.
- **Status is never shown by colour alone.** A theme only changes looks.
- **Keep the scope tight.** Don't redesign: make each theme carry the app as R designed it.

## 3. Leave a check behind
- `themeSweep.mjs` stays in `web/e2e/`, with a header saying how to run it. It covers all themes, both widths and both Play modes, and ends with "Every theme passes" or a list.
- Extend `web/e2e/contrast.mjs` to take `THEMES=all`.
- Fix the 390 px gap in `web/e2e/noJump.mjs`: it times out on Telemetry waiting for the menu item "Unfold". Give it a phone path, then run it at 390 as well.

## Owns
- `web/src/theme/` (all of it);
- `web/e2e/`;
- any CSS file in `web/src`, for fixes that can't be done with tokens;
- the TSX of a component only when a colour or an inline style is hard-coded there (replace it with a token);
- the tests for each.

Nothing else is running, so there are no clashes. Still, change only what a finding needs.

## Steps
1. Write the sweep, run it, and write the findings list, including the per-theme contact sheets "before". Commit.
2. Add the token coverage test and fill the missing tokens. Commit.
3. Glass and Light glass: overlays and text on panes. Commit.
4. The other themes, grouped by cause, one commit per cause.
5. Graphs, the map, the floor and other drawn pieces. Commit.
6. Re-run the sweep, contrast for all themes, and noJump at 390, 1280, 1512 and 1728 px. Make the "after" contact sheets. Commit.

## Acceptance
- The sweep reports "Every theme passes" for all 11 themes, at 1512 and 390 px, in Play full and off, with:
  - zero console errors;
  - no text under 4.5:1 (3:1 for large text and marks);
  - no unreadable overlay;
  - no invisible focus ring;
  - no horizontal scroll.
- The token coverage test passes.
- All tests are green, with no model calls.
- The before and after contact sheets for Glass and Light glass are in the hand-back.

## Rules that apply to every packet (read once, obey always)
- **Worktree and branch:** `git worktree add ../ground-control-X -b packet/X-every-theme main` from the main checkout. Work only there.
- **Port:** 4503 (screens 4504). **Never use 4477, 4479 or 4485.** Leave 4491 (Vignesh is looking at it) and the other ports alone.
- **Tests:** `npm test`, `cd web && npx vitest run` and `npx tsc --noEmit -p .`, green before each commit. **No model calls in tests.**
- **Never push, never open a PR, never merge.** Plain commit messages.
- **Never contact real people.** No real GitHub logins in tests or fixtures; use the fake gh.
- **Status is never shown by colour alone. Theme tokens only. Plain words in every string a person reads.** No product name: use `BRAND`/`PRODUCT`.
- **The design philosophy applies:** `docs/design/design-philosophy.md`.
- **Hand-back format:** packet id, branch, last SHA, what was done per step, test output tail, anything not done and why, "Needs from others".
