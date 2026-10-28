# Packet L · Playwright evidence

**Goal.** At the test stage, each acceptance criterion of an L2 or L3 job gets proof a person can look at: screenshots and a short video of the Try it server doing what the criterion says, signed in as the existing dev bypass user, against the local database copy (plan G17, §11 L). The evidence lives in the job folder and shows on the gate card; a person pastes the link on the ticket. L1 runs it only when the job's options ask for it; L0 never does.

**Port 4485 · worktree `../ground-control-L` · branch `packet/L-evidence`. Skill repo: worktree `../claude-feature-workflow-L` of `~/Projects/claude-feature-workflow`, branch `packet/L-evidence`. Depends on J; start after J is merged, and after N is merged too, since N uses port 4485 until then. Runs beside I and K.**

## What exists
- The tester: `agents/feature-tester.md` in the skill repo runs the approved test-plan checks and writes `test-report.md` against the acceptance criteria. The test plan rules are in `skills/feature/SKILL.md` (stage notes: Test; checks that start servers need a yes each time) and `skills/feature/checklists/` (`ui.md`, `api.md` and others). Job options (`skills/feature/job-options.md`, `dashboard/lib/options.js`, schema 2) carry `level` 0 to 3 and `manual_test`, and nothing about evidence.
- Try it (`dashboard/lib/local.js` `LocalRunner`): after J, the app folder, command, port range, env file rewrite and `DEV_BYPASS_AUTH` come from the repo's profile (`dashboard/lib/profile.js`, `dashboard/profiles/orbit.md`, `tryIt`, `filesToCopy`, `database`). `startServer()` and `stopServer()` run the dev server on the job's port; `database()` reports the local copy.
- The job's documents: `dashboard/lib/features.js` (about line 295) and `dashboard/lib/docs.js` (about line 68) name every `review/*.md` file "Review: <name>", so `review/facts.md` (the facts block the lenses are given, from v1 packet F) shows as "Review: facts" as if it were a lens's review (left open from v1).
- The gate card (`web/src/panes/Foreman/GateCard.tsx`) shows the brief and the actions; it has no evidence. No Playwright in `package.json`; the only browser use today is the wireframe skill's screenshots.
- From G, events go through `makeEvent` in `dashboard/lib/protocol.js`, and `evidence` is already one of `EVENT_TYPES`.

## Owns
`dashboard/lib/evidence.js` (new), `dashboard/runner/evidence.js` (new, starts a recording after the tester finishes) and its one line in `dashboard/runner/index.js`, `dashboard/site/routes-evidence.js` (new) and its line in `dashboard/site/index.js`, the `evidence` option in `dashboard/lib/options.js`, the evidence file and the review-file names in `dashboard/lib/features.js` and `dashboard/lib/docs.js`, one pinned Playwright test-runner line (@playwright/test) in `package.json`, `web/src/panes/Foreman/EvidenceStrip.tsx` and its test (new), the evidence slot in `web/src/panes/Foreman/GateCard.tsx`, the evidence types in `web/src/api/types.ts`, `dashboard/test/evidence.test.js` and `dashboard/test/evidence-server.test.js` (new), `dashboard/test/fixtures/evidence/` (new). In the skill repo: `skills/feature/evidence.md` (new), `agents/feature-tester.md`, the Test notes in `skills/feature/SKILL.md`, `skills/feature/checklists/ui.md`, and the `evidence` option in `skills/feature/job-options.md`.

