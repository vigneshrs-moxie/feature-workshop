# Redesign phase 2 · Gate review (2026-10-16)

Phase 2 is built on `redesign/phase-2`. It has not been pushed or merged. The plan is `phase-2-plan-2026-10-15.md` (v1, approved with D1–D5 as recommended). This page covers what was built, how to see it, and what to check before you say yes.

## What's built

- **Levels instead of flows.** Each job is L0 Tweak, L1 Small, L2 Standard or L3 Large, saved in `options.json` (schema 2). Old option files still load.
- **Level suggestions.** The rules suggest a level from the description, without any AI, and later also from the files the branch changes. The Foreman suggests one in its first brief.
- **New job sheet.** It lists the four levels, each with what runs, and pre-selects the rules' suggestion as you type.
- **LevelCard.** When the Foreman's level differs from yours, or no level is chosen yet, a card shows both suggestions side by side, with Use and Keep.
- **Level chip** in the job header. It shows what moving up or down adds or drops.
- **GateCard.** It sits above the message box when the Foreman waits for your decision. It has:
  - the brief's questions, with the recommended answers picked;
  - "Also decided" items, each with Override;
  - Approve, which names what it approves and what starts;
  - Edit, then approve; Revise with feedback; Other guidance; Approve after reset;
  - Stop under ⋯, where you type the job's name to confirm.
- **Next-step chips** on the gate card: Skip next, Lighter, Heavier, Ask Fable, I'll do this part, L↑ and L↓. Each one adds a line to your reply and saves the option.
- **Safeguards.** A card greys out if the plan changes after it appears ("stale"). A decision left 4 hours shows "parked 4h" and raises one alert. Nothing is ever approved for you.
- **Job drawer** ("Notes and options…" in the job menu, or ⌘K). It has a notes.md editor and the full options editor. The classic Options link is gone.
- **Settings warning** when your installed /feature skill doesn't know about levels yet.
- **Review fix rounds** can now be 1 to 3.
- **Skill update** in `claude-feature-workflow`. It is committed locally but not pushed or installed (see below).
- **Demo.** The pretend Foreman follows the job's level, reacts to the chips, and seeds one job for each case.

## Levels as built

These are the defaults in `dashboard/lib/options.js` (`LEVELS`). You can change any of them per job in the drawer.

| Level | What runs | Review lenses | You test it | Fable | Models (Foreman / build / checks) |
|---|---|---|---|---|---|
| **L0 Tweak** | One build, then `npm run check` and `npm run build`, then you look at the diff. There is no plan to approve. Then PRs. | none | off | none | Opus / Sonnet / Sonnet |
| **L1 Small** | Quick plan (you approve), build, then checks. The Foreman runs the checks itself; the tester runs only if the quick plan asks for more. Then you test, review and PRs. | Head inspector | on | none | Opus / Opus / Opus |
| **L2 Standard** | Spec, investigate, spec update, plan (you approve), build in steps, tester, you test, review, PRs. Refine is skipped. | "auto": head inspector, permissions, tests and conventions, plus db, ui and others when the change touches them | on | none (optional with Ask Fable) | Opus / Opus / Sonnet |
| **L3 Large** | Everything: spec, refine (product interview), investigate, spec update, plan (you approve), build in steps, tester, you test, review, PRs. | All eight lenses | on | plan and review | Opus / Opus / Sonnet |

**Model defaults.** The Foreman runs on Opus at every level. It is never started on Fable just because a job is large. Fable only takes short second looks at the points listed in `fable_checks`. The lens models come from each agent: the head inspector and Permissions run on Opus, Conventions on Haiku, and the rest on Sonnet. A schema 1 file still works: `quick` maps to L1, `small` to L2, `large` to L3, and `auto` means no level yet.

**Level floor.** Some risks set the lowest level the rules will suggest. The same rule is written in the skill.
- **L3:** migrations, sign-in, roles or permissions, and data scoping.
- **L2:** office visibility, people queries, email, and shared config.

## Chip lines

Each chip adds exactly one of these lines to your reply. The skill reads them, and the dashboard saves skip, Fable and level changes to `options.json`.

```
Option change for the next step: skip <stage>
Option change for the next step: lighter <stage>
Option change for the next step: heavier <stage>
Option change for the next step: ask Fable at <spec|plan|review|pr>
Option change for the next step: I'll do <stage> myself
Option change for the next step: level L<n> (was L<m>)
```

## The skill change (for your review)

