# Auto queue: design

Status: written 2026-11-12; the owner answered Q15 to Q17 the same day (yes, yes, and (b) for Q17). Branch `feature/auto-queue` (from `main` 8c794b8).

## What it is for

The owner's words:

- Auto jobs run in their own queue beside the manual ones, with an Auto tab in Jobs and in the Inbox.
- "just let it rip and create pr #1, until then i want no questions asked."
- "is this feature too big to build? if it is then we can skip it since i feel like i wouldnt simply build a huge important feature on auto mode without my supervision."
- On the database: "we can always keep testing one by one and all the other steps can run in parallel like building etc."

## Decisions

Q1 to Q14 are the owner's answers of 2026-11-11; Q15 to Q17 are his answers of 2026-11-12.

| # | Decision | From |
|---|---|---|
| 1 | An Auto job is a job whose ticket carries the Auto tag from Settings. Tickets without the tag wait for his Start. | owner |
| 2 | Jobs has two tabs, `Yours` and `Auto`, each with a count. | owner |
| 3 | The Inbox has an `Auto` tab too. | owner |
| 4 | Up to 5 Auto jobs work at once, counted on their own. The number is a setting. | owner |
| 5 | A stopped Auto job frees its place. At most 10 unfinished Auto jobs. A stopped job shows under Needs you on the Desk, marked Auto. | owner |
| 6 | Finished means PR #1 is open. The job then sits in the Auto tab under `Ready for you to try` and takes no place. | owner |
| 7 | Built after the job page. | owner |
| 8 | Until PR #1 Auto never asks. Unsure or risky: Auto takes the safer option and writes it down. Outside changes, other pushes, merges: refused, and the Foreman finds another way. L3 runs to PR #1 and the finish notice says so. Only dead ends stop a job. | owner |
| 9 | The per-job Auto switch stays. A job with it on shows under `Auto`. | owner |
| 10 | A started job stays an Auto job if the tag is removed. Removing the tag only holds back a ticket that has not started. | owner |
| 11 | Inbox `Auto`: `Next up`, `Auto is working on these`. Jobs `Auto`: `Working`, `Needs you`, `Ready for you to try`. A job leaves the tab when he acts on it after PR #1. | owner |
| 12, 15 | Spec, plan, build and review run side by side. Testing runs one Auto job at a time, on a database that belongs to Auto. | owner |
| 13 | A ticket the Foreman's first brief calls stack-sized is set aside as `Too big for Auto`. No hand-off to Stacks. | owner |
| 14 | Auto starts nothing new near the usage limit, and the Auto tab says so. | owner |
| 16 | Notifications only for `Ready for you to try`, `Needs you` and `Too big for Auto`. | owner |
| 17 | Auto's risky calls are written down in both places: in Starbase, with the count in the finish notice, and in PR #1's description ("lets store the decisions in both pr desc and starbase"). | owner |

## Three things the code read changed

These differ from what was first put to the owner. They were put to him with Q15 to Q17 on 2026-11-12; he answered the questions and raised nothing against these, which is taken as his OK.

1. **The workflow skills change too.** The Foreman's own instructions forbid Auto at L3 and require his own words for any plan with a migration. Starbase alone cannot make the Foreman carry on. So this build changes the skills repo as well as Starbase, and go-live includes installing the skills.
2. **The crew runs no database commands under Auto. Starbase applies the migrations.** Q8 said a database command is "allowed on the job's own local database". The rule in the code cannot see which database a command targets, and teaching it to would be the riskiest part of the build. The simpler rule gives the same result: a database command from the crew is refused with a note, and Starbase itself applies the job's migrations to Auto's database when that job's turn to test comes.
3. **Not every job has a brief just before testing.** L0 jobs and the quick flow run their checks (lint, type check, build; no database) inside the build step. Those checks run side by side. Everything that uses the database or the browser is still one job at a time.

## How it behaves

### 1. Which jobs are Auto jobs

- A ticket with the tag is started by Auto. The job remembers that it began with the tag, and keeps that after Auto is switched off and on again.
- A job he started and then switched to Auto shows under `Auto` while the switch is on.
- Switching Auto off on any job moves it to `Yours`.
- After PR #1 the job stays in the Auto tab under `Ready for you to try` until he acts on it: a message to the Foreman, Go, Send back, or a ship step. Trying it does not move it.

