# Handoff: Feature Workshop after the Light round (2026-10-21)

**Repo:** `~/Projects/feature-workshop`, main @ `2a8b12c`. The work is in the worktree `~/Projects/feature-workshop-phase1` on `redesign/orbit-ready`, six commits on top (`06d03c2` … see `git log 2a8b12c..`). Not pushed, not merged.
**Skill repo:** `~/Projects/claude-feature-workflow` @ `8592c03` (linked into `~/.claude`; not pushed). It also carries a restructure from another session (`4898eeb`: a generic `wireframe` skill with `feature-wireframe` as its job-mode wrapper); the Workshop's viewer contract survived it.
- Run: `npm run web:build`, then `npm start`, open http://127.0.0.1:4477/next/. The screens page is served from a second local origin on PORT+1 (4478); set `WIREFRAMES_PORT` if that port is taken (the dashboard says so and the Screens tab explains).
- Demo: `PORT=4480 TMPDIR=<scratch> WORKSHOP_STATE_DIR=<scratch>/state node dashboard/demo/run-demo.js`. Port 4479 is the user's own demo: never touch it.
- Tests: `npm test` (dashboard) and `npm run web:test`, plus `cd web && npx tsc --noEmit -p .`.

**Plan:** `docs/plans/light-2026-10-21.md` (the asks, the Kingdom wireframe takeaways, §1–§12). **Screenshots:** `docs/design/light-2026-10-21/` with a README (the walk-through: 48/48, no console errors).

## What changed

1. **Finish line** (Settings → Workflow): what counts as done, in one place: PR #1 open · PR #1 merged (default) · In staging · In main · When I mark it. Drives Play's quest, the Jobs groups, the Done notification, the trail's flag and the map. `dashboard/lib/finish.js`; every card carries `finish`. Past the line but not in main = the **Shipping** group. Staging/main after the line = quiet "Landed" notifications.
2. **Keys**: one registry (`web/src/app/keyRegistry.ts`) with scopes; `g h/t/d/s/x` navigation, `n` notes, `i` composer, `[ ]` preview tabs, gate `a e r o . v 1–3`, desk `j k o a d b`, map `j k Enter o / 1–4`, settings `j k /`; hints on buttons; the `?` sheet is generated; Settings → Keys turns them off (only Esc/Enter/arrows/⌘K/⌘Enter stay).
3. **Look**: text size S/M/L/XL (`--ui-scale`), Light and Light glass themes (11 total, contrast-checked), Follow the system pairing Default↔Light and Glass↔Light glass, a swatch grid; the classic page follows all of it.
4. **Settings**: a rail of seven sections with value lines, `#/settings/<section>`, search. The in-browser alerts moved into Notifications.
5. **Home**: rows grouped Needs you · Running · Idle · Shipping · Done, a five-stop ship track with the finish-line flag, one line of words, a next hint, the release-train line per repo, filter chips with counts, Show toggles. The old 7-column lane map is gone.
6. **Job view**: a still header; the gate card has one primary action, the chips under "Adjust the next step" (`.`), decisions made for you folded (`v`), and an "Approve is off" list. (The Play Off snapshot changed for this, deliberately.)
7. **Desk**: three columns (queue, item with the brief open, Decided today + the job's facts); **nudges** from the flow (merge PR #1, open PR #2, ask for a review, address changes, merge PR #2), with `a` yes / `d` not now / `o` open; after-line nudges under Shipping. The top bar keeps one count (Desk).
8. **Screens stage** (`wireframe`, after spec at L2 / after refine at L3; L0 and L1 skip it unless `wireframes: "always"`) and **Clarify** (`clarify`, before spec at L2/L3; up to five questions with a consequence line per option). Options `wireframes` and `clarify` (auto/always/off) with defaults in Settings → Workflow. The Screens tab in Preview frames `wireframes.html` from the second origin; Copy feedback lands in the composer draft; `#/job/<slug>/screens` is the full view; the wireframe gate card shows the screens as chips.

## Reviews

Three independent reviews ran (rounds 1–2, round 3, the fixes). Everything found was fixed, including one blocker: the wireframe page first ran in the dashboard's own origin, where an AI-written page could have read the write token; it now runs on its own origin with `frame-ancestors` limited to the dashboard and origin-checked messages.

## Not done / to decide

- The standalone wireframes of the plan's step 0 were skipped (you asked for a straight build); the screenshots stand in.
- Reviewer names aren't in the flow's PR data, so hints say "Waiting for a review on PR #2 · 3 d", not "Raj's".
- Merge `redesign/orbit-ready` into `main`, push the skill repo, run `install.sh`, and the shakedown Orbit job: all still wait for your word.