There are two local commits in `~/Projects/claude-feature-workflow` (`19f2ac7`, `7a23357`). They change 8 files (+91 −44): `job-options.md`, `SKILL.md`, `status-json.md`, `brief.md`, `worker-rules.md`, `workflow-gates.md`, `feature-implementer.md` and `README.md`.

- `job-options.md` gains:
  - the Levels table and the level floor;
  - the L0 exception (below);
  - the chip lines;
  - review rounds 1–3 and models per job.
- `status-json.md` gains `suggested_level` and `level_reason`.
- `SKILL.md`: the Foreman proposes a level in its first brief and passes `model:` from the job's models.
- Gates, worker rules, the brief checklist and the implementer all point to the L0 exception, so nobody refuses L0's one build.

The exact L0 paragraph, from `skills/feature/job-options.md`:

> **L0: the request is the go-ahead.** The one exception to "Never skippable" (below). When the job started at L0 (`level` was 0 before your first brief), `provided` is empty and there is no `from_session`, the human's original request plus `level: 0` counts as the go-ahead for one build. Log it like any go-ahead: the request verbatim, "level 0 in options.json at <updated_at>", scope one build. Create the branch and worktree as usual, dispatch one `feature-implementer` whose prompt quotes the request as its authorization and names `cd app && npm run check` and `cd app && npm run build` as its approved checks, then brief the diff: what changed, the check results, and next (the manual test if asked, then the PR stages). No plan card, no tester, no lenses; the pre-PR diff check still runs. Anything after that one build needs the human's yes. Everything on the "still asked separately" list stays asked. Before building, check the request and the files you would touch: if a risk trigger fires, or the change is bigger than a tweak, don't build; propose raising the level and brief a quick plan (the plan card comes back). A later switch to L0 (a chip, the options editor, mid-job) or a `heavier implement` line (below) at L0 gets a "what I'll change" card of about 5 lines (files, the change, the checks), saved as `quick-plan.md`; wait for the human's yes.

To see the full diff:

```sh
git -C ~/Projects/claude-feature-workflow diff 9ceba3c..main
```

**Still pending: `install.sh` (D4).** It has not been run. Once you've read the skill diff and said yes, the orchestrator runs it. Your `~/.claude/skills` copies then become links to the public repo, and the script backs up the old ones first. Until then, your real jobs use the old skill: L0 runs like L1, and chip lines the old skill doesn't know are ignored. Settings shows a warning about this.

## How to run the demo

The demo uses a pretend Foreman and invented jobs, so it costs no Claude usage.

```sh
npm run web:build && PORT=4479 npm run demo
```

Open **http://127.0.0.1:4479/next/** and stop it with Ctrl+C. The seeded jobs are:

- **Invoice footer typo** (L0): built, with a brief that shows the diff and asks no questions.
- **Copy link button** (L1): a quick-plan card.
- **Ticket tag filter** (L2): a plan card with 2 questions and 1 decision made on your behalf.
- **Customer merge** (L3): a plan card with Fable's second look.
- **Next stops on the map** (L2): a card that goes stale a moment after start (plan v2 → v3).
- **Customer notes tab** (L2): left 5 hours, so it's parked. It is alerted within 30 seconds.
- **Visit reminder** (no level): a LevelCard where the rules say L2 and the Foreman says L3.

New jobs you start also follow their level. The pretend Foreman reacts to every chip, to "Please make changes" (the plan version goes up) and to Other guidance (the card stays open).

Screenshots are in `docs/design/phase-2-2026-10-16/` (see its README). There are 9 in the Default theme, plus the gate card in the other five themes.

## Demo walk (step 8)

The walk ran in headless Chrome against the demo on a spare port, clicking the real UI. 18 of 18 flows passed, with no console errors and no failed requests.

| Flow | Result |
|---|---|
| New job sheet at L0, L1, L2 and L3: the level is saved and the right first card appears | ok |
| L0 end to end: a gate-free build, a diff brief with no questions, approve → PR #1 | ok |
| L1 approve (quick plan) → build → "try it" | ok |
| L2 approve with an Override, Ask Fable and L↑ (the options are saved and the lines sent) | ok |
| Skip next (Test) at the build gate → review | ok (fixed: see below) |
| Edit, then approve: the edited text is sent as the approval | ok |
| Revise with feedback: a new brief at plan v4 and a fresh card | ok |
| Other guidance: the card stays open on the same brief | ok |
| Stop: disabled until the job's name is typed, then the job stops | ok |
| Stale card: greyed out, Approve off | ok |
| Parked gate: chip on the card and on the row, one alert, remembered in `gate-parking.json` | ok (fixed: see below) |
| Drawer: notes saved; options saved (Fable point, 3 fix rounds) | ok |
| LevelCard Use L3 | ok |
| Settings warns about the stale skill | ok |