### 2. Jobs: `Yours` and `Auto`

- Two tabs above the layouts (lanes, list, floor), each with a count. The chosen tab is remembered.
- `Auto` has three groups:
  - `Working` with the places in its heading, for example `Working · 3 of 5`. A job waiting for the test place says `Waiting for its turn to test`.
  - `Needs you`: stopped jobs with the reason, and jobs set aside as `Too big for Auto`.
  - `Ready for you to try`: PR #1 is open. Each row shows the level and the number of risky calls.
- When Auto is paused the tab says why at the top: `Auto is paused: the usage limit is near`.
- The Desk's Needs you rows get an `Auto` mark.

### 3. Inbox: `Mine` and `Auto`

- `Auto` lists tagged tickets in groups: `Next up` (waiting for a free place), `Auto is working on these` (each links to its job), `Too big for Auto` (the reason, and a link to the job), and `Couldn’t start` (the reason) when a start failed.
- `Mine` still lists tagged tickets, marked `Starts by itself` or `Auto is working on this`.

### 4. How many at once

- **Working** means Auto is on and the job is not stopped, not finished and not set aside.
- Auto starts the next tagged ticket only while fewer than N jobs are working. N is `Up to [5] jobs at a time` in Settings, Workflow, Auto start; 1 to 10.
- Auto starts nothing while 10 Auto jobs are unfinished (working or stopped). Finished and too-big jobs do not count.
- A job he switches to Auto by hand counts as working and is never refused. Auto just starts nothing new until the count is under N again.

### 5. No questions before PR #1

| Today Auto stops when | With this build |
|---|---|
| The Approver says stop, or calls its own go high risk | Auto asks the Approver once more for the safer answer (changes least, can be undone), sends it, and lists it as a risky call |
| The crew runs a database command | Refused with a note: Starbase applies this job's migrations on Auto's database. The job carries on |
| A change outside the job's folders, a push other than to the fork, a merge, a tool Auto may not use | Refused with a note to find another way or leave it for after PR #1. The job carries on. Listed under What Auto decided |
| The job is L3, or the Foreman proposes L3 | It runs to PR #1. The finish notice and the row say L3 |
| The ticket has migrations | It runs. See section 6 |
| A plan that contains a migration needs his own words | The Approver approves it like any plan |

Still a stop, under Needs you, because nothing can move the job:

- The Approver failed twice in a row, or a step is too long for it to read.
- The same step came back three times, or 40 permission asks in one reply.
- The Foreman says it is blocked, or its status file is unreadable three times.
- A reply cut off by a restart, or nothing moving for ten minutes.
- He wrote to the job while a step waited: that step is his.

Unchanged: Auto ends at PR #1. It never merges, and never answers the cards about PR feedback or review rounds, which come after PR #1.

### 6. Testing and the database

- **Auto's database.** One extra database, named after his with `__auto` on the end (for Orbit `moxie_snapshot__auto`), on the same local server. It costs one 6.9 GB copy.
- **A job's turn.** When an Auto job's evidence is ready to record, Starbase:
  1. makes Auto's database afresh from the saved original (about 11 seconds with Postgres's file copy),
  2. applies that job's migrations to it,
  3. starts the job's app pointed at Auto's database,
  4. records the evidence, then stops the app.
- **His database is never touched.** Auto never changes `moxie_snapshot`, never stops his Try it servers, and never waits for him.
- **One at a time.** Recordings already run one at a time. On top of that, only one Auto job is in the Test step at once: Auto holds its Go on the brief that starts testing until the place is free.
- **A migration that fails** on Auto's database goes back to the Foreman as a message with the error, to fix. The existing three-times rule makes it a stop if it keeps failing.
- **`Ready for you to try`** uses today's Try it, which switches his local database to the job's branch and back. Try it gets the same fast copy, so a switch takes about 11 seconds, not 99.
- **If there is no saved original yet**, Auto makes one at a moment when nothing is connected to his database, and never by stopping his servers. Until then the job waits and says so.

### 7. Too big for Auto

- Auto starts the job. If the Foreman's first brief says the ticket is big enough for a stack, Auto does not answer it. It switches itself off on that job and marks it `Too big for Auto`.
- The job shows in the Inbox's Auto tab under `Too big for Auto` and in Jobs under `Needs you`. It takes no place.
- On the job he can press `Run as a stack instead`, answer the brief himself, or switch Auto back on to let it run as one job. Any of those clears the mark.
- The cost is one Foreman reply for each too-big ticket.

