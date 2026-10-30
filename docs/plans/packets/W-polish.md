# Packet W · Polish after R, S, U and V

**Goal.** Close the small gaps the R, S, U and V hand-backs left. Each is small, and together they make the merged app feel finished. None of them adds a feature.

**Port 4501 (screens 4502) · worktree `../ground-control-W` · branch `packet/W-polish`.** Base: `main` after V is merged (commit `88e312c` or later).

## The fixes
1. **The demo's limit pause stays out of the regular demo.**
   - Today `dashboard/demo/run-demo.js` (around line 413) pauses one job for the 5-hour usage limit, resetting 20 minutes after the demo starts.
   - That shows a "5-hour limit is reached" banner across the whole app and blocks sends in every copy of the demo, including Vignesh's own on restart.
   - Keep the paused pose and label visible only where they belong: in the `#/floor-lab` fixtures (S) and in unit tests. The regular demo must show no global limit banner and must not block sends.
   - If a demo job should still look paused, it must be a per-job state that does not trip the account-wide limit.
2. **A job card's light that is off fails contrast in Play full.**
   - In `web/src/app/pages.css`, `.job-light` measures 1.6:1 in Light and 2.3:1 in Default.
   - Use R's quiet-mark colour, the same one V used for a stack card's light and the empty checkbox edge. It needs 3:1 or more as a non-text mark.
   - `web/e2e/contrast.mjs` must pass in Play full too.
3. **The Jobs next-step bar at 390 px.** In Play full, the Open button runs out of its bar on a phone. Wrap it or stack it so nothing spills, keeping the bar's height steady (no jump).
4. **Glass theme and the 3D floor.** The Glass theme's backgrounds are see-through tokens, and the floor reads them as colours. Have `play/floor3d`'s token read fall back to the nearest solid surface colour when a token has alpha below 1, with a test.
5. **The part page's level card.**
   - `panes/Foreman/ForemanPane.tsx`: give `ThreadList` an option to leave out the level card (for example `level={false}`).
   - Use it in `views/Stack/PartPage.tsx` and drop the CSS that hides the card in `part-page.css`, so the page has no duplicate heading id.
6. **The flaky `ThreadCrew.test.tsx` snapshot.**
   - "renders exactly what phase 2 rendered" fails under full parallel load: it catches "Loading the conversation…" because R's loading line now stays up at least 400 ms.
   - Make the test wait for the loaded state (or use fake timers) so it passes every time. Don't weaken what it checks.
   - Run the full web suite five times in a row; it must be green each time.
7. **The console error on every page.**
   - Every page logs "Applying inline style violates … style-src 'self'", including Jobs, the Desk and Telemetry.
   - Find what sets inline styles that the CSP refuses: a library injecting a `<style>` tag, or `element.setAttribute('style', …)`. Note that React `style={}` props set CSSOM properties and are allowed.
   - Fix it at the source. Don't loosen the CSP with `'unsafe-inline'`. If the only fix is a CSP change, use a hash or nonce, and say so in the hand-back.
   - Afterwards, no page in the demo logs a console error.

## Owns
Exactly the files the fixes above need:
- `dashboard/demo/run-demo.js` (the limit pause only);
- `web/src/app/pages.css` (the `.job-light` rules);
- the Jobs next-step bar's component and CSS;
- `web/src/play/floor3d/` (the token read);
- `panes/Foreman/ForemanPane.tsx`, `views/Stack/PartPage.tsx` and `part-page.css`;
- `panes/Foreman/ThreadCrew.test.tsx`;
- whatever file causes the inline-style error, plus the CSP header if a hash is the fix;
- the tests for each.

## Steps
One commit per fix, in the order above, with tests. Then:
- run R's checks: `web/e2e/noJump.mjs`, and `web/e2e/contrast.mjs` in Play full and subtle;
- check the console on every screen of the demo;
- take shots at 390 and 1512 px of each fix, before and after, into the scratchpad.

## Rules that apply to every packet (read once, obey always)
- **Worktree and branch:** `git worktree add ../ground-control-W -b packet/W-polish main` from the main checkout. Work only there.
- **Port:** 4501 (screens 4502). **Never use 4477, 4479 or 4485.** Leave the other ports alone.
- **Owned files only.** Anything else goes under "Needs from others".
- **Tests:** `npm test`, `cd web && npx vitest run` and `npx tsc --noEmit -p .`, green before each commit. **No model calls in tests.**
- **Never push, never open a PR, never merge.** Commit locally with plain messages.
- **Never contact real people.** No real GitHub logins in tests or fixtures; use the fake gh.
- **Status is never shown by colour alone; themes change looks only; theme tokens only. Plain words in every string a person reads.** No product name: use `BRAND`/`PRODUCT`.
- **The design philosophy applies:** `docs/design/design-philosophy.md`.
- **Hand-back format:** packet id, branch, last SHA, what was done per fix, test output tail, anything not done and why, "Needs from others".