## Steps
1. **When it runs** (`options.js`, `job-options.md`). A new option `evidence`: `"auto"` (default: on at L2 and L3, off at L1), `"always"` (on at L1 too) or `"off"`. Never at L0, whatever the option says. It shows on the New job form's existing options list, in the same words.
2. **The tester writes one spec per criterion** (skill: `skills/feature/evidence.md`, `feature-tester.md`, the Test notes, `checklists/ui.md`).
   - For each acceptance line that a person could see in the app, the tester writes `<job folder>/evidence/specs/AC-<n>.spec.mjs`: plain Playwright steps from the app's home address to the thing the criterion names, ending in one `expect` and a `page.screenshot` at each step a person would want to see.
   - A criterion with nothing to see (an API-only rule, a background job) gets no spec, and the test report says why in one line.
   - Specs never sign in with a password, never read `.env` files, never change data outside the local copy, and never visit anything but `127.0.0.1`.
   - The tester doesn't run them: the runner does (step 3), so the dev server needs no extra yes.
   - The skill says how to name a criterion (`AC-1` follows the spec's acceptance list order) and that the specs ride nowhere: they stay in the job folder.
3. **The runner records** (`lib/evidence.js`, `runner/evidence.js`). When the tester has written `test-report.md` and the specs for the current commit, and the job's level and option say yes, the runner:
   - starts Try it for the job (profile port, the bypass setting from `filesToCopy`);
   - checks the local database copy is up (the profile's `database` check); if it isn't, it stops with "The local database copy isn't running. Start it from Try it, then press Record again.";
   - writes its own Playwright config into `evidence/` (video on, screenshots on, one worker, the base address, a 60-second limit per spec, Chromium only);
   - runs `npx playwright test --config <that file>` from the worktree;
   - collects the screenshots and the video per spec into `evidence/<commit>/AC-<n>/`;
   - writes `evidence/evidence.json`: `{ version: 1, commit, at, level, criteria: [{ id, title, status: 'passed' | 'failed' | 'skipped', reason, screenshots: [...], video }] }`;
   - stops the dev server if it started it.

   It records once per commit (a second ask for the same commit says "Already recorded for abc1234"). It sends one `evidence` event and writes one audit line. Missing browsers give the fix line from `doctor` ("Run npx playwright install chromium") instead of an error.
4. **Serve the files** (`site/routes-evidence.js`): `GET /api/job/:slug/evidence` returns `evidence.json`, and `GET /api/job/:slug/evidence/file?path=...` serves an image or video only if the path resolves inside that job's `evidence/` folder (anything else is a 404). `POST /api/job/:slug/evidence/record` (token-checked like every write) records again for the current commit.
5. **On the gate card** (`EvidenceStrip.tsx`, `GateCard.tsx`). At the test gate, and on every later gate of the same commit, the card shows one row per criterion: its id and title, the result in words with an icon ("Passed", "Failed", "Not recorded: nothing to see"), the first screenshot as a small picture that opens the rest, and "Play video". "Copy link" copies the evidence folder's address so a person can paste it on the ticket. Evidence for an older commit says "From an earlier commit (abc1234)". The strip is keyboard reachable and every picture has a text description from the spec's step.
6. **Review file names (left open from v1).** In `features.js` and `docs.js`, `review/facts.md` and `review/facts-r<n>.md` are named "Review facts (round <n>)" and listed apart from the lens reviews; `evidence.json` and `evidence/` are listed as "Evidence".
7. **Tests**, with no browser and no network:
   - `evidence.test.js`: the level and option rules (L0 never, L1 only with `"always"`, L2 and L3 by default), the config written, `evidence.json` built from a fixture of Playwright's JSON report and output folder, once per commit, a database that's down, a path outside `evidence/` refused.
   - `evidence-server.test.js`, a demo dashboard where the Playwright spawn is replaced by a fake that copies `dashboard/test/fixtures/evidence/`: an L2 job gets `evidence.json` with screenshots and a video per criterion; an L0 job gets none; the file route serves inside and refuses outside.
   - Web tests for the strip.
   - Then once by hand on Orbit with a small L2 job of Vignesh's choosing, on the profile's port range, never 4477 or 4479.

## Acceptance
An L2 job produces screenshots and a video per acceptance criterion, against the bypass user and the local database copy; an L0 job produces none (plan §11 L). L1 records only when its options say `"always"`. The evidence shows on the gate card with its result in words, and "Copy link" gives a link to paste on the ticket. Nothing is served from outside the job's `evidence/` folder. `review/facts.md` no longer looks like a lens's review. All tests green, with no browser in the test run.

## Verify
```
PORT=4485 npm start   # an L2 demo job at its test gate shows the evidence strip
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
