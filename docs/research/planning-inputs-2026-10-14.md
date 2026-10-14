# Redesign planning inputs (2026-10-14)

Read with `orchestrators-2026-10-14.md`. These are the user's requirements and the draft answers to discuss in planning (on Fable 5.1). Every plan needs the user's approval before building.

## 1. Configurable, but simple

- The organization has few conventions yet, so process must stay low by default and be added only where it helps.
- The user chooses how each step goes, with intuitive adjustments at every step, in a simple and clean UI. The 20+ toggles of the current options dialog must not come back.
- **Draft approach:**
  - Every gate card carries small inline adjustments for the next step: *skip it*, *lighter* / *heavier* (fewer or more reviewers or checks), *ask Fable*, *I'll do this part*.
  - Per-job settings live in one "How this job runs" drawer.
  - A repo-level defaults file holds the team's emerging conventions (below).

## 2. Clearly defined workflows by size (level)

The user wants clearly defined workflows for different levels of bugs and features, followed consistently: extensive review for big work, quick for small. The Foreman suggests a level from the description and the code it touches, and the user confirms or changes it. You can move up or down a level at any gate.

| Level | For | Steps | Review | Models |
|---|---|---|---|---|
| **L0 Tweak** | copy change, one-liner, obvious bug | you describe → Foreman builds → checks → you look | none (diff shown) | Opus, or Sonnet for the build |
| **L1 Small** | contained fix or small feature | quick plan (approve) → build → checks → you test → 1 reviewer | 1 lens | Opus |
| **L2 Standard** | normal feature or multi-file bug | short spec + plan (approve) → build in steps → tests → you test → 3–4 lenses | spec, permissions, tests, +db/ui if touched | Opus; Fable check on the plan if you want |
| **L3 Large / risky** | new workflows, migrations, auth/roles/office scope, email | spec + refine + investigate + plan (approve) → build in steps → tests → you test → full panel + Fable review | all relevant lenses + Fable | Opus Foreman; Fable checks at plan and review |

Risk triggers raise the level automatically, and you can override them: migrations, auth/roles/office/entity scope, people/profile queries, email, shared config.

## 3. Git and review on the fly (nothing fixed yet)

- There's no fixed "review here, PR there, merge then" plan. The tool must work despite that.
- **Draft approach:**
  - **Git actions are tools, not stages.** Commit, push to fork, open PR (choose base: org branch / staging / main), request review, sync with org main, merge: available any time from the job's Git panel and from ⌘K. Each one asks for a yes. Pushing to the org repo is never done unless the user asks.
  - **Suggestions:** after a step, the Foreman suggests a likely next git action (for example "open a PR to the org branch?") and never requires one.
  - **Learned conventions:** when the user does the same thing twice (for example always PR fork → org branch first), the tool offers to save it as a repo default. Conventions grow from use instead of being designed up front.
  - **Ready to merge:** a "Ready to merge" view shows status, PRs, CI, review threads and open questions, whatever path was taken.

## 4. Saving usage on the shared Claude Max (20x) plan

The 5-hour limit running out is the biggest pain. Measured on 3 jobs (2026-10-13, $87 API-equivalent):
- Fable Foreman: 39% of cost, about half of it spent writing briefs and status files and re-caching after idle gaps.
- One long-lived builder session: $23 (context grew to 483k).
- Reviews: cheap because they were cut.

Draft plan, biggest wins first:
1. **Process by level** (above): most work is L0/L1, which has a fraction of the dispatches.
2. **Opus Foreman, Fable only for short checks** (done in the workflow; keep it).
3. **Fresh workers per step, small handoffs** (done). Enforce handoff cards, so the Foreman reads cards, not logs.
4. **No expensive idle resumes:** a Foreman idle for more than about an hour re-reads its whole conversation on the next message. Start a fresh Foreman per stage from the job's record and handoff (short context) instead of resuming a giant session; or compact before pausing.
5. **Cheaper models for mechanical work:** Sonnet for tests, investigation questions and L0 builds; Haiku for conventions and formatting checks.
6. **A team-wide budget view:**
   - A live meter for the 5-hour and weekly windows, and per-person and per-job usage.
   - A cap on concurrent agent runs across the team, with a queue.
   - Heavy stages (build, test, review) can be scheduled to start right after a reset.
   - A warning before starting something big when the window is nearly used.
7. **Keep reading small:** diffs by `--stat` first, check output to files (tail only), short briefs.
8. **Measure:** cost per stage and per level in the dashboard, so defaults are tuned from real data.
9. **Plan terms:** check that several people sharing one Max seat fits Anthropic's terms for that plan. Team/Enterprise plans have pooled seats and admin usage controls, which may suit a team better.

## 5. Already decided (see the brief)

- **Stack:** React + TypeScript + Vite.
- **Layout:** three panes (Jobs | Foreman conversation | Preview with App / Diff / Tests / Terminal), plus ⌘K.
- **App preview:** embedded browser or Chrome. Ask once which should be the default and remember it.
- **Terminal:** embedded terminal plus "open in iTerm / Terminal / VS Code".
- **Look:** futuristic, clean, professional, a few fun touches, impressive to the team.
