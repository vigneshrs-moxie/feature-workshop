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

## 6. Visibility into every stage, without Fable writing it

The user wants full visibility, in the UI, into what is going on at each stage. Fable should not be the one writing it; a cheap Haiku or Sonnet "dispatch" agent should write status somewhere the UI reads.

**Recommendation: three layers, cheapest first. The narrator runs in the dashboard, not inside the Foreman.** A narrator dispatched by the Foreman would cost Foreman turns every time.
1. **Free, live activity from the logs (no model):** current stage, which worker, each tool call in plain words ("editing labels.ts", "running npm run check"), files touched, checks pass/fail, timers, and a "quiet for 6 min" warning. It comes from the SDK stream and the session logs the dashboard already reads.
2. **Haiku narrator (cheap):** runs as its own small query outside the Foreman. It is triggered when a worker finishes, a check ends, or every couple of minutes while a job is active.
   - **What it reads:** a capped excerpt (about 4k tokens: recent tool calls plus the worker's last text).
   - **What it writes:** 1–2 plain lines ("Builder finished step S3; 2 tests failing in labels.test.ts, fixing now") and a rough progress estimate, to `<job>/activity.jsonl`. The UI shows these.
   - **Cost:** about $0.0005 per update, or about $0.05 for 100 updates per job; Sonnet would be about 20× that if the wording needs to be better.
   - **Limits:** it reads and never decides.
3. **Worker handoff cards (structured):** each worker ends with done / remaining / commands and exit codes / issues, written by the worker itself. The Foreman and the UI read these cards, not the logs.

## 7. Same Foreman or a fresh one: decided per send, with the numbers shown

Measured: Foreman conversations grow to 166k–266k tokens per job. Re-reading them while cached is cheap (18M cached tokens cost $4.51 over 3 jobs). The expensive moment is the first message after an idle gap of more than an hour: the whole conversation is written to cache again, which cost about $3 per event on Fable.

| ~200k Foreman conversation | Opus | Fable |
|---|---|---|
| Each reply while cached (idle under 1 h) | ≈ $0.04 | ≈ $0.05 |
| First reply after more than 1 h idle (re-cache) | ≈ $1.60 | ≈ $4.00 |
| Fresh Foreman from the job record and last handoff (~40k) | ≈ $0.32 | ≈ $0.80 |

**Recommended default rule (the dashboard picks; you can override):**
- **Continue the same Foreman** while its cache is warm (last reply under ~55 min ago) and its conversation is under ~150k tokens. A mid-stage back-and-forth stays cheap and keeps every nuance.
- **Start a fresh Foreman from the handoff** when any of these holds:
  - The cache is cold and the conversation is over ~60k tokens. Above that, re-caching costs more than starting fresh.
  - The conversation is over ~150k tokens. Every reply then gets slower and pricier, and quality drifts.
  - The previous stage has just been approved (a natural handoff point, especially for L2/L3).
  - A usage-limit reset has just happened (the cache is certainly cold).
- **How it shows at send time:** the cheaper choice is preselected, with its estimate visible, for example: "Continue (re-loads 210k ≈ $1.70 ≈ 4% of the 5-hour window) · Fresh from handoff (≈ $0.35)".
- **What makes fresh safe:** the job's decision log, approvals, options and the last handoff card, all on disk. Starting fresh loses chat nuance, not decisions.

## 8. A Stats tab for deep dives

A separate **Stats** tab, clear and easy to understand, with drill-down. Sources: session logs, the dashboard's audit log, rate-limit events, job records. All local.
- **Overview:**
  - Usage today, this week and this month: tokens, API-equivalent $, and share of the 5-hour and weekly windows.
  - When limits were hit, and what was running at the time.
- **By model:** Fable / Opus / Sonnet / Haiku share. Cache efficiency (hit ratio, re-cache events and their cost). Output vs input.
- **By job, by level (L0–L3), by stage, by agent type:** cost and time per stage, number of dispatches, fix and review rounds, average cost per level (to tune the levels).
- **Waiting:**
  - **On you:** time-to-approve, number of prompts, auto-allowed vs asked, and which commands ask most (to tune the rules).
  - **On agents:** quiet periods and stuck runs.
- **Top sinks:** the 10 most expensive sessions and why (long-lived context, re-cache after idle, big reviews), each with a suggested fix.
- **People (shared plan):** usage per teammate, if they choose to share. Data is local per machine, so the team view needs an opt-in export or a shared folder (open question).
- **Quality of life:** time ranges, comparisons with last week, CSV and Markdown export. Every chart has a one-line "what this tells you".

## 9. Open questions added

- **Narrator model:** Haiku by default, Sonnet if the wording isn't good enough.
- **How often it writes:** on events only, or also a timed tick while a job is active.
- **Team data:** how teammates' usage reaches the Stats tab (export or import, a shared folder, or each person sees only their own).
