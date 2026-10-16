# Redesign phase 2 · Gate review (2026-10-16)

**In one line:** jobs now have a level (L0–L3), the Foreman's decisions come as a gate card you answer in one reply, and each job has a drawer for its notes and options. Built on `redesign/phase-2`; not pushed or merged.

## What's built

- **Levels.** Every job is L0 Tweak, L1 Small, L2 Standard or L3 Large. Old option files still load.
- **Level suggestions.** The rules suggest one from the description (no AI); the New job sheet pre-selects it. The Foreman suggests one in its first brief; when it differs from yours, the LevelCard shows both with Use and Keep.
- **Level chip** in the job header: what moving up or down adds or drops.
- **Gate card.** Answer the questions, override "Also decided" items, then Approve, Edit, then approve, Revise with feedback, Other guidance, or Approve, start after reset. Stop job is under ⋯.
- **Chips on the gate card.** Each adds one line to your reply. Skip next, Ask Fable and L↑/L↓ also save to the job's options; Lighter, Heavier and I'll do this part only add their line.
- **Safeguards.** A card greys out if the plan changes after it appears. A decision left 4 hours shows "parked 4h" and alerts once. Nothing is approved for you.
- **Job drawer** (job menu → Notes and options, or ⌘K): notes and every option. Provided documents are still edited in the classic view.
- **Settings warning** when your installed /feature skill doesn't know levels yet. The skill update itself is committed locally, not installed (see below).

## How to try it

```sh
npm run web:build && PORT=4479 npm run demo
```

Open **http://127.0.0.1:4479/next/**. A pretend Foreman answers, the jobs are invented, and it costs no Claude usage. Screenshots: `docs/design/phase-2-2026-10-16/`.

## The levels

| Level | What runs | Reviewers | You test | Fable | Foreman / build / checks |
|---|---|---|---|---|---|
| L0 Tweak | One build, the checks, you look at the diff. No plan to approve. | none | no | none | Opus / Sonnet / Sonnet |
| L1 Small | Quick plan (you approve), build, checks, you test, review | Head inspector | yes | none | Opus / Opus / Opus |
| L2 Standard | Spec, investigate, plan (you approve), build in steps, tester, you test, review | 3–4 usual ones | yes | if you ask | Opus / Opus / Sonnet |
| L3 Large | All of L2 plus the product interview | all eight | yes | plan and review | Opus / Opus / Sonnet |

The Foreman is Opus at every level. Risky areas (sign-in, roles, data scoping, migrations) make the rules suggest at least L3.

## The chip lines

```
Option change for the next step: skip <stage>
Option change for the next step: lighter <stage>
Option change for the next step: heavier <stage>
Option change for the next step: ask Fable at <spec|plan|review|pr>
Option change for the next step: I'll do <stage> myself
Option change for the next step: level L<n> (was L<m>)
```

## The L0 paragraph (exact, from the skill)

> **L0: the request is the go-ahead.** The one exception to "Never skippable" (below). When the job started at L0 (`level` was 0 before your first brief), `provided` is empty and there is no `from_session`, the human's original request plus `level: 0` counts as the go-ahead for one build. Log it like any go-ahead: the request verbatim, "level 0 in options.json at <updated_at>", scope one build. Create the branch and worktree as usual, dispatch one `feature-implementer` whose prompt quotes the request as its authorization and names `cd app && npm run check` and `cd app && npm run build` as its approved checks, then brief the diff: what changed, the check results, and next (the manual test if asked, then the PR stages). No plan card, no tester, no lenses; the pre-PR diff check still runs. Anything after that one build needs the human's yes. Everything on the "still asked separately" list stays asked. Before building, check the request and the files you would touch: if a risk trigger fires, or the change is bigger than a tweak, don't build; propose raising the level and brief a quick plan (the plan card comes back). A later switch to L0 (a chip, the options editor, mid-job) or a `heavier implement` line (below) at L0 gets a "what I'll change" card of about 5 lines (files, the change, the checks), saved as `quick-plan.md`; wait for the human's yes.

## The skill change

Two local commits in `~/Projects/claude-feature-workflow` (`19f2ac7`, `7a23357`), 8 files, +91 −44. To read it:

```sh
git -C ~/Projects/claude-feature-workflow diff 9ceba3c..main
```

**Waiting for your yes: `install.sh`.** Not run yet. Once you approve the diff, the orchestrator runs it (it backs up your current skills first). Until then real jobs use the old skill: L0 runs like L1 and new chip lines are ignored.

## Tests (real run, 2026-10-16)

`npm test` 213 / 213 · `npm run web:test` 312 / 312 · `npx tsc --noEmit -p web` clean · `npm run web:build` builds. No test calls Claude.

**Demo walk:** headless Chrome clicked through 18 flows; every flow below passed, with no console errors: the New job sheet at each of the four levels; L0 end to end; L1 approve; L2 approve with an override, Ask Fable and L↑; Skip next at the build gate; Edit, then approve; Revise with feedback; Other guidance; Stop job; stale card; parked card and row; parked alert remembered; drawer notes save; drawer options save; LevelCard Use; Settings warning.

## Known gaps

- `install.sh` not run, and no real job has run at any level yet (each needs your yes).
- Provided documents are still edited in the classic view.
- A stale card shows as fresh again after a dashboard restart, until the plan moves again.
- "parked 4h" is fixed text, even if the parking time is set shorter.
- The LevelCard can come back after you change the level yourself; Keep hides it.
- The L0 diff shows without red and green colours.
- From phase 1: the usage-limit pause isn't in the demo, and Try it locally, Costs and History search still open the classic view.

## Wording for you to decide

In the New job sheet, the Fable choice for the Foreman model says: "Best judgment, highest cost and quickest to use up your limits. For large or risky jobs." That last sentence suggests picking Fable for L3. **Proposed** (not applied): replace it with "Only if you want it: the Foreman is Opus at every level, and Fable already takes second looks at L3."

## Appendix: choices made while building

- The Foreman never starts on Fable because a job is large; Fable only takes second looks.
- The Foreman's model shows in the drawer but is changed with the Foreman model menu under the message box; the drawer's choice was only used when a job starts.
- Changing the level (drawer, header chip or gate chip) keeps your own testing choice and models; ones you never changed follow the new level.
- What a level change adds or drops leaves out stages the job has already finished.
- The drawer won't overwrite options changed elsewhere since you opened it; it offers Reload.
- At L1 the Foreman runs the checks itself; the tester joins only if the plan asks or you press Heavier.
- Other guidance keeps the card open; only Approve, Revise and Stop decide a brief.
- Replies to an old brief, or approvals of a plan that changed, are refused with a plain message. An approval held for the usage-limit reset is never sent after a later message of yours.
- The demo uses its own copies of the skill and agent files, so it never reads your Claude folder.