### 8. Notifications

For Auto jobs, only these three:

| When | Title | Text |
|---|---|---|
| PR #1 opens | `Ready for you to try: <title>` | `PR #1 is open.` then the level if L3, then `N risky calls` if any |
| A dead end | `Needs you: <title>` | `Auto stopped: <reason>` |
| Set aside | `Too big for Auto: <title>` | `The Foreman thinks this ticket is big enough for a stack.` |

Gone: `Started by Auto`, `Auto start could not start` (it shows in the Inbox's Auto tab), and the permission notices on Auto jobs. Notices that are not Auto's own stay: the usage limit, a reply that failed, and the four-hour reminder on a job that needs him.

### 9. What Auto decided

- Each risky call is a line in the What Auto decided list with a `Risky call` mark: what the Approver first said, what Auto chose, and why.
- Each refusal is a line too: `Refused: <what>`.
- The count of risky calls shows on the row, on the job page and in the finish notice.
- **In PR #1's description:** a short section headed `Decisions Auto made`, one line for each risky call: the step, what was in doubt, and what Auto chose. Starbase gives the Foreman the list with its go-ahead for PR #1, and the Foreman puts it at the end of the description as written. With no risky calls there is no section. Refusals are not listed there; they stay in Starbase.

### 10. The website

The same tabs show on the website. The job rows already go up; the new facts (began with the tag, finished, waiting to test, too big, risky count, and the Inbox's Auto groups and places) are added to what Starbase sends. No website database change is expected; the plan confirms it.

## How it is built

Six parts, each reviewed on its own.

| Part | What | Where |
|---|---|---|
| A | The Auto record keeps how the job began; places count every working Auto job; N is a setting; ceiling of 10 | `dashboard/lib/auto.js`, `auto-start.js`, `state.js`, `runner/index.js`, Settings |
| B | No questions: refuse on the card, the safer second ask, L3 allowed, the migrations trigger no longer a stop | `dashboard/lib/auto-rules.js`, `auto.js`, `runner/auto.js`; skills repo `feature/skills/feature/job-options.md`, `workflow-gates.md`, the bug-fix levels, the database checklist |
| C | Auto's database, the job's turn, the test place, the fast copy for Try it | `dashboard/lib/local.js`, `runner/evidence.js`, `runner/auto.js` |
| D | Too big for Auto, the three notifications, the risky count, the `Decisions Auto made` list for PR #1's description | `runner/auto.js`, `auto-start.js`, `runner/index.js`, `lib/auto-log.js`; skills repo `feature/skills/feature/job-options.md` and the bug-fix equivalent |
| E | Jobs tabs, Inbox tabs, the Desk mark, the job page's lines | `web/src/home/JobsPage.tsx`, `views/Inbox.tsx`, `home/DeskView.tsx`, `views/Settings/AutoStartGroup.tsx`, `job/page/` |
| F | The new facts on the website | `dashboard/runner/mirror.js`, `hosted/` |

Go-live for this build: merge to `main`, install the skills on the laptop, rebuild, restart Starbase when no job is mid-reply, push. The skills repo is still not pushed to GitHub.

## Not in this build

- Handing a too-big ticket to Stacks. It needs seven things that do not exist.
- A database per Auto job.
- A setting to bring the old stops back. Auto has one way of working.
- Auto after PR #1.

## Risks

| Risk | Cover |
|---|---|
| Auto's rules were deep-reviewed on 2026-11-11 (5 Critical, 10 Important fixed). Loosening them can reopen a hole | Refusals reuse the existing deny path. Nothing that was refused before becomes allowed, except L3 and plans with migrations. Part B gets a review on the most capable model, like the last one |
| The job's app ignores the database address Starbase gives it and uses his database | The plan proves the address wins for Orbit (a Next.js app; its migrate script already takes it this way) with a test, and the recording refuses to start if the app's database is not Auto's |
| A wrong safer call lands in PR #1 | PR #1 is not merged, and the risky calls are listed and counted in front of him and in the PR's description for the team |
| The Foreman leaves the section out of PR #1's description | The skills say to add it as written, and Starbase's own list is complete whatever the PR says |
| Five jobs load the laptop | Testing is one at a time; N is a setting he can lower |
| A job with a guessed branch | Unchanged: Auto never acts on a guessed branch |

## Testing

- Server tests for each rule change, with the old stop as the failing case first.
- A demo run end to end: three tagged tickets, one with a migration, one stack-sized; expect two at `Ready for you to try` with no click, one under `Too big for Auto`, and his database unchanged.
- The real-browser pass used for the job page, on the two new tabs at laptop and phone widths.

## Code facts for the plan

From the code read of 2026-11-12, at 8c794b8.

- **Auto record:** `{on, since, by, tag, ran, stopped, step, failures, lastBrief, cards, cardsBrief, problem, spent, finished}`; `dashboard/lib/auto.js:10-22,53-57`. The hand switch always writes `by: 'you'` (`runner/index.js:2826`); a tag start writes `by: 'tag'` (`:2486`).
- **Places:** only tag-started jobs count (`auto-start.js:42-45`, `index.js:2239-2259`); `AUTO_START_MAX_JOBS = 5` (`auto-start.js:19`, used `:91`); freed by `freed()` (`runner/auto.js:151,172`).
- **Setting:** `workflow.autoStart {on, tag}`: `auto-start.js:24-27`, `state.js:27,36`, validated `index.js:2999-3007`; web `views/Settings/AutoStartGroup.tsx:17`; type `api/types.ts:492,2002`.
- **Stops:** `triage` and `attend` in `runner/auto.js:202-387`; judgment `:379,381`; cards `attendCard :518-552`, `stopOnCard :547`; deny with a note exists at `:668-671`; L3 `autoAllowed` (`auto.js:44-47`), `runner/auto.js:210,336,524`; job-level `migrations` trigger `auto-rules.js:132`.
- **Database rule:** `auto-rules.js:342-343,462,606-653,712-762,823,1098-1162`; hard line `hard-lines.js:176-189,522`. It cannot see a command's target.
- **Skills:** Auto's rules in `feature/skills/feature/job-options.md:138-171` ("What Auto never does": L3, the human's own yeses); `feature-spec/workflow-gates.md:7,80`; `feature/SKILL.md:93,99`; `bugfix/skills/bugfix/levels.md:11-13,36`; `common/skills/workflow-common/checklists/db.md:5,10`; `common/agents/feature-tester.md:15-16`.
- **Try it's database:** `local.js:512-529` (`#database`), `:624-697` (`database`, one `dbBusy`, `#needQuietDb :582-595` stops every Try it server), copies at `:649,661` with the default strategy; migrations `:682` with `DATABASE_URL` in the env. The app's settings file is copied from the main checkout with only ports and the sign-in skip changed (`:91-105,294-326`); the dev server gets `childEnv({PORT, HOSTNAME, HOST})` (`:350`).
- **Recording:** `runner/evidence.js`: one at a time (`:152,298-305`), starts by itself at `stage === 'test'` with a ready report (`:310-332`), `serverFor :198-233`, `dbCheckFor :240-251`, Playwright with `process.env` (`:174`).
- **Gate into Test:** the build brief with `nextStage === 'test'`; `triage` already reads `gate.nextStage` (`runner/auto.js:239`). No such brief at L0 or in the quick flow.
- **Too big:** `stackSuggested` parsed `lib/status-json.js:178`, on the card `index.js:997-998`, not passed to Auto's jobs (`index.js:1850-1872`); web `views/Stack/StackRows.tsx:113-140`, shown in `job/page/JobPage.tsx:257`.
- **Notifications:** `auto-start.js:196,201`; `runner/auto.js:149,170`; `index.js:2019,791,2036,2038`.
- **Web:** `home/JobsPage.tsx` (layouts `:54-58`, groups `:216-229`, `WhatAutoDecided :178`); tab pattern `views/Inbox.tsx:417-434`; Inbox marks `:254,725,728`; Desk rows `home/homeModel.ts:418-439`, `home/DeskView.tsx:216-243`; `job/WhatAutoDecided.tsx`.
- **Website:** `runner/mirror.js:129,136-142,196-200`; the hosted Inbox reads Orbit itself (`hosted/site/routes-orbit.js:69-82`).
- **Measured:** one copy of the 6.9 GB snapshot takes 98.8 s with the default strategy and 10.9 s with `--strategy=file_copy` (Postgres 17.11, laptop quiet).
