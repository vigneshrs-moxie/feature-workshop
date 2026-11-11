# Starbase feedback round, Part 3 (the job page): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the job page as the approved prototype draws it: a pinned header, an overview card, the bar and the approval card, seven steps that open in place, a full-height conversation, a Test step that shows three kinds of test as they run, and its own phone layout, on the laptop and on the website.

**Architecture:** The laptop's runner adds the new facts to answers the page already reads (`GET /api/job/:slug` gains `page`, the stage view gains the step's times, documents, feed and step blocks, the commits list gains files, the evidence view gains `progress`), so the website gets them through the mirror with no new store. The new page is built beside today's page from small files in `web/src/job/page/` that reuse the bar, the gate card, the thread and the composer. The route switches to it in Task 17; the old page and the step page are removed in Task 18. Task 6b closes the one gap in Auto's rule for a step he wrote to before the bar is moved.

**Tech Stack:** Node 24 (ES modules, `node --test`) in `dashboard/` and `hosted/`, React + TypeScript + Vite + vitest in `web/`, Playwright 1.64 (the evidence recorder and `web/e2e`).

**Spec:** `docs/plans/2026-11-10-feedback-round-design.md`, Part 3 (3.1 to 3.5 and its "Done when"), with "Decided" and "How it is built and released". The reviewed prototype is the layout: its brief `/Users/moxie/.claude/wireframes/starbase-feedback/starbase-job-page.brief.md` (32 requirements, 2 decisions, 15 notes), `design.md` beside it, and the built page `starbase-job-page.html`. Executors read the design's Part 3 and the brief.

## Global Constraints

