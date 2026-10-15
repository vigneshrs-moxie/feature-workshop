# Workflow changes · DRAFT, NOT APPROVED (2026-10-15)

Answers from the 2026-10-15 question rounds on borrowing ideas from [Superpowers](https://github.com/obra/superpowers) (brief: `docs/research/superpowers-2026-10-15.md`). **On hold:** the user wants to review these against real use cases before calling it the team's workflow. The redesign goes first. Its UI shows these pieces only when a job's files contain them, so nothing depends on this draft.

Changes land in the public workflow repo `vigneshrs-moxie/claude-feature-workflow`, never only in one person's `~/.claude`.

## Who it's for

- Up to 3 teammates for the next 6 months, 5–10 at most. All comfortable with Claude Code.
- They use both the dashboard and the terminal, so every rule must read well in plain terminal output.
- Everyone shares one Claude Max plan, so usage is a shared budget.

## Tests

- Orbit has Vitest with 204 test files, mostly server logic (`src/lib/calls`, `task-distribution`, `actions`, `queries`, `budget`). Screens have almost none. There is a separate database test setup (`npm run test:db`).
- **Test-first:** required at L2–L3. If it isn't workable for a step, the builder **stops and asks**.
- **UI:** test only UI with logic in it, for example "button hidden for non-admins". Layout and copy are checked by eye.
- **Scope:** the job's own acceptance criteria, plus pin tests for code nearby. Don't overdo it or spread into other features.
  - Nearby means the functions the diff changes **and their direct callers**.
  - **Pin tests** record how the code behaves today, before changing it. They are required at L2–L3.
  - The plan **names every pin test**. You approve or cut them with the plan, and none are added later.
  - If a pin test shows today's behaviour looks wrong, the brief **asks you**. It is never fixed silently.
- **Untested areas:** setting up tests for a whole area is ideal but not possible yet, because flows and screens aren't specified. Coverage grows job by job.
- **DB tests** run only when the job touches queries or migrations.

## Bugs

- **L2–L3 bugs:** reproduce with a failing test before fixing.
- **L0–L1 bugs:** the brief states the root cause in one line before the fix. No guessed fixes.
- **Three failed fix attempts** stop the job and ask you.

## Proving "done"

- A worker shows the command it just ran and its pass/fail result. "Should work" is never enough.
- **L0:** typecheck plus the tests in the touched folders.
- **L1–L3:** the related tests after each step, the full `npm run check` at the end before you test.

## Rulings

- A ruling is **any choice the plan didn't specify**: a name, a default, a library, an edge case. Every worker lists them.
- These **stop the job and ask** instead of being listed:
  - Permissions or office/entity scope.
  - A new dependency.
- **Undo** marks collect and are fixed together at the next gate.
- Rulings stay per person and are not copied into PRs.

## Briefs

- Normal brief **≤120 words**. Plan-approval brief **≤300 words**.
- **Decisions:** one line each (`D1 question → rec: answer (tradeoff)`). They get more context when the decision is **risky, hard to undo, or new to you**.
- **Detail fold:** up to **400 words**, written to a file in the job folder.
  - Terminal: the brief ends with the file's path.
  - Dashboard: shown under a folded section, read straight from that file.
- **Usage:** warn before build, test or review once the shared 5-hour window passes **80%**.

## Setup for teammates (some already done)

- **Done 2026-10-15:**
  - `install.sh` links the skills and agents, keeps backups outside the skills folder, and clones or updates the git workflow docs at `~/Projects/moxie-portal-git-workflow`.
  - The git summary reads each person's fork from `git remote -v`.
  - MIT license and a Superpowers credit line.
- **Still to do:**
  - `install.sh` offers your permission rules and asks before merging them into a teammate's `settings.json`.
  - **First-run questions:** before first use, each teammate is asked whether to adopt four working rules:
    - approve every plan
    - fork-only pushes
    - ask before running tests
    - branch from org main
  - Their answers go to a small personal file in their `~/.claude`, never in a repo.
  - After an update, the Foreman says **what's new in two lines** on the next `/feature`. This needs a changelog the Foreman can read.
  - Changes come in as PRs to the workflow repo, and you approve them.
- Orbit's checklist sections stay in the public repo as they are.

## Open before approval

- Check every rule above against real jobs.
- Whether the four working rules should be on or off by default in the first-run questions.
- How "what's new" decides what a person has already seen. One option is a last-seen version kept in their personal file.