Fixed during the walk (commit `156e78d`, with tests):

- **Approve named the wrong document.** At the build gate it said "Approve plan v1", because "Implementation plan" matched "implement". The test gate named the test plan and the review gate named the investigation's findings. Each gate now names only its own document, or none.
- **Parked rows.** A parked decision showed its chip only on the card. The job row (and the icon rail's name) now shows "parked 4h" too, and one alert fires when it parks while the page is open.
- **New job sheet explainer.** It still pointed at "Options" in the job menu; it now says "Notes and options…".

## Tests

- `npm test`: 212 / 212. That's 120 at the end of phase 1, plus 92 in phase 2, including 9 for the level-aware pretend Foreman.
- `npm run web:test`: 305 / 305 (218 at the end of phase 1).
- `npx tsc --noEmit -p web`: clean. `npm run web:build`: builds.
- No test calls the SDK.

## Decisions taken during the build

- **No Fable Foreman.** `FLOWS.large` now starts an Opus Foreman, with Fable doing second looks at plan and review. The Foreman model comes from what you pick, then the job's `models.foreman`, then Opus.
- **The New job sheet pre-selects the rules' level** as you type, until you pick one yourself. So "fix the typo…" starts at L0 unless you change it. If you pick below the rules' floor, the sheet notes it, and the Foreman asks before building.
- **Columns and tables.** "Add a column" or "a new table" on its own suggests at least L2. With a database word (db, migration, schema, SQL) it counts as a migration and suggests L3.
- **L1 runs the checks, not the tester.** The tester runs only when the quick plan lists more checks, or when you press Heavier.
- **Other guidance keeps the card open.** Only Approve, Revise and Stop decide a brief.
- **Classic approvals close new-UI cards.** A decision sent from the classic page after the brief answers it.
- **Parking memory.** Alerted gates are kept in `gate-parking.json` in the dashboard's state folder, so a restart doesn't alert them again. The timer reads only `status.json` and the brief files. The demo checks every 30 seconds; real use checks every 5 minutes.
- **Raised versions are kept in memory.** A dashboard restart takes the versions in `status.json` at that moment as the new baseline.
- **Changing the level keeps your own choices.** Manual test and models stay only where you set them yourself; otherwise they follow the new level.
- **Stale replies are refused.** A reply for an old brief, or an approval of a plan that changed, is refused with a clear message. Replies over 20,000 characters are refused too.
- **Held approvals.** An approval held for the usage-limit reset counts as answered. It is never sent after you send a message yourself.
- **notes.md.** It is capped at 20,000 characters, and a symlinked notes.md is not followed.
- **"How this works" boxes start folded.**
- **The job list never runs git.** On the job list, the rules read the description only. The job page adds the changed files, cached for up to a minute.
- **The demo reads its own pre-levels copy of `job-options.md`**, so the Settings warning shows and the demo never reads `~/.claude`.

## Known gaps and follow-ups

- **install.sh not run** (D4, waiting on your review of the skill diff). No real job has run at any level. Running one job per level needs your separate yes.
- **The LevelCard can come back after you change the level yourself.** For example, press L↑ on an L2 job the Foreman sized as L2, and the card says "The Foreman suggests L2". Keep hides it. A follow-up could hide the card once you have picked a level yourself.
- **A stale card isn't stale after a restart.** Raised versions are memory-only, so after a dashboard restart a card that was stale shows as fresh until the plan moves again.
- **"parked 4h" is fixed text,** even when `WORKSHOP_GATE_PARK_MS` sets a different time.
- **The parked alert wasn't seen as a real notification.** Headless Chrome can't show one. The unit tests cover the alert logic, and the walk checked the server side.
- **The pretend Foreman reads approval from words,** because it can't see the reply's kind. An edited approval with no "approve" or "go ahead" left in it would count as guidance. This is demo only.
- **The L0 brief's diff is a plain code block,** with no red and green colours.
- **Still open from phase 1:** the usage-limit and Paused group aren't in the demo, no fonts ship, and some actions still open the classic UI (Try it locally, Costs, History search).
- **Demo data:** Widget Export's message box offers Fable as its model, because its invented session log ran on Fable.