- Build on the branch and worktree the lead names (after the round is live this is a new branch from `main`). Never push. Never read, write or list `~/.starbase`, and never open port 4477: that is the owner's running Starbase. It is rebuilt only when he asks.
- **Read first.** This plan was written against `0316f4c` while review fixes were still landing in `web/` (`web/src/job/JobPage.tsx`, `AutoSwitch.tsx`, `autoLine.ts`, `web/src/panes/Foreman/GateCard.tsx`, `gateSent.ts`): the Auto switch, What Auto decided and the model line on the job page, the bar's sent state, the Reply and Send back boxes. Every task starts by reading the files it names as they are now. It was then checked against `feature/feedback-round` after Part 2's Auto server fixes merged (`dashboard/runner/auto.js`, `dashboard/lib/snapshot.js`). Functions and components are named so you can find them; line numbers are from that check and will have moved. Where the fixes already built something a task asks for, keep it and its test, say so in the task report, and add only what is missing.
- The real job page is `JobPage` in `web/src/job/JobPage.tsx`, mounted by `web/src/app/App.tsx` and `web/src/views/Hosted/HostedWorkshop.tsx`. The components `JobHeader` and `ForemanPane` are mounted by no page, only by tests: build nothing into them and do not read their behaviour as today's. The page imports the live pieces that share their files: `JobMenu` (`panes/Foreman/JobHeader.tsx`), `ThreadList`, `useJobConversation`, `useCurrentJob` (`panes/Foreman/ForemanPane.tsx`).
- **The owner's one requirement for this page** (2026-11-11: "i just want to make sure theres a button for us to send our approval/changes to the foreman if needed"): the bar with `No go: send back`, `Reply` and `Go: …` is on every step that waits for him, on Auto jobs too, whether Auto is on, deciding or stopped. No task hides or disables the three calls because of `job.auto`. Send back opens "What should change?" and keeps the Foreman at the step (`kind: 'changes'`); nothing is approved. Two states keep today's rule and say so where they are tested: a waiting permission card puts the permission alert in the bar's place (its own Allow and Deny; the three calls come back once it is answered), and a stopped job with no gate (a status card) has Reply only. Each state, its task and its test: Auto on, deciding, stopped, and after he wrote (Tasks 6b, 7); every open step, Widen, the full-screen conversation under 1100 px and the website (Task 15b); the phone's job screen, the waiting step's screen and the website's phone (Task 16); the demo (Tasks 17, 18).
- **Auto leaves a step to him once he writes (built on the branch; Task 6b closes the gap).** What is there: when the owner sends a message of his own (or steers one in) after the waiting brief was raised, Auto never sends for that brief: an Approver answer it was waiting on is dropped (`youSpokeSince`, `dashboard/runner/auto.js`), and the next pass stops Auto with `you wrote to this job while this step waited, so it is yours to decide.` (`youWroteWhileWaiting` and `YOURS_NOW` in `attend`). The lane then reads `Auto stopped: you wrote to this job while this step waited, so it is yours to decide.` (needs-you, `laneFor` in `dashboard/lib/snapshot.js`). Once he decides the step himself (Go or Send back: a send with its `gateBrief`, `carryOnIfYouDecided`), the stop clears and Auto carries on from the next step. Tests: `auto-server.test.js` K4/I5, N2, N6, I5 (runner) and H2; `lanes.test.js` `lanes: Auto stopped: …`. What is missing: until that pass reaches the job (after the Foreman's reply to him ends, and behind any other job's Approver call in the same pass) the lane still says `Auto is deciding: …`. Task 6b makes it say his from the moment he writes. Nothing in this plan sends for him, and the page never says Auto is deciding a step he wrote to.
- Tests first: write the failing test, see it fail, then the code. Server tests use a temp state folder and port 0 through `dashboard/test/helpers/dashboard.js`, as `dashboard/test/evidence-server.test.js` does. No test calls a real model or a real browser.
- Commands: `npm test` (dashboard), `npm run web:test` (web), `npm test -w hosted` (website), `npm run web:build` (type check and build). One file: `node --test dashboard/test/<file>.test.js`, `npx vitest run <path>` inside `web/`.
- Say **Starbase** in every string. Words on screen are plain, in short sentences, with no dash used as punctuation. Strings quoted in this plan are exact (they are the prototype's unless marked "not drawn").
- Every screen works in laptop mode and in hosted (website) mode (`api.hosted?.()`). Each web task tests both. What only the laptop has (the gear menu, Try it, Watch, commits, terminals, a command's output) says so in one sentence on the website and never shows an error.
- A push to `main` releases the website, but the laptop is rebuilt only when the owner asks, so the website can show a job record from an older Starbase. Every field Tasks 1 to 6b add to `web/src/api/types.ts` is optional (`?`), and every reader treats a missing one as "not known" (Task 15b's test).
- `web/e2e/noEmptyScroll.mjs` and `web/e2e/noJump.mjs` are clean at 1280, 1512 and 1920 px from the task that switches the route (Task 17) on.
- Colours, sizes and spacing come from `web/src/theme/tokens.css`. `cssRules.test.ts` and `scrollAreas.test.ts` stay green. New classes carry the prototype's names (`sb-steps`, `sb-step`, `sb-switch`) or the `sb-` prefix.
- Phone screens (760 px and under, `useNarrow()`) are their own simple layouts, as drawn, not the laptop squeezed.
- The mirror never carries keys named `diff`, `patch`, `env`, `token` or `source`: no new field uses those names. A command's output and the live picture stay on the laptop.
- Nothing existing is lost: every action on today's job page and step page has a home on the new one (table below). A task that moves one keeps its test.
- Commit at the end of each task. End messages with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. A job started before this change (every job the owner has today): no saved filer, no `acceptance.md`, a plan with no `### S1` headings, no start time. Each area says so in a sentence ("Not written yet…") and the rest of the page is whole; nothing is blank or throws. The same on the website when the laptop runs an older Starbase (no `page`, no step times, no feed). Tests in Task 1, Task 4, Task 10, Task 12 and Task 15b.
2. You are typing in "What should change?" or the message box when the page fetches the job again, the open step's feed refreshes, the job moves to its next step, you pick a step, or you press Widen and Back to the job: your words and the open box stay, and the open step does not change under you once you picked one. Tests in Task 8, Task 15a, Task 15b and Task 17.
3. A recording dies part way (the app stops, the browser is missing, the laptop sleeps): the bar and the Jobs card stop saying "Recording evidence: line 4 of 19" the moment the run ends, and the Test step shows the problem with `Record again`. Tests in Task 5a and Task 13.
4. A conversation of several hundred messages: it opens at the newest, `Load older` keeps the message you were reading where it was, a new message does not pull you down while you read higher up, and the phone's count has only messages newer than your last look, never your own. Test in Task 14.
5. A laptop window between 761 and 1099 px wide (half a screen): seven steps still fit with no sideways scroll, and the conversation is behind the fixed `Conversation` button, not a squeezed column, and a job that waits for you keeps the bar and its three calls above the full-screen conversation. Tests in Task 15b and Task 17 (800 and 1024 px).

---

## Built beside the old page, then switched

The new page is new files; `JobPage` keeps its route until Task 17. Why: the old page's tests keep guarding the bar while the bar moves and gains words (Task 7 and Task 8 change the shared bar and card in place, for both pages and the Desk); a half-built page never reaches the owner's copy; and each task's diff is one area with its own tests. After every task the four commands pass and the routed app works. The new page is called `NewJobPage` while both exist and takes the name `JobPage` in Task 18.

## Taken from the prototype as drawn

The two Info decisions: **A** for both, as drawn. The conversation is full height and the steps span the work column. The overview starts folded, then stays as you left it (one remembered value for all jobs, the existing `Fold` store).

| # | Note | What the plan does |
|---|---|---|
| 1 | Header pinned | As drawn on the laptop: the header sits above the page's two scroll areas (Task 15a). On the phone it scrolls with the page (Task 16). |
| 2 | Bar and card between overview and steps | As drawn (Task 15a). |
| 3 | Which step opens | One step is always open: your pick on this page, else the address's step, else the step the job is working or waiting at, else the one you last opened on this job, else the job's current step. Picking a step puts it in the address, so the page follows the job only until you pick (Task 15a). |
| 4 | Whole conversation, no Earlier fold | As drawn. `Load older` at the top stays as the way back through a long history (Task 14). |
| 5 | Tabs move into the steps. Decide: the full Decisions list | As drawn. The full list lives in the Copy decisions panel as a second fold, "Everything decided on this job" (Task 9). **Owner to confirm.** |
| 6 | How long | Time in the step, "so far" on the current one. A step runs from the last brief of the step before it to its own last brief (Task 2). |
| 7 | After Go the step reads Approved. Decide the word | `Approved`, as drawn (Task 11). **Owner to confirm the word.** |
| 8 | Reply and Send back use the same Sent line | As drawn, with the three second lines (Task 7). |
| 9 | What Auto decided only once Auto decided | As drawn (`auto.ran`, Task 9). |
| 10 | Auto stopped: needs-you look, same three buttons, card says what Auto decided so far | As drawn (Task 7, Task 8). |
| 11 | Three pull request stages | As drawn (Task 4, Task 12). |
| 12 | Phone order | As drawn, plus one thing for the owner's requirement: the phone screen of the step that waits also carries the bar (Task 16). **Owner to confirm.** |
| 13 | Watch on a narrow laptop window; the website has progress and videos | Watch shows wherever the laptop serves the page, at any width. The website has no Watch button (Task 6, Task 13); it has the progress (Task 5a) and each line's video (Task 5b). |
| 14 | Not drawn: loading and error states | Each area loads and fails alone, with the app's own lines ("Couldn’t load …" and `Try again`) (Task 11, Task 15b). |
| 14 | Not drawn: the 30-second Try again | Kept as today: "Nothing has moved yet." and `Try again` on the bar (Task 7). |
| 14 | Not drawn: the Auto switch at L3 | Kept as today: off, with the `AUTO_L3` sentence (Task 9). |
| 14 | Not drawn: the website's version | The same page. Differences are listed per task and tested. |
| 14 | Not drawn: the document reader | A document opens in place under its step's list in today's reader, with Back to the list (Task 11). |
| 15 | Feed and Watch are still pictures; a step's address | The feed refreshes every 5 s while the step works (Task 11). Watch is about two frames a second (Task 6). A step's address stays today's `#/job/<slug>/stage/<step>`, not the drawn `?step=`: links across the app already use it. The phone's other screens are `#/job/<slug>/conversation` and `#/job/<slug>/overview` (Task 15a). |

Drawn details that are not built, because nothing gives the fact today: the count in "3 checks passed" (the page says `Checks passed`); the `Database change` chip on a plan step; the first sentence under "Auto stopped:" ("Auto never approves a database change."); "It matches spec v3." after "No findings."; the recorded evidence's "took 9 min" and the app's address `localhost:3013` (Task 13); the phone's "4 decisions" count on the What Auto decided row (Task 16).

Other readings where the drawing is silent (the simplest one is taken): What to check is read from `acceptance.md`; the hand test has no stored result, your result is your Go or Send back at the Test step (**owner to confirm**); on the website the commits stay on the laptop (**owner to confirm**); the filer's name is kept in Starbase's own record of the job, never in the job folder, and goes to the website with the job (**owner to confirm**); the Desk's card gets the same new order because it is the same card (**owner to confirm**); between 761 and 1099 px the conversation is behind the `Conversation` button (**owner to confirm**); with the conversation widened, a job that waits for you keeps the bar above it (**owner to confirm**).

## Nothing existing is lost

| Today (job page, step page) | New home |
|---|---|
| State chip, ticket chip, level chip with its menu, facts line and where line, part of a stack, the Auto switch, What Auto decided, the Foreman model line | Header (Task 9) |
| Copy decisions (head, Details, Decisions tab) | Header, once; a row on the phone |
| Gear: Mark done or dropped…, Reopen or Keep it open, Notes and options…, Try it on your computer, Change model…, Permissions for this job | Header gear, unchanged, laptop only as today |
| How it works (job guide, step guide) | Header, one guide with new words (Task 9) |
| Stack suggestion | Above the bar (Task 15a) |
| Permission alert; Go / no go bar with Send back, Reply, Go and Try again; the Auto line on the bar; review round bar; Reply (c); See the pull requests | The bar (Task 7). See the pull requests opens the Ship step |
| "Now" line and "Working now" list | The bar's sentence and the open step's crew rows |
| Stops strip and full stop map linking to step pages; `[` and `]` | The steps row; a step opens in place; `[` and `]` move the open step |
| Brief tab | Each step's Documents (a brief sits under the step of its stage) |
| Spec tab with Review the screens | Spec step (Task 12) |
| Plan tab | Plan step: its steps and Documents |
| Code tab with a commit's changes | Build step: commits, files, a commit opens its changes (Task 12) |
| Tests tab: evidence with Record, test documents, Try it | Test step (Task 13) |
| Review tab with the Review walkthrough fold | Review step (Task 12) |
| Decisions tab (the full list) | Copy decisions panel, second fold (Task 9) |
| Ship tab: review panel, nudges, the GitHub line | Ship step (Task 12) |
| Conversation: Load older, level card, live row, composer with Send…, Steer and Stop | Conversation panel (Task 14). The Earlier fold goes: the whole history shows. Permission cards stay out of the conversation as today (`cards={false}`); they are the permission alert on the bar (Task 7) |
| Step page: who is on it, Open in terminal, Watch in terminal, Open the job’s folder in a terminal, terminal app picker | Step panel, laptop only (Task 11) |
| Step page: Finished here fold (key n) | Finished crew are rows in "Who worked on it"; the fold and its key go; n is Notes and options everywhere |
| Step page: Conversation at this stop fold | Goes: the whole conversation is beside every step |
| Play full: crew faces on the stops, the bench strip | Faces on the steps row, the strip above the crew rows (Task 11) |
| Keys a, r, c, n and the card’s own keys | Unchanged |
| ⌘K Open docs, a document link in a reply, Try it and Screens requests | Open the document under the step that owns it; open the Test step with Try it open; the Screens page as today (Task 15b) |
| Documents no step wrote (notes, workflow status, history, status.json, options.json) | As today, reached by a link or ⌘K: they open in the reader under the open step |

## File Structure

- Server: one new file, `dashboard/lib/job-page.js`, holds the pure readers for the page's facts. Everything else is added where its neighbour lives: the ticket's filer in `ticket-file.js`, recent actions in `session-log.js`, findings in `play.js`, commit files in `git.js`, a pull request's opened time in `flow.js`, Auto's lines in `decisions.js`, the What Auto decided facts in `auto-log.js`, the "he wrote" rule in `lib/auto.js`, `runner/auto.js` and `snapshot.js` (Task 6b), the step's blocks in `stage-view.js`, progress and the live frame in `evidence.js` and `dashboard/runner/evidence.js`, and `jobDetail().page` in `dashboard/runner/index.js`.
- Web: the bar moves to `web/src/job/NextStep.tsx`. The new page is `web/src/job/page/`, one file per area (header, overview, steps row, step panel, one body per step, conversation, the page, the phone page), each with its test beside it and one stylesheet, `page.css`.
- Shared pieces changed in place: `GateCard.tsx`, `EvidenceStrip.tsx`, `gateSent.ts`, `sentView.ts` (shared with the Desk), `Composer.tsx`, `ThreadList` (one prop), `DocsTab.tsx` and `Page.tsx` (exports), `DecisionsTab.tsx` (one prop), `AutoSwitch.tsx` (two props), `WhatAutoDecided.tsx`, `CopyDecisions.tsx`, the router, the key registry, `api/types.ts`.
- Removed in Task 18: `job/JobPage.tsx`, `job/StagePage.tsx`, `job/CodeTab.tsx` and their tests.

---

### Task 1: The overview's facts (design 3.1)

**Files:**
- Modify: `dashboard/lib/ticket-file.js`, `dashboard/runner/index.js` (the ticket start, where `readTicketFile` is called; `jobDetail`), `web/src/api/types.ts`
- Create: `dashboard/lib/job-page.js`
- Test: `dashboard/test/ticket-file.test.js`, `dashboard/test/mirror-shape.test.js`; create `dashboard/test/job-page.test.js`, `dashboard/test/job-page-server.test.js`

**Interfaces:**
- Consumes: `readSummary(dir, file, version)` (`dashboard/lib/docs.js`), `state.sessionFor(dir)` and `state.setSession(dir, patch)`, `options.ticket` (`{ key, title, url }`), the fixture `dashboard/test/fixtures/orbit/ticket-ORBIT-479.json`.
- Produces:
  - `ticketFacts(detail): { filedBy: string | null, filedAt: string | null }`: `submitter.fullName` (one line, 80 characters at most) and `createdAt`, picked by name the way the file picks every field. Nothing else.
  - `ticketDescription(md: string): string | null`: the text inside the fenced block under `## Description` of a `ticket.md`.
  - `readTicket(client, ticket, opts): Promise<{ md: string, facts: { filedBy, filedAt } } | null>`; `readTicketFile` stays and returns its `md`.
  - `readAcceptance(text: string): { worksWhen: string[], mustNot: string[] } | null`: the numbered lines under `## It works when` and `## It must not`, the trailing `(FR-…)` brackets dropped; null when neither heading is there.
  - At the start of a ticket's job: `state.setSession(featureDir, { ticketFacts })`. The name never goes into the job folder.
  - `jobDetail(f).page` (`JobPageFacts` in `types.ts`, `JobDetail.page?`):
    - `ticket: { key, title, url, filedBy, filedAt, description } | null` (null with no ticket).
    - `building: { from: 'spec' | 'brief', version: string | null, outcome: string[], risks: string[] } | null`: the spec's summary, else the first brief's, else null.
    - `check: { version: string | null, worksWhen: string[], mustNot: string[] } | null`: from `acceptance.md`; null when the file is missing.

- [ ] **Step 1: Read the files as they are now.** Run `git log --oneline 0316f4c..HEAD -- web/src/job web/src/panes/Foreman dashboard/runner dashboard/lib`. Read this task's files, and skim `web/src/job/JobPage.tsx`, `web/src/job/autoLine.ts`, `web/src/panes/Foreman/GateCard.tsx` and `gateSent.ts`. In the task report, list every function or component this plan names that is no longer there or has a new name, for the lead to pass to the later tasks.
- [ ] **Step 2: Failing tests**
  - `ticket-file.test.js` → `ticketFacts picks the filer’s name and the created date and nothing else`: the fixture gives `{ filedBy: 'Pat Reporter', filedAt: '2026-10-01T09:00:00.000Z' }`; a ticket with no submitter gives both null. `ticket.md still holds no name`: `ticketFile(fixture, …)` does not contain `Pat Reporter`. `ticketDescription returns the description block`: from that file, `Starbase should read tickets with a personal token and never write.`
  - `job-page.test.js` → `readAcceptance reads both lists and drops the FR brackets`: `## It works when` with `1. A manager can add a note on any customer. (FR-001)`, `## It must not` with `1. Show notes to techs. (FR-004)` and `2. Slow down the customer list.` gives `{ worksWhen: ['A manager can add a note on any customer.'], mustNot: ['Show notes to techs.', 'Slow down the customer list.'] }`. `a file with neither heading is null`.
  - `job-page-server.test.js` → `a ticket job’s page has the ticket with who filed it, what we’re building from the spec summary and the check lists`: start a job from the fake Orbit ticket, write `summaries/spec.v0.3.json` and `acceptance.md`, GET `/api/job/<slug>` → `page.ticket.filedBy === 'Pat Reporter'`, `page.building.from === 'spec'`, `page.check.worksWhen.length === 1`. `the filer’s name is in no file of the job folder`. `a job from before this change still has a page` (Review Focus 1): a job folder whose `options.json` holds a ticket, with no session facts, no summaries and no `acceptance.md` → `page.ticket.filedBy === null`, `page.ticket.key` set, `page.building === null`, `page.check === null`. `before there is a spec, what we’re building comes from the first brief’s summary`.
  - `mirror-shape.test.js` → `the job record carries page`.
- [ ] **Step 3:** Run the four files; they fail (missing exports, no `page`).
- [ ] **Step 4:** Implement. `jobDetail` builds `page` with one helper in `runner/index.js` that reads the session record, `ticket.md`, the summaries and `acceptance.md`; a read that fails gives that part null. `jobDetail` already has a local `const page = await threadPage(f, audit)` (returned as `thread: page.items`, `threadMore: page.more`): rename that one `threadPart` first, so `page` is only the new facts. The thread route's own local `page` (the `threadMore` request further down `runner/index.js`) is a different function and stays.
- [ ] **Step 5:** Run `npm test`, `npm test -w hosted`, `npm run web:build`.
- [ ] **Step 6:** Commit `feat(job-page): the overview's facts on the job answer`.

### Task 2: How long each step took, and each step's documents (design 3.2)

**Files:**
- Modify: `dashboard/lib/job-page.js`, `dashboard/lib/features.js` (`listBriefs`), `dashboard/lib/stage-view.js` (`stageView`), `dashboard/runner/index.js` (`page`), `web/src/api/types.ts`
- Test: `dashboard/test/job-page.test.js`, `dashboard/test/stage-view.test.js`

**Interfaces:**
- Consumes: `STAGE_STOP`, `STOPS` and `stagesOf` (`stage-view.js`), `listJobDocs` entries (`JobDocEntry`), the job's `new-job` audit line.
- Produces:
  - `listBriefs` entries gain `at` (the file's time, ISO).
  - `stepTimes({ briefs, startedAt, stage, kind, skipped }): Record<StopId, { startedAt: string | null, endedAt: string | null }>`. A step the job has left ends at its last brief's `at`. A step starts where the nearest earlier step that ran ended, the first one at `startedAt` (the `new-job` audit line's time, or null). The current step has `endedAt: null`. A step not reached or skipped has both null.
  - `stepDocs(docs, kind): Record<StopId, JobDocEntry[]>`: `spec`, `requirements.md`, `ticket.md`, `wireframes.html`, `wireframes.json` → spec; `findings.md` → investigate; `implementation-plan.md`, `quick-plan.md`, `test-plan.md`, `acceptance.md`, `dev-tests.md`, `manual-test.md` → plan; `implementation-log.md`, and the plan file again (as drawn) → build; `test-report.md`, `evidence/evidence.json` → test; `review.md`, `review/*.md`, `fable/*.md` → review; `briefs/NNN-<stage>.md` → the step of its stage (`STAGE_STOP`); anything else under none.
  - `page.times`, `page.docs`; `StageView.time?: { startedAt, endedAt }`, `StageView.docs?: JobDocEntry[]` (copied from `job.page` for that step). `StageView.since` stays as it is (when the job reached the stop, by its crew or its history); `time` is the step's span by its briefs, and the page's time words read `time` and fall back to `since` when `time.startedAt` is null (Task 11).

- [ ] **Step 1: Failing tests**
  - `stepTimes: a job at Build`: start 08:00, briefs spec 09:10, investigate 09:40, plan 10:30, stage `implement` → spec `{08:00, 09:10}`, investigate `{09:10, 09:40}`, plan `{09:40, 10:30}`, build `{10:30, null}`, test, review and ship both null.
  - `stepTimes: a skipped step has no times and the next starts where the last one ended`.
  - `stepTimes: with no start time the first step has no start`.
  - `stepDocs: each known file sits under its step, a brief under the step of its stage, the plan under Plan and Build, notes and status under none`.
  - `stepDocs: a bug job’s triage, reproduce and diagnose briefs go to Spec, Investigate and Plan`.
  - `stage-view.test.js` → `the stage view carries the step’s times and documents`.
- [ ] **Step 2:** Run `node --test dashboard/test/job-page.test.js dashboard/test/stage-view.test.js`; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, `npm test -w hosted`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): step times and each step's documents`.

### Task 3: The crew's last actions (design 3.2 "live feed", 3.3 "names who")

**Files:**
- Modify: `dashboard/lib/session-log.js` (`parseSessionLog`), `dashboard/lib/features.js` (`summariseSessions`), `dashboard/lib/stage-view.js` (`crewRow`, `foremanRow`), `dashboard/runner/index.js` (`boardCard`'s `nowDoing`), `dashboard/runner/mirror.js` (`jobRecord`), `web/src/api/types.ts`
- Test: `dashboard/test/parsers.test.js`, `dashboard/test/stage-view.test.js`, `dashboard/test/foreman.test.js`, `dashboard/test/mirror-shape.test.js`

**Interfaces:**
- Produces:
  - `parseSessionLog(...)` result gains `recent: { text: string, at: string | null }[]` (the last 6 actions in `describeTool` words, oldest first, a repeat of the line before it left out) and `lastCommand: { command: string, at: string | null, tail: string | null } | null` (the last Bash call: its command cut at 200 characters, and the last 12 lines of its result, 1,200 characters at most, null until it answers).
  - Activity entries carry `recent` and `lastCommand`.
  - `StageAgent.feed?: FeedLine[]` (`FeedLine = { text: string; at: string | null }`) on working and finished agents; `StageAgent.command?: { command, at, tail } | null`, set only for `feature-tester` at the test step.
  - `NowDoing.model?: string | null` (the model's label) on the board card.
  - `jobRecord(detail)`: every activity entry's `lastCommand.tail` is null on the wire.

- [ ] **Step 1: Failing tests**
  - `parsers.test.js` → `the session log keeps the last six actions in words, oldest first`: a log with 8 tool calls gives 6 lines, the last equal to `lastAction.text`. `two same actions in a row are one line`. `the last command keeps its last 12 lines of output`: a Bash call with a 40-line result → `tail` is lines 29 to 40; a Bash call not answered yet → `tail: null`.
  - `stage-view.test.js` → `each agent carries its feed`; `only the Tester at Test carries its command`.
  - `foreman.test.js` → `now-doing names the model`, beside the existing now-doing test.
  - `mirror-shape.test.js` → `a command’s output never goes up`: `jobRecord` of a detail whose activity has `lastCommand.tail: 'secret'` has no `'secret'` anywhere in its JSON.
- [ ] **Step 2:** Run the four files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, `npm test -w hosted`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): the crew's last actions and the Tester's command`.

### Task 4: Plan, Build, Review and Ship facts (design 3.2)

**Files:**
- Modify: `dashboard/lib/job-page.js`, `dashboard/lib/play.js` (beside `parseReviewFindings`), `dashboard/lib/git.js`, `dashboard/lib/flow.js` (`PR_FIELDS` and the row it maps), `dashboard/lib/stage-view.js`, `dashboard/runner/index.js` (`page`; `read.commits`), `web/src/api/types.ts`
- Test: `dashboard/test/job-page.test.js`, `dashboard/test/play.test.js`, `dashboard/test/stage-view.test.js`, `dashboard/test/flow.test.js`; create `dashboard/test/git-commits.test.js`

**Interfaces:**
- Consumes: commits' `step` (`parseLog` in `git.js`: `S3` from `[S3] …` or `S3: …`, else null), `flowLanes.get(slug)` (`pr1`, `pr2`: `FlowPr`, whose `review` is `'approved' | 'changes_requested' | 'review_required' | null` and `checks` `'passing' | 'pending' | 'failing' | null`), `f.prs`, `REVIEWERS` and `lensType` (`play.js`).
- Produces:
  - `planSteps(text): { id: string, name: string }[]`: every `### S<n>: <name>` heading of `implementation-plan.md` (else `quick-plan.md`), in order; none gives `[]`.
  - `stepStates(steps, commits: { step: string | null }[], building: boolean): PlanStepRow[]` (`{ id, name, state: 'done' | 'now' | 'next' }`): done when a commit's `step` equals the step's id; `now` is the first step not done while `building` (the job is at Build and working); the rest `next`.
  - `flow.js`: `PR_FIELDS` gains `createdAt`; `FlowPr.createdAt: string | null` (in `types.ts` as `createdAt?`).
  - `reviewRows(text): ReviewRow[]` (`{ lens: string | null, severity: 'blocker' | 'major' | 'minor', text: string, status: 'fixed' | 'not-doing' | 'open' }`) in `play.js`: the rows of the latest round's findings table, the words from the column named Finding, Issue, Summary or Description, the lens through `lensType`; Status fixed or resolved is `fixed`; a row marked dropped, false positive, won't fix, not doing or deferred is `not-doing`; else `open`.
  - `prRows(prs, lane): PrRow[]`, always three: `{ n: 1 | 2 | 3, number: number | null, title: string | null, url: string | null, state: 'not-started' | 'open' | 'draft' | 'merged' | 'closed', review: 'waiting' | 'approved' | 'changes' | null, checks: 'passed' | 'running' | 'failed' | null, openedAt: string | null, updatedAt: string | null }`. status.json's entry overlaid with the flow lane's `pr1` and `pr2`. From `FlowPr`: `review` `approved` → `approved`, `changes_requested` → `changes`, `review_required` or null on an open pull request → `waiting`, anything on one not open → null; `checks` `passing` → `passed`, `pending` → `running`, `failing` → `failed`, null → null; `openedAt` from `createdAt` (null when the flow map has not read it).
  - `commitsWithFiles(dir, { base, head, limit = 100 })` in `git.js`: `commits()` rows plus `files: { path, added, removed, isNew }[]` from one `git log --numstat --summary`. `read.commits` answers with it.
  - `page.plan?: { version: string | null, steps: PlanStepRow[] } | null`: set whenever the plan has steps, at Plan too (then every state is `next`). The commits are read with `commits()` (one `git log`, `parseLog`'s `step`) only for a job at Build or later; before Build `stepStates` gets `[]`. `page.review?: { at: string | null, rows: ReviewRow[] } | null`, `page.prs?: PrRow[]`.
  - `StageView.plan?` (plan and build), `StageView.prs?` (ship), copied from `job.page`; `StageView.review?: { at, reviewers: { lens: string | null, name: string, model: string | null, rows: ReviewRow[] }[] }` (review): one entry per reviewer that ran at the step (name from `REVIEWERS`, model from its agent row), with its rows, and a last entry `Other findings` for rows with no lens.

- [ ] **Step 1: Failing tests**
  - `planSteps reads the S headings in order`; `a plan with no S headings has no steps` (Review Focus 1).
  - `stepStates: a step with a commit is done, the first without one is being built, the rest are not yet`: steps S1 to S4, commits `[{ step: 'S1' }, { step: 'S2' }, { step: null }]` (what `parseLog` gives for `[S1] the form`, `S2: the list` and `Fix a typo`), building → `done, done, now, next`; not building → `done, done, next, next`.
  - `a job at Plan has its plan’s steps, all next, and reads no commits`.
  - `play.test.js` → `reviewRows gives each finding with its lens and whether it was fixed`: a table with Severity, Lens, Finding, Status → rows with `status` `fixed`, `not-doing`, `open`; `a later round replaces the first`.
  - `prRows: PR #1 open and waiting for a review, the other two not started`: PR #1 `{ state: 'open', review: 'waiting', checks: 'running', openedAt: '2026-11-10T09:00:00.000Z' }`. `prRows maps the flow map’s review and checks words`: `changes_requested` → `changes`, `passing` → `passed`, `failing` → `failed`.
  - `flow.test.js` → `a pull request carries when it was opened`.
  - `git-commits.test.js` (a temp repo made with `git init`) → `each commit lists its files with lines added and removed, and says which are new`.
  - `stage-view.test.js` → `Plan and Build carry the plan’s steps, Ship the three pull requests`; `Review lists every reviewer that ran, one with no findings included`.
- [ ] **Step 2:** Run the five files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, `npm test -w hosted`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): plan steps, commit files, findings and pull request rows`.

### Task 5a: Recording progress by line, on the card and the lane (design 3.5)

**Files:**
- Modify: `dashboard/lib/evidence.js` (`playwrightConfig`, `prepareRun`, `recordEvidence`), `dashboard/runner/evidence.js` (`runPlaywright`, `recordNow`, `view`), `dashboard/runner/index.js` (`boardCard`), `dashboard/lib/snapshot.js` (`laneFor`), `dashboard/test/fixtures/evidence/fake-playwright.mjs`, `web/src/api/types.ts`
- Test: `dashboard/test/evidence.test.js`, `dashboard/test/evidence-server.test.js`, `dashboard/test/lanes.test.js`

**Interfaces:**
- Produces:
  - `progressReporter(): string`: the source of a Playwright reporter (written to `run/progress.mjs`, added to the config's `reporter` list) that prints one line per test start and end: `@@starbase {"at":"begin"|"end","id":"AC-4","title":"…","status":"passed"|"failed"|"skipped","video":"<path>"|null}`. `parseProgressLine(line): object | null`.
  - `recordEvidence({ …, onProgress })`; `run({ configFile, cwd, specs, onLine })` (today's `run({ configFile, cwd, specs })` with `onLine` added; `cwd` stays).
  - `EvidenceProgress = { commit: string, startedAt: string, line: number, of: number, lines: { id, title, state: 'waiting' | 'running' | 'passed' | 'failed' | 'skipped', video: string | null, at: string | null }[] }`; `line` is the running line's place, else the last finished one's; a line's `at` is when its state last changed. In this task every `video` is null (Task 5b fills it).
  - The door (`runner.local.evidence`): `view(slug).progress?: EvidenceProgress | null`; `progressWords(slug): string | null` (`Recording evidence: line 4 of 19`). The progress is set when the run starts, changed on each line, and removed in a `finally` when the run ends for any reason. Each change emits `evidence` with `outcome: 'progress'`, and the `finally` emits once more with `progress: null`.
  - `boardCard(...).testing: string | null`; `laneFor`: a card with `testing`, no waiting card and no gate is `{ lane: 'working', laneReason: card.testing }`. `Job.testing?: string | null`.
  - The fake Playwright prints the same `@@starbase` lines, and with `STARBASE_FAKE_HOLD=<file>` waits after the first line's `begin` until that file exists.

- [ ] **Step 1: Failing tests**
  - `evidence.test.js` → `the config names the progress reporter`; `parseProgressLine reads a line and ignores everything else`; `the run keeps its working folder`: the fake `run` is called with `cwd` set.
  - `evidence-server.test.js` → `while it records, the view says which line of how many and each line’s state`: with the hold, `progress.line === 1`, `progress.of === 3`, states `running, waiting, waiting`. `when the recording ends the progress is gone`: one last `evidence` event with `progress: null`. `when the recording dies the progress is gone and the problem is said` (Review Focus 3): the fake exits 1 part way → `progress === null`, `problem.message` set, the snapshot's card has `testing: null`.
  - `lanes.test.js` → `a job being recorded is working and its reason is the line number`; `a waiting gate wins over the recording`.
- [ ] **Step 2:** Run the three files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, `npm test -w hosted`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(evidence): recording progress by line on the card and the lane`.

### Task 5b: Each line's video at once, on the laptop and the website (design 3.5)

**Files:**
- Modify: `dashboard/lib/evidence.js` (`recordEvidence`), `dashboard/runner/evidence.js` (`uploadEvidence`), `dashboard/runner/mirror.js` (`evidenceFiles`), `hosted/site/routes-files.js` (`named`), `dashboard/test/fixtures/evidence/fake-playwright.mjs`
- Test: `dashboard/test/evidence-server.test.js`, `dashboard/test/site-link.test.js`, `hosted/test/full-mirror.test.js`

**Interfaces:**
- Consumes: `EvidenceProgress`, `onProgress` and the hold (Task 5a).
- Produces:
  - On an `end` line the recorder copies that line's video to `evidence/<commit>/AC-<n>/video.webm` at once (the place it has at the end), and sets that line's `video`.
  - The three file lists (`uploadEvidence`, `evidenceFiles`, `named`) also name `progress.lines[].video`.

- [ ] **Step 1: Failing tests**
  - `evidence-server.test.js` → `a line’s video is there as soon as the line ends`: after release and before the run's end event, `progress.lines[0].video` is served by the file route.
  - `site-link.test.js` → `a progress event sends the job’s evidence part again with the finished line’s video named, and the board with the card’s testing line`.
  - `full-mirror.test.js` → `the website accepts an upload for a video the progress names`.
- [ ] **Step 2:** Run the three files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, `npm test -w hosted`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(evidence): each line's video as soon as the line ends`.

### Task 5c: The Tester's check counts and the hand test (design 3.5)

**Files:**
- Modify: `dashboard/lib/job-page.js`, `dashboard/lib/stage-view.js`, `dashboard/runner/index.js` (the `try-it` command's `start`; `page`), `web/src/api/types.ts`
- Test: `dashboard/test/job-page.test.js`, `dashboard/test/job-page-server.test.js`

**Interfaces:**
- Produces:
  - `checkCounts(reportText): { passed: number, failed: number, notRun: number } | null`: one count per `AC-<n>` named in `test-report.md` with PASS, FAIL or NOT RUN (its last mention wins); null with none. `page.checks?: { passed, failed, notRun, at } | null` (`at`: the report's time).
  - `page.handTest?: { startedAt: string | null }`: the session record's `tryStartedAt`, set when Try it's app is started from the page (the `try-it` command's `start`), never by the recorder.
  - `StageView.checks?`, `StageView.handTest?` on the test step.

- [ ] **Step 1: Failing tests**
  - `job-page.test.js` → `checkCounts counts each acceptance line once`: `AC-1 PASS`, `AC-2 FAIL`, `AC-2 PASS`, `AC-3 NOT RUN` → `{ passed: 2, failed: 0, notRun: 1 }`; `a report with no marks is null`.
  - `job-page-server.test.js` → `starting Try it from the page marks the hand test started; the recorder starting the app does not`.
- [ ] **Step 2:** Run the two files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, `npm test -w hosted`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): the Tester's check counts and the hand test`.

### Task 6: Watch: the hidden browser's picture (design 3.5)

**Files:**
- Modify: `dashboard/lib/evidence.js` (`guardModule`, `prepareRun`), `dashboard/runner/evidence.js` (the door), `dashboard/site/routes-evidence.js`, `hosted/site/routes-files.js`, `dashboard/test/fixtures/evidence/fake-playwright.mjs`, `web/src/api/types.ts`
- Test: `dashboard/test/evidence.test.js`, `dashboard/test/evidence-server.test.js`, `hosted/test/full-mirror.test.js`

**Interfaces:**
- Produces:
  - `guardModule(playwrightUrl, { liveFile, watchFile })`: Starbase's own wrapper of `page` (the Tester's specs are not changed). Every 500 ms, while `watchFile` was touched under 5 s ago, it saves `page.screenshot({ type: 'jpeg', quality: 60 })` to `liveFile` (written beside it, then renamed). A failed save is skipped. The timer stops when the test ends. `prepareRun` passes `run/live.jpg` and `run/watching`.
  - The door: `live(slug): Promise<{ abs, type: 'image/jpeg', size }>`: touches the watch file, and answers the frame when one was saved in the last 5 s of a running recording; else `HttpError(404, 'No live picture right now.')`.
  - `GET /api/job/:slug/evidence/live` (laptop): the JPEG with `Cache-Control: no-store`. On the website: 404 `The live picture shows on your laptop.`
  - `EvidenceView.watch?: boolean`: true on the laptop while a recording runs; the website's answer has `watch: false`.
  - The fake Playwright saves a frame the same way while the watch file is fresh.

- [ ] **Step 1: Failing tests**
  - `evidence.test.js` → `the guard saves frames only while someone watches`: the module's text names both files and imports only Playwright and `node:fs`.
  - `evidence-server.test.js` → `the live route answers the newest frame while a recording is watched, and 404 after it ends`: with the hold (Task 5a), the first GET is 404 and marks it watched, a later GET is 200 `image/jpeg`; after the run 404. `nobody watching, no frame is written`.
  - `full-mirror.test.js` → `the website has no live picture and says where it is`.
- [ ] **Step 2:** Run the files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, `npm test -w hosted`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(evidence): the live picture of a recording, on the laptop`.

### Task 6b: A step he wrote to is his at once, on the board too (the owner's requirement; the rule in Global Constraints)

What is already built and stays (read it first): `youWroteWhileWaiting` and `YOURS_NOW` in `dashboard/runner/auto.js` (`attend` stops Auto with `you wrote to this job while this step waited, so it is yours to decide.` and sends nothing), `youSpokeSince` (an Approver answer he wrote during is dropped), `carryOnIfYouDecided` (his Go or Send back clears the stop), and `laneFor`'s `Auto stopped: …` lane. Their tests in `auto-server.test.js` (K4/I5, N2, N6, I5 runner, H2) and `lanes.test.js` (`lanes: Auto stopped: …`) stay as they are. This task adds only what is missing: the stop is written in `attend`, so it waits for the Foreman's reply to him to end and then for any other Auto job's Approver call earlier in the same pass; meanwhile `laneFor` says `Auto is deciding: …` and the bar shows `AUTO_DECIDING_NOTE`.

**Files:**
- Modify: `dashboard/lib/auto.js`, `dashboard/runner/auto.js` (`triage`, `youWroteWhileWaiting`), `dashboard/runner/index.js` (`boardCards`), `dashboard/lib/snapshot.js` (`laneFor`), `web/src/api/types.ts` (`JobAuto.yours?`)
- Test: `dashboard/test/auto.test.js`, `dashboard/test/auto-server.test.js`, `dashboard/test/lanes.test.js`

**Interfaces:**
- Produces:
  - `wroteWhileWaiting(lines, { briefAt, since }): boolean` in `dashboard/lib/auto.js`: today's rule from `youWroteWhileWaiting`, moved and made pure (a `send` not by Auto whose kind is not one of Starbase's own, `OWN_SENDS`, which moves with it; or a `steer`; later than both the brief's time and `auto.since`). `youWroteWhileWaiting(job)` calls it.
  - `triage(job)`: after the fixed stops and before it returns the gate, a job `wroteWhileWaiting` says is his clears `held` and `refused` for it and stops with `YOURS_NOW`, so the stop is written in the pass's first loop, before any job's Approver is asked. The same check in `attend` stays (it covers a message sent while the Approver thinks).
  - `boardCards`: a card whose `auto` is on and not stopped, with a gate waiting, gets `auto.yours: true` when `wroteWhileWaiting(await state.auditFor(f.dir, Infinity), { briefAt: f.currentBrief?.at, since: f.auto.since })`; every other card `yours: false`.
  - `laneFor`: an Auto card with `auto.yours` and something waiting is `{ lane: 'needs-you', laneReason: 'Auto stopped: you wrote to this job while this step waited, so it is yours to decide.' }`, the same words the stop writes a moment later, never `Auto is deciding`.

- [ ] **Step 1: Failing tests**
  - `auto.test.js` → `wroteWhileWaiting: a message of his after the brief is his; one before the brief or before Auto was switched on is not; Starbase's own sends are not; a steer is`.
  - `auto-server.test.js` → `I5: with two Auto jobs waiting, his message to the second stops it in the pass's first round, before the first job's Approver answers` (the first job's `ask` waits on a promise the test releases only after checking the second job's record says `YOURS_NOW`).
  - `auto-server.test.js` → `the board says a step he wrote to is his before Auto's next pass`: an Auto job at a gate, his `reply` written and its run ended, no pass yet → the snapshot's card has `auto.yours === true` and lane `needs-you`.
  - `lanes.test.js` → `an Auto job whose waiting step he wrote to needs him and does not say Auto is deciding`: `card({ needsYou: true, waitingFor: 'approval', stage: 'plan', auto: { on: true, ran: true, stopped: null, yours: true, deciding: false, allowed: true, why: null } })` → `{ lane: 'needs-you', laneReason: 'Auto stopped: you wrote to this job while this step waited, so it is yours to decide.' }`.
- [ ] **Step 2:** Run `node --test dashboard/test/auto.test.js dashboard/test/auto-server.test.js dashboard/test/lanes.test.js`; the new tests fail, the existing ones pass.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`, `npm test -w hosted`, `npm run web:build`.
- [ ] **Step 5:** Commit `fix(auto): a step he wrote to is his at once, on the board too`.

### Task 7: The bar: who is working, testing, Auto, and what was sent (design 3.3; the owner's requirement)

**Files:**
- Create: `web/src/job/NextStep.tsx` (moved from `web/src/job/JobPage.tsx`: `NextStep`, `GoBar`, `StateBar`, `useAfterSend`, `STOP_ACTION`, `ticketOf` and what they use), `web/src/job/NextStep.test.tsx`
- Modify: `web/src/job/JobPage.tsx` (imports and re-exports them), `web/src/panes/Foreman/gateSent.ts`, `web/src/job/sentView.ts` (the sent lines; shared with the Desk), `web/src/home/DeskView.tsx`, `web/src/job/JobPage.test.tsx`, `web/src/home/DeskOne.test.tsx`

**Interfaces:**
- Read first: the review fixes put Auto's line on the bar (`autoLaneReason`, `autoDeciding`, `AUTO_DECIDING_NOTE` in `web/src/job/autoLine.ts`, used by `GoBar`) and touch the sent state (`useAfterSend`, `useGateSent`; `GoBar` already takes `sent: SentShown | null` and `run`). The sent lines live in `web/src/job/sentView.ts` (`SENT_WORDS`, `STUCK_WORDS`, `SENT_MORE`, `stateLines`, `sentView`, `useSentView`, `useWaitingLines`), which `DeskView.tsx` also uses; once the Foreman's run starts, the second line comes from `GateSent.accepted` (`AcceptedDecision`) through `sentView`. Keep what is there; this task moves the bar and adds what is missing below. The rule that Auto leaves a step he wrote to is the server's (Task 6b and what it builds on); this task adds no `auto.test.js` test.
- Consumes: `Job.nowDoing[].model`, `Job.testing`, `JobDetail.page.checks` (Tasks 3, 5a, 5c), `Job.auto.yours` (Task 6b), `useGateSent`, `GateSlot`, `pressReply`, `autoLine.ts`.
- Produces:
  - `NextStep({ job, conversation, now, onShip, onWatch, foldCard })`; `onWatch?: () => void`.
  - `workingWords(job, now): { say: string, sub: string } | null`; `sentLine(kind, { answers, next, step, auto }): string` in `sentView.ts`; `SENT_WORDS`, `STUCK_WORDS` unchanged.
  - `AcceptedDecision` and `LastSent` (`gateSent.ts`) gain `answers: number` (the count of `body.answers`) and `next: string | null` (the next step's label, from the gate's `nextProposed` at the click). `send(api, body, gate, { next }: { next?: string | null } = {})` keeps them. `sentView` and `stateLines` build the second line with `sentLine(a.kind, { answers, next, step, auto })`; with neither known (the page was reloaded, so nothing was kept) they use the line with no count and no next step. The Desk shows the same lines.
  - `useSentShown(job, conversation): { kind: GateKind | null } | null`: non-null exactly while the bar shows a sent line (the same rule the bar uses: `useSentView` plus the send's own state), with the kind sent when known. `NewJobPage` calls it once and passes it to `JobTop`, `StepsRow` and `PhoneJob` (Tasks 9, 11, 15a, 16).
- Words:
  - Crew working: say `The Builder is building step 3 of 6: the Pause dialog` (`The {role} is {doing}` when the line starts with an -ing word, else `The {role}: {doing}`, the line's first letter lowered). Sub `Builder on Sonnet 5.5, 12 min on this step. The Foreman waits for it. Nothing for you to do until the tests.` The ending is `until the tests` at Build and `right now` at every other step. The Foreman itself: `Foreman on Opus 5.5, 12 min on this step. Nothing for you to do right now.` No model known: leave out ` on {model}`. No button. The greyed approve button and "Nothing to do right now" go.
  - Several crew at once (not drawn): the first entry of `nowDoing` gives the say, as above; the sub names them all, `4 reviewers on this step: Spec, Errors, Tests and Screens, 12 min. The Foreman waits for them. Nothing for you to do right now.` (`{n} {role, plural} on this step: {names}, {time}` when they share a role, else `{n} crew on this step: {names}, {time}`; the time is the longest one's).
  - Recording: say `job.testing` (`Recording evidence: line 4 of 19`). Sub `Starbase plays each acceptance line in a hidden browser.`, then ` The Tester’s checks passed, 46 of 46.` when `page.checks` has no failure. Button `Watch` (laptop only, when `onWatch`).
  - Auto stopped at a step that waits: the stop tone, say the Auto line (`Auto stopped: the plan adds a database change`), sub `Answer it yourself and Auto carries on from there.`, the same three calls.
  - Auto deciding at a step that waits: the usual bar and calls, with `AUTO_DECIDING_NOTE` under it (not drawn; the review fixes' words).
  - A step he wrote to on an Auto job: the server's lane is `Auto stopped: you wrote to this job while this step waited, so it is yours to decide.` (Task 6b and the stop it builds on), so the bar has the stop look with that sentence and the same three calls, and never `AUTO_DECIDING_NOTE`.
  - A permission card waiting: the permission alert in the bar's place, as today. A stopped job with no gate (a status card): Reply only, as today.
  - A pull request in review: say `PR #1 is open. Waiting on a review`, sub `Nothing for you to do. We’ll tell you if it gets comments.`, button `See the pull requests`.
  - Sent: `Sent. Waiting for the Foreman to start.` then, for Go, `Your go and your two answers reached the Foreman. Review starts next.` (no answers: `Your go reached the Foreman. …`; counts in words up to nine; on an Auto job add ` Auto carries on from Review.`); for Reply, `Your reply reached the Foreman. Nothing is approved, so the card stays open.`; for Send back, `Sent back: the Foreman stays at Test and revises. Nothing is approved.` The 30-second "Nothing has moved yet." with `Try again` is unchanged.

- [ ] **Step 1: Failing tests** in `NextStep.test.tsx` (the `setup` of `JobPage.test.tsx`, rendering `NextStep`):
  - `while the crew works the bar names who and what, with no button`: `nowDoing: [{ who: 'feature-implementer', name: 'Builder', doing: 'Building step 3 of 6: the Pause dialog', model: 'Sonnet 5.5', since: 12 min ago }]` at `implement` → the two sentences above; `within(bar).queryByRole('button')` is null.
  - `a line that is not an -ing phrase follows a colon`: `doing: 'Step 3 of 6'` → `The Builder: step 3 of 6`.
  - `while evidence records the bar says so and offers Watch on the laptop only`.
  - `on an Auto job the bar has Send back, Reply and Go, all enabled, at every step that waits` (the owner's requirement): for each of the seven steps' gate stages, and for Auto on, deciding (`laneReason: 'Auto is deciding: the plan'`), stopped, and his (`auto.yours`) → three enabled buttons each time.
  - `an Auto job that stopped has the stop look and its reason as the bar’s sentence`.
  - `Send back on an Auto job opens What should change? and posts the changes`: the post body has `kind: 'changes'` and the note.
  - `a step you wrote to on an Auto job has the stop look, the three calls and never says Auto is deciding`: `auto: { on: true, stopped: { reason: 'you wrote to this job while this step waited, so it is yours to decide.' }, yours: true }`, lane `needs-you`, `laneReason: 'Auto stopped: you wrote to this job while this step waited, so it is yours to decide.'`, a gate open → three enabled calls, that sentence on the bar, no `AUTO_DECIDING_NOTE`.
  - `a waiting permission card takes the bar’s place, and the three calls come back once it is answered`.
  - `several crew at once are named in one line`: four reviewers at Review → `4 reviewers on this step: Spec, Errors, Tests and Screens, 12 min. …`.
  - `after Go the second line names the answers and the next step`; `after Reply the card stays open`; `after Send back the Foreman stays at the step`.
  - `after the Foreman’s run starts the second line still names the answers and the next step` (the send's state clears; `accepted` keeps them).
  - `after a reload the second line has no count and no next step`.
  - `useSentShown is the kind sent while the bar shows Sent, and null once the bar shows the next step`.
  - `on the website a waiting Auto job has Send back, Reply and Go on the bar, and a queued decision replaces them` (the hosted client).
  - `sentLine` table: one answer, nine, ten (`10 answers`), none, no next step.
  - `DeskOne.test.tsx`: the assertions that quote today's second lines (`SENT_MORE`) take the new ones, and `the Desk’s card says the same sent lines as the bar`.
- [ ] **Step 2:** Run `npx vitest run src/job/NextStep.test.tsx src/home/DeskOne.test.tsx`; the new tests fail.
- [ ] **Step 3:** Move the bar, then implement the words. In `JobPage.test.tsx` replace `with nothing waiting, says what is happening in words, with the stop’s call greyed` by the first test above, and change the assertions that quote the old second lines to the new ones.
- [ ] **Step 4:** Run `npm run web:test`, `npm test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): the bar names who is working and what was sent`.

### Task 8: The approval card: questions first, evidence in one line (design 3.3)

**Files:**
- Modify: `web/src/panes/Foreman/GateCard.tsx`, `web/src/panes/Foreman/EvidenceStrip.tsx`, `dashboard/lib/decisions.js`, `dashboard/lib/auto-log.js` (`autoLog`, `autoLogRecord`, `capAutoLog`), `dashboard/runner/mirror.js` (`autoLogRecord`, the website's copy), `dashboard/runner/index.js` (`jobDetail().auto`; the `auto` read that calls `autoLogRecord`), `web/src/api/types.ts`
- Test: `web/src/panes/Foreman/GateCard.test.tsx`, `web/src/panes/Foreman/EvidenceStrip.test.tsx`, `web/src/job/NextStep.test.tsx` (made in Task 7), `dashboard/test/auto-server.test.js`, `dashboard/test/auto-log.test.js`, `dashboard/test/mirror-shape.test.js`

**Interfaces:**
- Read first: the review fixes change the Reply and Send back boxes in `GateCard.tsx`. Keep their behaviour; this task sets the order and the words below.
- Consumes: `EvidenceView.progress` (Task 5a), `decisionRows` and `orbitCopy` (`decisions.js`), the job's Auto audit lines (`what: 'on'`, `'gate'`, `'question'`, `'permission'`, `'stop'`).
- Produces:
  - The card's order: the Reply or Send back box when open (directly under the bar), the head (`Brief 5 · Test` and how long ago), questions, why Approve is off, the calls row (only where the page does not draw them), the screens row, Try it, the evidence, decisions made for you, Auto's decisions, Adjust the next step, How this works. The Desk's card gets the same order.
  - Questions are numbered (`1. …`). The recommended answer is picked, as today, and the picked answer shows `Picked` beside `Recommended`. The last choice reads `Your own answer` (today `Other…`) and opens its box.
  - `EvidenceStrip({ slug, tested, refresh, fold })`; `fold?: boolean` (the card passes true): a closed fold whose line is `Evidence: 17 passed, 2 failed` (`, 3 not recorded` when some are) with `recorded 40 min ago for commit c3e8a51` and `Show` or `Hide`; `Evidence: recording, line 4 of 19` while it records; `Evidence: not recorded yet` with none. The rows, `Copy link` and `Record again` are inside.
  - `autoLines(rows): string[]` in `decisions.js`: for each row of `decisionRows` with `by: 'auto'` that `orbitCopy` keeps (an answered question, a send back, a level Auto changed), the line `orbitCopy` writes for it, without its number and its mark. Auto's routine go-aheads are left out, as `orbitCopy` leaves them out, so the card's count matches what Copy decisions marks `(Auto)`; every go-ahead is in What Auto decided (Task 9). `JobDetail.auto.decided?: string[]`: those lines, oldest first, for a job Auto ran on.
  - What Auto decided's facts (`AutoDecided` in `types.ts`, built by `autoLogRecord`): `startedAt?: string | null` (the time of the job's first Auto `on` line with `by: 'tag'`, else null) and `ticket?: string | null` (the job's ticket key, passed in by the caller); each entry gains `kind?: 'approve' | 'answer' | 'allow' | 'stop'` (a `gate` line `approve`, a `question` line `answer`, a `permission` line `allow`, a `stop` line `stop`) and `stop?: StopId | null` (from the line's `stage` through `STAGE_STOP`). Auto's `stop` lines join `entries` with `kind: 'stop'` (their `reason` as `chose`); the first summary line still counts only the decisions (gate, question and permission lines). `capAutoLog` and the mirror's `autoLogRecord` keep the new fields.
- Words: Send back's box `What should change? The Foreman stays at this step and revises; nothing is approved.`, placeholder `Say what should change…`, buttons `Cancel` and `Send back`. Reply's box `Your answers or a note for the Foreman. Nothing is approved.`, placeholder `Write your answers or a note…`, `Cancel`, `Send the reply`. `2 decisions made for you` with `Review` or `Hide`, `Override`, and `Going ahead confirms the ones you don’t override.` On a job Auto ran on: `2 decisions made by Auto on this job so far` (`1 decision made…`) with `Review` or `Hide`; open, each line followed by ` (Auto)`.

- [ ] **Step 1: Failing tests**
  - `the questions come before the evidence, the decisions and the extras` (document order inside the card).
  - `the recommended answer is picked and says Picked; the last choice reads Your own answer`.
  - `the evidence is one line with its counts until it is opened`; `while it records the line says the line number`.
  - `Send back’s box opens at the top of the card, asks What should change? and its button says Send back`; `Reply’s box says nothing is approved`.
  - `a card on a job Auto ran on says how many decisions Auto made and lists them, each marked (Auto)`.
  - `what you typed in a box is still there after the job is fetched again` (Review Focus 2): type in Send back's box, render again with a new `detail` object for the same brief → the text and the open box remain.
  - `auto-server.test.js` → `the job answer lists what Auto decided, in the Copy decisions words`; `Auto’s routine go-aheads are not in that list`.
  - `auto-log.test.js` → `a job a tag started says when and on which ticket; one you started has no start time`; `each entry says its kind and its step, and a stop is an entry that the count leaves out`. `mirror-shape.test.js` → `the website’s Auto list keeps the start time, the ticket and each entry’s kind and step`.
  - `on the website the card has the same order and words` (the hosted client).
  - `GateCard.test.tsx` → `words typed in What should change? keep Go off and say so`: Go's reason is `CHANGES_TYPED`, now `You wrote what should change. Send it back or cancel it first.`
- [ ] **Step 2:** Run the five files; fail.
- [ ] **Step 3:** Implement. `CHANGES_TYPED` (`GateCard.tsx`, today `You wrote what should change. Send the changes or cancel them first.`) becomes `You wrote what should change. Send it back or cancel it first.` Update the Desk's, the old page's and `NextStep.test.tsx`'s tests that quote `Other…`, `Send the changes`, `CHANGES_TYPED` or `Approving confirms…`.
- [ ] **Step 4:** Run `npm run web:test`, `npm test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(gate): questions first, evidence folded to one line`.

### Task 9: The header (brief requirements 24 to 31; notes 1, 5, 9)

**Files:**
- Create: `web/src/job/page/JobTop.tsx`, `web/src/job/page/JobTop.test.tsx`, `web/src/job/page/page.css`
- Modify: `web/src/job/WhatAutoDecided.tsx`, `web/src/job/WhatAutoDecided.test.tsx`, `web/src/job/auto.css`, `web/src/job/AutoSwitch.tsx`, `web/src/job/AutoSwitch.test.tsx`, `web/src/job/CopyDecisions.tsx`, `web/src/job/CopyDecisions.test.tsx`, `web/src/panes/Preview/DecisionsTab.tsx`, `web/src/panes/Preview/DecisionsTab.test.tsx`, `web/src/components/page/Page.tsx` (export `useGuide` and `Guide`; nothing else)

**Interfaces:**
- Read first: the review fixes put `AutoSwitch`, `WhatAutoDecided` and the Foreman model line (`modelLabel`) on `JobPage`. `JobTop` takes the same three. `AutoSwitch` already writes, under the switch, `Auto is on`, `Auto stopped: …` and `Started by Auto (tag: x)` (its live region); this task adds two props and changes nothing else in how it works.
- Consumes: `AutoSwitch({ job })`, `AUTO_HINT`, `AUTO_L3`, `JobMenu` (imported from `panes/Foreman/JobHeader.tsx` as `JobPage.tsx` does; it takes `run` for its reply checks), `LevelChip`, `PartOfStack`, `CopyDecisions`, `DecisionsTab({ slug, active })` (`web/src/panes/Preview/DecisionsTab.tsx`, which draws its own `CopyDecisions` button today), `Sheet` (`components/Sheet.tsx`), `AutoDecided.startedAt`, `.ticket`, entries' `kind` and `stop` (Task 8), `useSentShown`'s result (Task 7), `ticketOf`, `stateChip`, `jobFacts`, `whereLine`, `useGuide(id)` and `Guide({ spec, onClose })` (`How it works` keeps its title, "The three things to know about this page.").
- Produces:
  - `JobTop({ job, detail, run, sent }: { job: Job; detail: JobDetail | null; run: Run | null; sent: { kind: GateKind | null } | null })`, root class `sb-job-top`; `run` goes to `JobMenu`.
  - `headerState(job, permissions, sent: { kind: GateKind | null } | null): { word: string; tone: ChipTone; icon: IconName }`: `Sent` while `sent` is not null (whatever was sent); `Needs you` in the needs-you lane; else today's `stateChip` word.
  - `AutoSwitch({ job, word, tagLine })`: `word?: boolean` draws `On` or `Off` beside the switch (as drawn); `tagLine?: boolean` (default true) leaves out `Started by Auto (tag: x)` when false. `JobTop` passes `word` and `tagLine={false}`: the header's own chip says it. `Auto is on` and `Auto stopped: …` stay under the switch.
  - `DecisionsTab({ slug, active, copy })`: `copy?: boolean` (default true); false leaves out its own `Copy decisions` button.
  - `foremanModel(detail, models): string | null`: the label `JobPage.tsx` works out as `modelLabel` (the fixed model once the job has a session), moved here.
  - `NEW_JOB_GUIDE: GuideSpec`, id `job-page-2`, title `How the job page works`, done `Got it`, cards (not drawn): `Your next move is at the top` / `The bar says what the job waits for. Send back, Reply and Go are there whenever it waits for you.`; `Seven steps, each opens in place` / `Click a step to see who worked on it, what they are doing now and what it produced.`; `The conversation stays beside you` / `The whole history with the Foreman, newest at the bottom. Widen it when you want to read.`
- Layout and words, as drawn:
  - Row one: the title and the state chip; at the right the switch `Auto: run to PR #1 without asking me.` with the word `On` or `Off` (title: `AUTO_HINT`), the gear (`Job menu`), `How it works`.
  - Row two: the ticket chip (a link to Orbit when `page.ticket.url`), `Copy decisions`, the chip `Started by Auto · tag {tag}` (title `Settings, Workflow, Auto start`) on a job a tag started (one source: `job.auto.by === 'tag'`, the tag from `detail.auto.tag`; with no tag known, `Started by Auto`), then kind, the level chip, the repository and the where line, then `Foreman model: Opus 5.5` with a lock (title `Fixed once the job starts. Change model… in the gear menu starts it again.`); at the right, under the switch, `What Auto decided`.
- What Auto decided: today's `Sheet` with `className="sb-drawer"`, which `auto.css` places at the right, 480 px wide, on a laptop; on a phone it is the sheet as it is. The three summary lines stay at the top. Each entry: the time, the step as a chip (from the entry's `stop`), `Asked:`, `Chose:` (a chip: the stop look when `kind === 'stop'`, the done look otherwise), `Why:`. Foot, for a job a tag started with `startedAt` and `ticket` known: `Started by Auto on Nov 10 at 9:14 am: ORBIT-907 carries the tag auto. The same decisions show in Copy decisions, marked (Auto).` (from `startedAt`, `ticket` and `tag`); else only the second sentence.
- Copy decisions panel: under the list it copies, a fold `Everything decided on this job` holding today's full list, drawn by `DecisionsTab` with `copy={false}` so no second `Copy decisions` button opens a second sheet.

- [ ] **Step 1: Failing tests**
  - `the header holds the title, the state in a word, the ticket, Copy decisions, the Auto switch, the gear and How it works`.
  - `a job Auto started says Started by Auto with the tag once, in the chip; one you started says nothing`: `getAllByText(/Started by Auto/)` has length 1.
  - `the switch says On or Off beside it`.
  - `the Foreman model shows as words with a lock, and not before the job has started`.
  - `after a decision is sent the state reads Sent`: `sent: { kind: 'message' }` → `Sent`; `sent: null` on a waiting job → `Needs you`.
  - `the gear’s reply checks get the job’s run` (`JobMenu` receives `run`).
  - `What Auto decided shows only once Auto has decided something`.
  - `an L3 job: the switch is off and says why`.
  - `on the website there is no gear, and the switch queues its change` (the hosted client of `AutoSwitch.test.tsx`).
  - `WhatAutoDecided.test.tsx` → `each entry says when, which step, what was asked, what it chose and why`; `a stop entry’s Chose chip has the stop look`; `a job a tag started says so at the foot`; `with no start time the foot has only the second sentence`.
  - `AutoSwitch.test.tsx` → `with tagLine off the switch leaves the tag line to the header`.
  - `CopyDecisions.test.tsx` → `the full list of decisions is one fold under what it copies, with one Copy decisions button`. `DecisionsTab.test.tsx` → `copy={false} leaves out its Copy decisions button`.
- [ ] **Step 2:** Run `npx vitest run src/job src/panes/Preview/DecisionsTab.test.tsx`; the new tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run web:test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): the header with the Auto switch`.

### Task 10: The overview card (design 3.1)

**Files:**
- Create: `web/src/job/page/OverviewCard.tsx`, `web/src/job/page/WhatToCheck.tsx`, `web/src/job/page/OverviewCard.test.tsx`

**Interfaces:**
- Consumes: `JobDetail.page` (Task 1), `Fold` (`components/page/Page.tsx`).
- Produces: `OverviewCard({ job, detail }: { job: Job; detail: JobDetail | null })`; `WhatToCheck({ check }: { check: JobPageFacts['check'] })` (also used beside Try it, Task 13).
- Layout and words: `Fold` with `id="job-overview"`, name `Overview`, note `ORBIT-900 as written, what we’re building, what to check` (no ticket: `What we’re building, what to check`), folded the first time. Three columns, one under another when narrow:
  - `The ticket`: the title; `ORBIT-900 · filed by Dana Whitfield on Nov 3` (no filer: `ORBIT-900 · filed on Nov 3`; neither: `ORBIT-900`); the description as plain paragraphs, never as HTML; the link `Open ORBIT-900 in Orbit`. No ticket: `This job did not start from an Orbit ticket.`
  - `What we’re building`: `From spec v{version}` or `From the first brief`; the version as the summary carries it (a summary `spec.v0.3.json` reads `From spec v0.3`, a version `3` reads `From spec v3`; no version: `From the spec`, not drawn); the outcome lines; `Risks` and its list. None: `Not written yet. The Foreman writes this with its first brief.`
  - `What to check`: `It works when` and `It must not`, each a list. None: `Not written yet. The Foreman writes this list with the plan.`

- [ ] **Step 1: Failing tests**
  - `folded the first time, with the ticket number in its line; open it and it stays open for the next job`.
  - `the ticket as written: title, who filed it and when, the description, a link`.
  - `what we’re building comes from the spec summary, or the first brief’s before there is a spec`: a spec summary with version `0.3` reads `From spec v0.3`.
  - `what to check lists It works when and It must not`.
  - `an old job: no filer, no check list, no summary, and the card is still whole` (Review Focus 1): the "Not written yet" lines and the "filed" variants above.
  - `a description with a tag in it shows as text`.
  - `the website shows the same card` (the hosted client).
- [ ] **Step 2:** Run `npx vitest run src/job/page/OverviewCard.test.tsx`; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run web:test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): the overview card`.

### Task 11: The steps row and the open step (design 3.2)

**Files:**
- Create: `web/src/job/page/StepsRow.tsx`, `stepWords.ts`, `useStage.ts`, `StepPanel.tsx`, `StepDocs.tsx`, with `StepsRow.test.tsx`, `stepWords.test.ts`, `StepPanel.test.tsx` (all in `web/src/job/page/`)
- Modify: `web/src/panes/Preview/DocsTab.tsx` (export `DocReader` and `DocItem`), `web/src/job/StagePage.tsx` (uses `useStage`)
- If the task reviewer asks for a split: StepsRow and stepWords first, then StepPanel, useStage and StepDocs, as two commits of this one task.

**Interfaces:**
- Consumes: `STOPS`, `stopStates`, `StageView` with `time?`, `docs?`, `since`, `agents[].feed?` (Tasks 2, 3), `JobDetail.page.times`, `useSentShown`'s result (Task 7), `StageStrip` and the stop faces (Play full), `POST /api/job/<slug>/stage/<stop>/terminal`.
- Produces:
  - `spentWords(ms: number): string` (`under a minute`, `32 min`, `1 h 10 min`, `2 d 3 h`); `stepState(job, stop, sent: { kind: GateKind | null } | null): { cls: 'is-done' | 'is-now' | 'is-wait' | 'is-stop' | '', words: string }` with the words `Done`, `Working now`, `Waiting for you`, `Not yet`, `Skipped`, `Approved` (the job's step only while `sent?.kind === 'approve'`: after Reply, Send back or an unknown kind the step keeps its own words), `In review` (Ship with a pull request open); `stepTimeWords(job, stop, time, now): string | null` (`1 h 10 min`, `32 min so far`, `for 1 h 5 min` from `waitingSince`, `PR #1 open`, nothing for a step not reached). A step with no `time` (an older laptop, a job started in a terminal) uses `StageView.since` for its start when it has one, else no time.
  - `StepsRow({ job, times, open, sent, now, onOpen }: { …; open: StopId; sent: { kind: GateKind | null } | null; onOpen(stop: StopId): void })`: a tab list labelled `The job’s seven steps`; each step a tab titled `Open {name} here` with its icon at 36 px (the crew face in Play full), its name, its state words and its time; classes `sb-steps`, `sb-step`, `is-open`.
  - `useStage(slug, stop): { view: StageView | null; error: string | null; reload(): void }`: the step page's loader moved here (the last answer shows at once), asking again every 5 s while the step is working or waiting, else every 30 s, and at once whenever `job.updatedAt` changes (as `StagePage`'s loader does today).
  - `StepPanel({ job, stop, view, error, onRetry, now, extraAgents, children })`:
    - Head: icon, name, state chip, time, `Step 4 of 7`.
    - `Who worked on it` (`Who will work on it` for a step not reached): initials, role, model chip, what it does, time, status chip (`Working`, `Done`, `Waiting for you`, `Not started`, and on the Foreman's row `Waiting for the Builder` while a crew member works, `Waiting for the evidence` while Starbase records, `Waiting on the review` with a pull request open). On the laptop: `Open in terminal` or `Watch in terminal`, `Open the job’s folder in a terminal` and the terminal picker, as today. `extraAgents?: StageAgent[]` are rows the step's body adds (Task 13).
    - `Live: what they’re doing` (`What they did last` when nobody works): one block per crew member with its name, model, `Live` or `Finished`, and its feed lines (`now` or how long ago, and the words).
    - `children` (the step's own body), then `Documents from this step`.
  - `StepDocs({ slug, docs, request }: { slug: string; docs: JobDocEntry[]; request?: { n: number; file: string | null } })`: rows (name, version chip, when); a click opens that document in place in `DocReader` with Back to the list; a new `request` opens its file. No documents: `No documents from this step yet.`
- Not-yet lines: Test `Not yet. The Tester starts when the build is done. These three run then:`; Review `Not yet. Four reviewers look at the change after the tests: spec, errors, tests and screens.`; Ship `Not yet. PR #1 opens after the review, with its own go-ahead. PR #2 and PR #3 follow, each with yours.`; the others `Not yet.` Loading, first visit: `Loading who worked on it…` in the list's place; failed: `Couldn’t load this step: {message}` with `Try again`.

- [ ] **Step 1: Failing tests**
  - `stepWords.test.ts` → `spentWords` table (59 s, 32 min, 70 min, 51 h); `the current step says so far, a waiting one says for how long, a done one how long it took`; `after your go the step reads Approved until the job moves`; `after Send back the step does not read Approved` (and the same after Reply); `a step with no time falls back to since, and with neither says nothing`.
  - `StepPanel.test.tsx` (also) → `the step asks again when the job changes`; `a stage view with no time, no documents and no feed still draws the panel`.
  - `StepsRow.test.tsx` → `seven steps, each with its name, its state in words and how long`; `the open one is marked and a click asks for another`; `Play full shows the crew’s faces`.
  - `StepPanel.test.tsx` → `who worked on it, each with a model and a status in words`; `the Foreman’s row says who it waits for while a crew member works`; `the feed lists each working crew member’s last actions, and says What they did last when nobody works`; `the feed asks again every 5 seconds while the step works` (fake timers); `a document opens in place and Back returns to the list`; `a step not reached says so`; `a step that can’t load says why and offers Try again, and the rest of the panel stays`; `on the website there is no terminal button`.
- [ ] **Step 2:** Run `npx vitest run src/job/page`; fail.
- [ ] **Step 3:** Implement. `StagePage.test.tsx` stays green on the moved loader.
- [ ] **Step 4:** Run `npm run web:test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): the steps row and the open step`.

### Task 12: Spec, Plan, Build, Review and Ship in the open step (design 3.2)

**Files:**
- Create: `web/src/job/page/SpecStep.tsx`, `BuildStep.tsx` (also exports `PlanSteps`), `CommitChanges.tsx` (the commit's changes, moved out of `web/src/job/CodeTab.tsx`), `ReviewStep.tsx`, `ShipStep.tsx`, with `StepBodies.test.tsx`
- Modify: `web/src/job/CodeTab.tsx` (imports `CommitChanges` in place of its own copy; the old page's Code tab tests stay green)

**Interfaces:**
- Consumes: `StageView.plan`, `.review`, `.prs` (`PrRow.review`, `.checks`, `.openedAt`), the commits list with `files` (Task 4); `AutoDecided.entries[].kind` and `.stop` (Task 8: the per-step Auto lines read the entries whose `stop` is this step, fetched as `WhatAutoDecided` fetches them, only on a job whose `job.auto.ran`); `ScreensTab`, `screensHref`, `WalkthroughTab`, `ReviewPanel`, `JobGithub`, `GithubLine`.
- Produces: `SpecStep({ slug, job })`, `PlanSteps({ plan, states }: { plan: StageView['plan']; states: boolean })`, `BuildStep({ slug, job, view })`, `CommitChanges({ slug, sha })`, `ReviewStep({ slug, job, view })`, `ShipStep({ slug, job, view })`.
- Words:
  - Spec, a job with screens: `Screens · v2`, the hint `Click through it like the real thing. Right-click (or press and hold) anywhere to pin a note. Decisions are on the Info tab.`, the prototype in the page (`ScreensTab`) and today's `Review the screens` button. Website: `The Screens page opens on your laptop.`
  - Plan: `The plan’s steps · Plan v1`, the steps numbered, no states (`PlanSteps` with `states: false`).
  - Build: `The plan’s steps · Plan v2`, each step `Done`, `Building now` or `Not yet`; no steps: `This plan has no numbered steps. The commits below show the work.` (not drawn). Then `Commits so far · 2 on feature/orbit-900-pause-service`: the short id, the subject, when; under it each file with `New` or `Changed`, its path and `+22 −4`. A commit's row opens its changes under its files, as today's Code tab does (`CommitChanges`). No commits: today's note. Website: `The commits show on your laptop.`
  - Review: `The reviewers and what they found`: each reviewer (`Spec reviewer`, `Errors reviewer`…) with its model and `2 findings` (`1 finding`, `0 findings`), each finding with `Fixed`, `Not doing` or `Open`; none: `No findings.` Then the `Review walkthrough` fold when the job has one.
  - Ship: `The pull requests`: `PR #1 · {title}` with `From your fork into the team’s feature branch`, `PR #2 · Into staging`, `PR #3 · Into main`. Chips, from `state` and `review`: `Open, waiting for a review` (`waiting` or null), `Open, approved`, `Open, changes asked for` (`changes`), `Draft`, `Merged`, `Closed`, `Not started`. Under an open one: `Checks passed`, `Checks running` or `Checks failed` (from `checks`; none when null), then `· opened 20 min ago` (from `openedAt`; left out when null), and `Open on GitHub`. Not started: PR #2 `After PR #1 is merged, with its own go-ahead`, PR #3 `After staging is checked`. Then today's review panel, nudges and GitHub line.
  - On an Auto job, a line at the top of the step, from the entries for that step: an `answer` entry and an `approve` entry: Spec `Auto answered this step’s question and approved spec v1. What Auto decided has the reasons.`; an `approve` entry alone: `Auto approved this step. What Auto decided has the reasons.` (not drawn); a `stop` entry, the newest for the job: `Auto stopped here: {reason}`; Ship: `Auto stops once PR #1 is open. It never merges.` No entries for the step: no line.

- [ ] **Step 1: Failing tests** in `StepBodies.test.tsx`
  - `Spec shows the job’s prototype in the page with its hint; the website says where it opens`.
  - `Plan lists the plan’s steps with no states`.
  - `Build lists the plan’s steps with the one being built now`; `a plan with no numbered steps says so and still lists the commits` (Review Focus 1).
  - `each commit lists its files, new or changed, with lines added and removed; opening it shows the change with its + and − kept` (the old Code tab test, moved).
  - `on the website Build shows the plan’s steps and says the commits are on the laptop`.
  - `Review lists each reviewer with its findings, each Fixed, Not doing or Open; a reviewer with none says No findings`; `the review walkthrough folds under Review only when there is one`.
  - `Ship lists three pull requests with where each goes and its state in words`: PR #1 `{ state: 'open', review: 'changes', checks: 'running', openedAt: 20 min ago }` → `Open, changes asked for`, `Checks running · opened 20 min ago`; `the review panel and the nudges are still under them`.
  - `an Auto job says what Auto did at a step`: entries `answer` and `approve` with `stop: 'spec'` → the Spec line; a `stop` entry with `stop: 'plan'` → `Auto stopped here: …` on Plan only.
- [ ] **Step 2:** Run `npx vitest run src/job/page/StepBodies.test.tsx`; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run web:test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): Spec, Plan, Build, Review and Ship in the open step`.

### Task 13: The Test step: three kinds of test, Watch, Try it (design 3.5)

**Files:**
- Create: `web/src/job/page/TestStep.tsx`, `useEvidence.ts`, `WatchPicture.tsx`, `TestStep.test.tsx`

**Interfaces:**
- Consumes: `StageView.checks`, `.handTest` (Task 5c), the Tester's `command` (Task 3); `EvidenceView.progress` with each line's `video` and `.watch`, `GET /api/job/<slug>/evidence/live` (Tasks 5a, 5b, 6); `EvidenceStrip`, `TryTab({ slug, active })`, `WhatToCheck`, `StepPanel`'s `extraAgents`.
- Produces:
  - `useEvidence(slug): { view: EvidenceView | null; reload(): void }`: asks every 3 s while `view.recording`, as `EvidenceStrip` does, else every 30 s.
  - `recorderAgent(progress): StageAgent | null`: Starbase's own row while it records: role `Starbase`, `recorder` where the model goes, doing `Recording evidence: line 4 of 19`, status working, feed `Line 4: {title}` for the running line and `Line 3 passed: {title}` or `Line 3 failed: {title}` for the last three finished; `terminal: { kind: 'watch', ready: false, why: 'Starbase records this itself.' }`, `ref: 'recorder'`. `StepPanel` draws no terminal button on a row whose `ref` is `recorder`.
  - `TestStep({ slug, job, detail, view, evidence, watching, onWatching, tryOpen, onTryOpen })`; `WatchPicture({ slug, progress })`.
- Layout and words: `Three kinds of test`, three rows, each with a state chip, `Where` and `When`:
  - `Checks`, `run by the Tester`. Where `Commands in the job’s folder`. Chip `Passed, 46 of 46`, `Failed, 2 of 46`, `Running` or `Not started`. When `After the build`, `Running now` (not drawn), `Finished 18 min ago, took 6 min` (the Tester's time, left out when unknown). While the Tester works: its command and the last lines of its output (website: the command and `Its output shows on your laptop.`). The link `The command and the end of its output` opens `test-report.md` in the reader.
  - `Recorded evidence`, `by Starbase`. Where `The job’s app on its own address, in a hidden browser` (the drawn address `localhost:3013` is left out: no answer carries it). Chip `Running, line 4 of 19`, `17 passed, 2 failed`, `Not started`, or `Not for this job` (title: the view's `why`). When `After the checks`, `Started 2 min ago` (from `progress.startedAt`), `Finished 40 min ago` (the evidence's recorded time; the drawn `, took 9 min` is left out: nothing keeps the start once the run ends). While it runs on the laptop: `Watch` or `Stop watching` with `The hidden browser, live, in this page.`; the picture, captioned `Line 4 of 19: {title}. The picture updates about twice a second.`; the list of lines, each `Passed`, `Failed`, `Running` or `Waiting`, with `Play video` (`Video` on a phone) once it has one, the waiting ones after the first as one row `11 more waiting`. The link `Each line and its video` opens the evidence strip below. Website: no Watch; the same list and videos.
  - `Your hand test`, `by you`. Where `Try it on your computer`. Chip `Not started` (When `When you like` before Test, `Not yet` at Test), `Started` (When `Started 5 min ago`), or `Skipped by you` (When `You went ahead without it`: never started and the job is past Test). The button `Open Try it` or `Close Try it` with `Run the branch on your computer, with what to check beside it.`; open, Try it with the `What to check` box at its right (under it on a phone). On an Auto job that is on and has not stopped, in place of When: `Auto skips your hand test on this job. The recorded evidence still runs.` (the card's words, `GateCard.tsx`). Once Auto stopped (or is off), the usual When and `Open Try it`, as the card does since the review fixes. Website: `Try it runs on your laptop. Open the job there to use it.` and no button.
  - `WatchPicture` loads the next frame 500 ms after the last one arrived or failed. After 5 s with none: `No picture right now. The recording may be between lines.` (not drawn).

- [ ] **Step 1: Failing tests**
  - `Test names three things, each with a state, a place and a time`.
  - `the checks row counts what passed, and while the Tester works shows its command and the end of its output`; `on the website the output stays on the laptop`.
  - `while it records, the row says the line and lists each line’s state; waiting lines fold to a count; Starbase’s recorder is a row and a feed, with no terminal button`.
  - `a finished line plays its video while the rest still record`.
  - `Watch shows the picture and asks for a new frame about twice a second; Stop watching ends the requests` (fake timers: 4 requests in 2 s, none after).
  - `with no frame for 5 seconds it says so and keeps asking`.
  - `the website has no Watch`.
  - `a recording that could not finish shows the problem and Record again, and no line number` (Review Focus 3).
  - `Open Try it shows Try it with What to check beside it`; `a job past Test whose hand test never started says Skipped by you`; `an Auto job that is on says the hand test is skipped`; `a stopped Auto job offers Open Try it`.
- [ ] **Step 2:** Run `npx vitest run src/job/page/TestStep.test.tsx`; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run web:test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): the Test step with Watch and Try it`.

### Task 14: The conversation panel (design 3.4)

**Files:**
- Create: `web/src/job/page/ConversationPanel.tsx`, `ConversationPanel.test.tsx`
- Modify: `web/src/panes/Foreman/Composer.tsx`, `web/src/panes/Foreman/Composer.test.tsx`, `web/src/panes/Foreman/ForemanPane.tsx` (the shared `ThreadList` only: one optional prop; the `ForemanPane` component in that file is not touched)

**Interfaces:**
- Consumes: `ThreadList({ job, conversation, now, cards })` with `cards={false}` (as `JobPage.tsx` passes it today: permission cards stay on the bar, not in the conversation) and no `newest`, `useJobConversation`, `Composer`, `shownItems`, `foremanModel` (Task 9).
- Produces:
  - `ThreadList` gains `newFrom?: string | null`: a line `2 new` above the first shown message newer than that time that is not yours.
  - `ConversationPanel({ job, conversation, now, wide, onWide, full }: { …; wide: boolean; onWide(on: boolean): void; full?: boolean })`, root class `sb-convo`, the list's scroll area `sb-convo-list`: head `Conversation · 9 messages` and `Widen` or `Back to the job`; the line `The whole conversation, newest at the bottom`; the list; the composer at the foot. `full` is the phone's and the narrow window's whole-screen form: head `12 messages · 2 new`, and `newFrom` set to your last look. The panel draws only the conversation; what sits above it in the full form (the bar while the job waits for you) is the page's (Task 15b).
  - `newCount(items: ThreadItem[], seenAt: string | null): number`: items newer than `seenAt` that are not yours. The panel writes `sb.convo.seen.<slug>` (the newest item's time) while it is on screen.
  - The panel owns its scroll area: it opens at its end and stays there as messages arrive unless you are more than 96 px above the end; `Load older` keeps the first message in view where it was.
  - `Composer({ slug, detail, run, modelLine })`: the box grows with its text from 3 to 8 lines, then scrolls, everywhere it is used; `modelLine?: string | null` shows `Foreman model: Opus 5.5` with a lock under the box. Placeholder `Write to the Foreman…`; `Send…` off with nothing written says `Write something first.`

- [ ] **Step 1: Failing tests**
  - `the whole conversation shows, with no Earlier fold, and its head counts the messages`; `a waiting permission card is not drawn in the conversation`.
  - `it opens at the newest message`; `a new message keeps you at the end, but not while you read higher up`; `Load older keeps the message you were reading where it was` (Review Focus 4; set `scrollHeight`, `scrollTop` and `clientHeight` by hand as `scrollAreas.test.ts` does).
  - `Widen asks for the full page and its word becomes Back to the job`.
  - `newCount counts only messages after your last look, never your own`; `looking at the conversation clears the count`; `the full form draws the new line above the first new message`.
  - `Composer.test.tsx` → `the message box grows to eight lines and then scrolls`; `the Foreman model shows under the box with a lock when given`.
  - `on the website a reply the laptop keeps reads as its note` (the mirror's line shows as it is).
- [ ] **Step 2:** Run `npx vitest run src/job/page/ConversationPanel.test.tsx src/panes/Foreman/Composer.test.tsx`; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run web:test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): the full-height conversation`.

### Task 15a: The page on a laptop: the router, the open step and the layout (notes 1 to 3; brief requirement 7)

**Files:**
- Create: `web/src/job/page/openStep.ts`, `openStep.test.ts`, `NewJobPage.tsx`, `NewJobPage.test.tsx`
- Modify: `web/src/app/router.ts`, `web/src/app/router.test.ts`, `web/src/job/page/page.css`

**Interfaces:**
- Consumes: `JobTop`, `NextStep`, `useSentShown`, `OverviewCard`, `StepsRow`, `StepPanel`, `useStage`, the step bodies, `ConversationPanel` (Tasks 7 to 14); `useJobConversation`, `useCurrentJob`, `useGateSent`, `StackSuggestion`, `useMinWidth`, `useRoute`, `stageHref`.
- Produces:
  - Router: `Route` `{ name: 'job'; slug: string; view?: 'conversation' | 'overview' }`; `jobViewHref(slug, view): string` (`#/job/<slug>/conversation`, `#/job/<slug>/overview`); `replaceHash(href: string): void` (`history.replaceState`: no new history entry, and no `hashchange`, so `useRoute` does not see it). `#/job/<slug>/stage/<stop>` parses as today.
  - `pickOpenStep({ picked, address, live, last, current }: Record<string, StopId | null>): StopId`: the first of them that is set, else `'spec'`. `picked` is this page's own pick. `live` is the job's step while it is working or waiting. `last` is `sb.job.step.<slug>`, written on each pick.
  - `NewJobPage({ slug, step, view }: { slug: string; step?: StopId; view?: 'conversation' | 'overview' })`, not routed yet. It keeps the pick in its own state, `picked`, which wins over everything. Picking a step sets `picked`, writes `sb.job.step.<slug>` and calls `replaceHash(stageHref(slug, stop))`, which only rewrites the address. A later change of the `step` prop (a `hashchange` to another step's address: a link, Back) sets `picked` to it. It calls `useSentShown(job, conversation)` once and passes the result to `JobTop` and `StepsRow`.
  - Laptop layout: `main.page.page-job` labelled `Job`; `JobTop` above two scroll areas: the work column (stack suggestion, `OverviewCard`, `NextStep`, `StepsRow`, the open `StepPanel` with its step's body) and, from 1100 px, the conversation column, 400 px (`ConversationPanel`). `NextStep` and `ConversationPanel` each stay in one place in the React tree in every layout (this one, Widen, the narrow window's full-screen conversation, Task 15b): a layout only hides or shows parts with classes and `hidden`, so neither remounts and typed words, the open box and the scroll stay.

- [ ] **Step 1: Failing tests**
  - `openStep.test.ts` → `your pick wins, then the address’s step, then the step the job is at, then the one you last opened`.
  - `router.test.ts` → `a job’s conversation and overview have their own addresses`; `a step’s address is unchanged`; `replaceHash changes the address with no new history entry and no hashchange`.
  - `NewJobPage.test.tsx` (the `setup` of `JobPage.test.tsx` with `NewJobPage`):
    - `the page is the header, the overview, the bar, seven steps with one open, and the conversation`.
    - `it opens the step the job is working at; picking another puts it in the address and it stays when the job moves on` (Review Focus 2): pick Spec, dispatch a snapshot with the job at Test → Spec is still open and `location.hash` ends `/stage/spec`.
    - `a pick is not undone by the address prop it wrote`: pick Spec while the `step` prop is still `test` → Spec stays open.
    - `with no pick the open step follows the job`.
    - `the step page’s address opens the job page on that step`; `a hashchange to another step’s address opens that step`.
    - `what you typed in What should change? is still there after the open step’s feed refreshes and after you pick another step` (Review Focus 2).
    - `words in the message box survive picking a step and the job moving on` (Review Focus 2).
    - `whichever step is open, a job that waits for you has Send back, Reply and Go on the bar, on an Auto job too` (the owner's requirement): open each of the seven steps in turn on a waiting Auto job, for Auto on, deciding and stopped.
    - `after Go the header reads Sent and the step reads Approved; after Send back the step keeps its own words` (`useSentShown` passed down).
- [ ] **Step 2:** Run `npx vitest run src/job/page src/app/router.test.ts`; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run web:test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): the new page on a laptop, with the open step`.

### Task 15b: The page's requests, keys, Widen, narrow windows, errors and the old page's tests (notes 1 to 3, 14)

**Files:**
- Modify: `web/src/job/page/NewJobPage.tsx`, `web/src/job/page/NewJobPage.test.tsx`, `web/src/job/page/page.css`

**Interfaces:**
- Consumes: `NewJobPage` and its `picked` rule (Task 15a); `page.docs` (Task 2: which step owns a file), `ConversationPanel({ wide, onWide, full })`, `newCount` (Task 14), `NextStep`'s `foldCard`, `onShip`, `onWatch` (Task 7), `TestStep`'s `watching` and `tryOpen` (Task 13), `StepDocs`'s `request` (Task 11); `useNarrow`, `useMinWidth`, `useKeyScope` (key ids `stage-prev`, `stage-next`, scope `stage`, as registered today), `ui.tryRequest`, `ui.docsRequest`, `ui.docsFile`.
- Produces:
  - Keys: `[` and `]` (`stage-prev`, `stage-next`) pick the step before and after, as a click does.
  - Requests: `onShip` picks Ship; `onWatch` picks Test with the picture on; a Try it request picks Test with Try it open; a document request picks the step that owns the file (by `page.docs`; a file no step owns opens under the open step) and hands it to `StepDocs`. `view === 'overview'` opens the overview.
  - Wide (`view === 'conversation'`, or `Widen`): the conversation takes the body, 760 px at most, and the work column is hidden. While the job waits for you the bar stays above it, with its card folded to one row (`NextStep` with `foldCard`). `Back to the job` returns to the two columns.
  - Under 1100 px the conversation column is replaced by one button fixed at the bottom, `Conversation` with `2 new`, which opens the panel full screen (`ConversationPanel` with `full`). While the job waits for you, the full-screen conversation keeps the bar and its three calls above it, with the card folded to one row.
  - A job that is not there: today's sentences (`There’s no job called “x”…`, `Starting the job…`). While the job's details load the header shows from the snapshot and the overview says `Loading the overview…`; if they fail: `Couldn’t load this job’s details.` with `Try again`, and the bar, the steps and the conversation still show.
  - A job record from an older laptop (the website before the laptop is rebuilt: no `page`, no step `time`, `docs` or `feed`, no `progress`): every area shows its "Not written yet" or empty line and the rest of the page is whole.

- [ ] **Step 1: Failing tests** in `NewJobPage.test.tsx`
  - `[ and ] move the open step`.
  - `See the pull requests opens Ship; Watch opens Test with the picture on; Try it from the gear opens Test with Try it open`.
  - `a link to a document opens it under the step that owns it`.
  - `with the conversation widened, a job that waits for you still has the three calls`.
  - `typing in What should change?, then Widen and Back to the job, keeps the words and the open box` (Review Focus 2).
  - `under 1100 px the conversation is one button with the count of new messages, and it opens full screen` (Review Focus 5; `matchMedia` stubbed).
  - `under 1100 px the full-screen conversation keeps the three calls` (the owner's requirement): a waiting Auto job, the panel open full screen → `No go: send back`, `Reply` and `Go: …` enabled above it, the card folded.
  - `the job’s details failing leaves the bar, the steps and the conversation in place`.
  - `on the website the same page shows, with a queued decision in place of the calls` (the hosted client and a `queued` detail).
  - `on the website a waiting Auto job has Send back, Reply and Go, all enabled` (the hosted client, no queued decision; the owner's requirement).
  - `a job record from an older laptop (no page, no step times, no feed) shows a whole page with the "Not written yet" lines` (Review Focus 1; the hosted client and a detail with no `page`, stage views with no `time`, `docs` or `feed`).
  - The blocks `the go / no go bar`, `after a click on the go / no go bar`, `Auto on the job page` and `the permission alert` of `JobPage.test.tsx`, copied with `NewJobPage` in place of `JobPage`. Where a test checks a place the new page does not have (`.job-details`, the page head through `head()`, the tabs; for example "the locked model line in Details"), point it at the new place (`.sb-job-top` for the head and the model line, the composer for the model under the box). Keep every behaviour check as it is. All pass.
- [ ] **Step 2:** Run `npx vitest run src/job/page`; the new tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run web:test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): the new page's requests, Widen, narrow windows and errors`.

### Task 16: The phone layout (design 3.4; note 12)

**Files:**
- Create: `web/src/job/page/PhoneJob.tsx`, `PhoneJob.test.tsx`
- Modify: `web/src/job/page/NewJobPage.tsx` (narrow: `PhoneJob`, with the `sent` it already works out), `web/src/job/page/page.css`

**Interfaces:**
- Consumes: the parts of Tasks 7 to 14; `useSentShown`'s result (Task 7, from `NewJobPage`, Task 15a); `navigate`, `jobHref`, `stageHref`, `jobViewHref`.
- Produces: `PhoneJob({ job, conversation, now, step, view, sent }: { …; sent: { kind: GateKind | null } | null })` (the job's details from `conversation.thread.detail`), four screens chosen by the address:
  - The job (`#/job/<slug>`): a back row to Jobs and the gear; the title; the state chip (`headerState` with `sent`) and the ticket; `Started by Auto · tag auto`; the bar, then `No go: send back` and `Reply` side by side and `Go: …` full width under them; the card; `Steps`, seven rows (icon, name, `Done · 1 h 10 min`, from `stepState` with `sent`), each to its step's screen; the rows `Overview`, `Copy decisions` (`The product decisions, ready for an Orbit comment`) and, once Auto has decided, `What Auto decided` (`Newest first`; the drawn count is left out, it would need the list fetched first); the Auto switch as a row; `Conversation` fixed at the bottom with `2 new`.
  - A step (`…/stage/<stop>`): back to the job by its title, the step's name, state chip and time, then the same body as on a laptop, one column. The screen of the step that waits for you carries the bar and its three calls first, with the card folded to one row (not drawn; the owner's requirement).
  - The conversation (`…/conversation`): `ConversationPanel` with `full`.
  - The overview (`…/overview`): the overview's three parts, one under another, open.
  - Each row navigates (a new history entry), so Back returns to the job.

- [ ] **Step 1: Failing tests** (`matchMedia` stubbed narrow)
  - `the phone page leads with the bar and the card, then the steps, then Overview, Copy decisions and the Auto switch`.
  - `Send back and Reply sit side by side with Go under them, all three enabled on an Auto job that is on, deciding or stopped` (the owner's requirement): one render for each of Auto on, deciding (`laneReason: 'Auto is deciding: the plan'`) and stopped, each with a gate waiting → three enabled calls.
  - `a step row opens that step’s own screen, and Back returns to the job`.
  - `the screen of the step that waits has Send back, Reply and Go; another step’s screen does not` (owner to confirm): for a job with Auto off and for a waiting Auto job that is on.
  - `Conversation is fixed at the bottom, says how many are new, and opens full screen`.
  - `Overview opens the ticket, what we’re building and what to check`.
  - `What Auto decided is a row only once Auto has decided`, its note `Newest first`.
  - `on the website the phone page has no gear and Try it says where it runs`.
  - `on the website the phone page has Send back, Reply and Go on a waiting Auto job` (the hosted client; the owner's requirement).
- [ ] **Step 2:** Run `npx vitest run src/job/page/PhoneJob.test.tsx`; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm run web:test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job-page): the phone layout`.

### Task 17: Switch the route, and the browser checks on the new screens

**Files:**
- Modify: `web/src/app/App.tsx` (where the `job` and `stage` routes render `JobPage` and `StagePage`), `web/src/views/Hosted/HostedWorkshop.tsx` (the same two routes), `web/e2e/noEmptyScroll.mjs`, `web/e2e/noJump.mjs`, `dashboard/demo/run-demo.js`, `dashboard/runner/evidence.js` (demo only)
- Also modify: `web/e2e/autoRun.mjs` (it finds the Auto switch and `What Auto decided` under `main .page-head`; the new header is `.sb-job-top`)
- Test: `web/src/app/App.test.tsx`, `web/src/views/Hosted/Mirror.test.tsx`, `dashboard/test/demo-foreman.test.js`

**Interfaces:**
- Consumes: `NewJobPage` (Tasks 15a, 15b, 16); `YOURS_NOW` and the stop it writes (Task 6b and what it builds on).
- Produces:
  - `job` renders `<NewJobPage key={route.slug} slug view />` and `stage` renders `<NewJobPage key={route.slug} slug step />`, on the laptop (`App.tsx`, where `stage` is keyed `${slug}/${stop}` today) and on the website (`HostedWorkshop.tsx`): the same key on both routes, so going from a job's address to one of its steps' addresses, or between steps, never remounts the page.
  - Demo: `bulk-archive` (at Build) gets a ticket with an invented filer and date, `acceptance.md`, a plan with `### S1` to `### S6` and commits `[S1]` to `[S3]`; `nightly-export` (at Test) gets `evidence/demo-progress.json` (line 4 of 19) and `evidence/demo-live.jpg`. In demo mode only, the evidence door's `view` reads that progress file and `live` serves that picture. `auto-demo` is unchanged: it still runs to PR #1 with no click (`demo-foreman.test.js` and `autoRun.mjs` check that). The Auto jobs that wait for him are `auto-demo-migrate` (Auto stopped at its plan for a database change, as today) and a new `auto-yours` in `autoJobs()` (`run-demo.js`): Auto on at its quick-plan gate like the other two, with an audit line of his own (`action: 'send'`, `kind: 'message'`, in the demo's `state/audit.jsonl` as `playSecrets` writes its lines, dated after both its brief file and its Auto `since`), so Auto's first pass leaves the step to him (`Auto stopped: you wrote to this job while this step waited, so it is yours to decide.`). Not a held Approver: Auto asks the Approver one job at a time, so one that never answers would hold `auto-demo` back from PR #1 too.
  - `autoRun.mjs`: the switch and `What Auto decided` are found under `main .sb-job-top`.
  - `noEmptyScroll.mjs`: the step page screen becomes `#/job/<first job>/stage/<stop>` for each of the seven steps, plus `#/job/nightly-export/stage/test`, `…/conversation` and `…/overview`; the level menu is found inside `.sb-job-top`; the conversation check (check 4) measures `.sb-convo-list` and skips its 160 px rule when `.sb-convo-list` is not shown (under 1100 px it is behind the `Conversation` button); every fold it opens includes the overview, the evidence fold, Try it and `Watch`.
  - `noJump.mjs`: `SCREENS` gains `#/job/bulk-archive` and `#/job/nightly-export/stage/test`; `LANDMARKS` gains `.sb-steps`, `.sb-job-top` and `.sb-convo`; picking a step is a toggle whose rule is: the header, the overview, the bar, the steps row and the conversation column stay where they were.

- [ ] **Step 1: Failing tests**
  - `App.test.tsx` → `a job’s address shows the new page`; `a step’s address shows the job page on that step`; `typing in What should change? then picking another step keeps the words` (Review Focus 2: the route key); `going from the job’s address to a step’s address keeps the words` (a `hashchange`).
  - `Mirror.test.tsx` → `the website’s job page is the new page`; `the website’s step address keeps the page mounted` (the same key).
  - `demo-foreman.test.js` → `the demo has a job with an overview and plan steps, one with a recording under way, and an Auto job he wrote to that waits for him with its sentence`; the existing `the demo's Auto job reaches PR #1 with the stand-in Approver` stays as it is and passes.
- [ ] **Step 2:** Run them; fail.
- [ ] **Step 3:** Implement the switch and the demo data, then the three scripts.
- [ ] **Step 4:** Run `npm test`, `npm run web:test`, `npm test -w hosted`, `npm run web:build`. Then, with the demo in one terminal (`PORT=4493 STARBASE_DEMO=1 node dashboard/demo/run-demo.js`): `WIDTHS=1280,1512,1920 node web/e2e/noEmptyScroll.mjs` and `WIDTHS=1280,1512,1920 node web/e2e/noJump.mjs` both exit 0; `WIDTHS=800,1024,390 node web/e2e/noEmptyScroll.mjs` exits 0 (Review Focus 5 near its low end and in the middle, and the phone); `node web/e2e/autoRun.mjs` exits 0 (as Part 2 runs it). In the demo, open `#/job/auto-yours` and `#/job/auto-demo-migrate` and see `No go: send back`, `Reply` and `Go: …` on the bar, each enabled.
- [ ] **Step 5:** Commit `feat(job-page): the new job page is the job page`.

### Task 18: Remove the old page and the step page

**Files:**
- Delete: `web/src/job/JobPage.tsx`, `web/src/job/JobPage.test.tsx`, `web/src/job/StagePage.tsx`, `web/src/job/StagePage.test.tsx`, `web/src/job/CodeTab.tsx`
- Rename: `web/src/job/page/NewJobPage.tsx` to `JobPage.tsx` (the component to `JobPage`, `NEW_JOB_GUIDE` to `JOB_GUIDE`), its test with it
- Modify: `web/src/app/keyRegistry.ts` (remove `stage-finished`; `notes` and `write` lose "on a stop" from their `where`; `stage-prev` and `stage-next` read `The step before this one`, `The step after this one`), `web/src/job/job.css` (rules only the removed files used), every file that imported from the deleted ones

**Interfaces:**
- Consumes: `NextStep.tsx` exports (`NextStep`, `STOP_ACTION`, `ticketOf`), `stepWords.ts` (`spentWords` in place of `forHowLong`).
- Produces: nothing new. `grep -rn "StagePage\|CodeTab\|JOB_TABS\|tabForStop\|STAGE_GUIDE\|NewJobPage" web/src` prints nothing. `JobHeader` and `ForemanPane` are left as they are.

- [ ] **Step 1:** In `web/src/app/keyRegistry.test.ts` add `n is Notes and options on every job screen, and no key is listed for a screen that is gone`; it fails.
- [ ] **Step 2:** Move any test of the deleted files that has no twin yet to the file that now owns the behaviour (the table "Nothing existing is lost" is the check). Delete the files, rename, fix the imports and the keys.
- [ ] **Step 3:** Run `npm run web:test`, `npm run web:build`, `npm test`, `npm test -w hosted`, and the browser checks as in Task 17 Step 4.
- [ ] **Step 4:** Walk the design's "Done when" in the demo at `#/job/bulk-archive` and `#/job/nightly-export` and write what you saw in the task report: the ticket and What to check read without leaving the page; Build shows its plan steps and commits; the whole conversation reads; a recording shows its lines and the picture; on `#/job/auto-yours` and `#/job/auto-demo-migrate` Send back, Reply and Go are on the bar, each enabled, at 1512 px, at 1024 px with the conversation open full screen, and at 390 px.
- [ ] **Step 5:** Commit `refactor(job-page): remove the old job page and the step page`.

---

## Self-Review

1. **Spec coverage.** 3.1: Tasks 1, 10, 13. 3.2: Tasks 2, 3, 4, 11, 12, 15a, 15b. 3.3: Tasks 7, 8. 3.4: Tasks 14, 15a, 15b, 16. 3.5: Tasks 5a, 5b, 5c, 6, 13. The brief's requirements 24 to 31: Tasks 7, 8, 9, 14 (Copy decisions and Change model exist and keep their place). Requirement 32 and "Done when": Task 18 Step 4. The owner's requirement: the bar on every waiting step in Tasks 7, 15a, 15b and 16 (Auto on, deciding, stopped and his; every open step; Widen; the full-screen conversation; the website; the phone), seen in the demo in Tasks 17 and 18. The rule that Auto leaves a step he wrote to: built on the branch (`auto-server.test.js` K4/I5, N2, N6, H2), and Task 6b makes the board say so at once.
2. **Step scan.** Every test step names its tests and what they assert; code steps give signatures and exact words, no bodies.
3. **Type consistency.** `JobDetail.page` (Tasks 1, 2, 4, 5c) is read in Tasks 7, 10, 11, 13, 15b. The stage view's new fields (Tasks 2 to 5c) are read in Tasks 11 to 13. `EvidenceView.progress` (Tasks 5a, 5b) and `.watch` (Task 6) are read in Tasks 8 and 13; `Job.testing` (Task 5a) in Task 7; `Job.auto.yours` (Task 6b) in Task 7; `auto.decided` is a list of lines everywhere; `AutoDecided.startedAt`, `.ticket` and entries' `kind` and `stop` (Task 8) in Tasks 9 and 12; `PrRow.review`, `.checks`, `.openedAt` (Task 4) in Task 12; `useSentShown` (Task 7) once in `NewJobPage` (Task 15a), its result as `sent` in `JobTop` (Task 9), `StepsRow` and `stepState` (Task 11) and `PhoneJob` (Task 16); `foremanModel` (Task 9) is used in Tasks 14 and 15a; `NewJobPage` (Tasks 15a, 15b) in Tasks 16 to 18. Every new field in `types.ts` is optional.
4. **Review Focus.** 1 in Tasks 1, 4, 10, 12, 15b; 2 in Tasks 8, 15a, 15b, 17; 3 in Tasks 5a, 13; 4 in Task 14; 5 in Tasks 15b, 17.
5. **Proportion.** The length is the prototype's exact words and the tests by name, over twenty-two tasks (1 to 18, with 5a to 5c, 6b, 15a and 15b); there are no function bodies.
