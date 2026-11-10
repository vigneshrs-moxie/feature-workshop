# Starbase feedback round: design

Written 2026-11-10 from Vignesh's 13 feedback items and his answers the same day. Status: **approved by Vignesh on 2026-11-10 ("lets build"); building.** Branch `feature/feedback-round`, worktree `~/Projects/starbase-feedback`. While the build was starting he added five more items the same day; they are sections 1.8 to 1.12 and Part 5.

This is one design for five parts. Each part gets its own implementation plan and is built and checked on its own, in this order:

| Part | What | Feedback items |
|---|---|---|
| 1 | Fixes | 1, 3, 5, 6, 9, 10 (as a copy list), the Reply button from 12, and four added later: Mark done that sticks, no 5-hour limit, the scroll fix, ticket details for the Foreman |
| 5 | Screens are prototypes | Added later: every Screens step draws the phone and laptop click-through prototype with pinned notes |
| 2 | Auto mode | 2 |
| 3 | Job page | 4, 7 (job page only), 11, 12, 13 |
| 4 | Inbox order | 8 |

The prototype for Part 3 is drawn while Parts 1 and 2 are built, so its review doesn't hold anything up.

## Decided

| Topic | Decision |
|---|---|
| Auto mode | A Fable agent approves each step and takes the recommended answers. It runs to PR #1 whatever the finish line in Settings says. It stops only in exceptional cases. L0 to L2 only. |
| Auto's record | Every decision and its reason goes in a file. One button on the job shows the list. |
| Foreman model | Fixed once the job starts. Changing it starts the whole job again from step one, after a confirmation that explains this. |
| Station | Left as it is. Reworked later. |
| Decisions on the Orbit ticket | Not posted. Orbit's tokens stay read-only. Instead, a list that is easy to find and copy into Orbit by hand. |
| Inbox | Only tickets assigned to you. Watched tickets are left out for now, and the Inbox says so. Mentions in Portal Feedback are looked at later. |

## Part 1: Fixes

### 1.1 Finished workers say Done (item 3)

**Today.** A worker ends by calling a hand-back tool. That call never gets an answer in the worker's log, and `activityState` (`dashboard/lib/session-log.js`) reads any unanswered tool call as "running". So every finished worker shows "Working · Using SubagentHandback" for good. Seen on 2026-11-10: Announcements V1 in the Working lane since October with five such workers, and ORBIT-471 listing four finished workers beside the one really working.

**Change.**
- A log whose last tool call is the hand-back counts as finished.
- A worker whose result the Foreman's log already holds counts as finished too, whatever its own log ends with.
- The lane, the card, the job page's "now" line, the step's "Who's on it" and the Station all follow, because they read the same state.

**Done when.** Announcements V1 leaves the Working lane. ORBIT-471 shows one worker working and the other four under Finished, each marked Done. A test covers a log that ends with a hand-back.

### 1.2 A busy state after every click (item 1)

**Today.** On the job page, Go and Send back only grey out while the decision is sent, and then nothing shows until the job itself changes. On the website the wait is longer, because the decision travels to the laptop first. Many other buttons already have a spinner; these do not.

**Change.**
- Every button that sends something shows its spinner on the click, and can't be pressed twice.
- Once the server has taken a decision, the bar says what is happening until the job moves: "Sent. Waiting for the Foreman to start." On the website: "Sent to your laptop."
- If nothing has moved after 30 seconds, the bar says so and offers Try again, instead of going back to how it looked before.
- All 39 files that send something are checked against this rule.

**Done when.** Go, Send back, Reply, Send, Steer, Stop, Start and Record each show a spinner on the click, on the laptop and on the website.

### 1.3 A Reply button on the approval bar (first half of item 12)

**Today.** The approval card has a third choice, "Other guidance": send your answers or a note with nothing approved. The job page and each step hide the card's own buttons and show only Send back and Go. The Desk has it as a small Reply link.

**Change.** The bar has three buttons everywhere: Send back, Reply, Go. Reply opens a box that says "Your answers or a note for the Foreman. Nothing is approved." It works while questions are still unanswered, which is when Go is off.

**Done when.** With a question unanswered on ORBIT-472's card, Reply sends a note and the card stays open.

### 1.4 Start from the Inbox has the New job options, on the website too (item 9)

**Today.** On the laptop, Start already opens the full New job form. On the website, Start sends at once with defaults: Opus, no level, and a guessed repository. On both, Feature or Bug fix ignores the ticket's type.

**Change.**
- The website's Start opens the same form: description (filled in, editable), Feature or Bug fix, repository, level, Foreman model, all Fable, Auto (Part 2) and run as a stack. With more than one laptop it also asks which.
- The repository list is the chosen laptop's registered repositories, which the laptop sends to the site with its other records.
- The choices travel with the queued start and the laptop uses them.
- "Start from a past conversation" stays on the laptop only.
- On both, Feature or Bug fix is filled in from the ticket's type.

**Done when.** A job started from the website's Inbox at L1 on Fable starts on the laptop at L1 on Fable.

### 1.5 The Foreman model is fixed; changing it starts the job again (item 6)

**Today.** A model menu sits under the message box. A different model on any message carries on in the same session. Nothing starts a job again.

**Change.**
- Once a job has started, the model shows as plain words with a lock: "Foreman model: Opus 5.5". The menu under the message box goes. Approvals and messages always use the job's model.
- The Build and Checks models and "Run the whole job on Fable" lock in the same way.
- "Change model…" (in the job's gear menu) opens a confirmation that says, in these terms:
  - The job starts again from step one on the new model.
  - Its spec, plan, briefs and decisions so far leave the job and are kept in an archive folder.
  - Its code so far leaves the job. The commits are kept on a backup branch, and the job gets a fresh branch.
  - The time and usage already spent are not recovered.
  - You type the job's name to confirm, as Stop job already asks.
- A job with an open pull request can't change model. The confirmation says why: reviewed work would be thrown away. Close the pull request or start a new job.
- After confirming, the job starts through the same path as New job, with the same description, ticket, kind, repository, level and options, and the new model.

**Where the old work goes.** The job folder moves to `~/.claude/feature-work/.restarted/<slug>-<date>/`; Starbase already skips folders that start with a dot. The branch is renamed `backup/<branch>-<date>` and its worktree folder is moved aside with it, uncommitted changes included. Nothing is deleted and nothing is pushed.

**Done when.** No screen offers a model for a started job except "Change model…". Confirming it leaves a new job at step one, the old folder in the archive and the old commits on the backup branch.

### 1.6 A decisions list to copy into Orbit (replaces item 10)

**Today.** "Copy for the ticket" is at the bottom of the Decisions tab. It copies the whole table with its pipes, routine go-aheads included, cut to the last 40 lines.

**Change.**
- A **Copy decisions** button in the job's header, beside the ticket number, and at the top of the Decisions tab.
- It opens a small panel that shows exactly what will be copied, with one Copy button.
- The list holds only decisions about the product: questions answered, the Foreman's decisions that were changed, anything sent back with its reason, and the Not doing list. It leaves out "Brief N: go ahead", pushes, pull requests and installs.
- Plain lines, no table, so it pastes cleanly into an Orbit comment:

  ```
  ORBIT-472 decisions, 10 Nov
  1. Who can add team members? Managers only; leads removed.
     Why: sent back at PR #1.
  2. A manager with no department: the page shows "No department" and adding still works.
  Not doing: tightening roster import (follow-up ticket).
  ```
- No 40-line cut.
- Decisions made by Auto (Part 2) are marked "(Auto)".

**Done when.** From ORBIT-472's page, two clicks put a list like the one above on the clipboard.

### 1.7 The Inbox lists only tickets assigned to you (item 5)

**Today.** Starbase asks Orbit for two lists, assigned to me and watched by me, and shows both under "Mine". Orbit makes a person a watcher whenever they are mentioned on a ticket, an internal note included. Raj's Inbox on the website showed tickets assigned to Vignesh and unassigned tickets; at least one was a ticket whose internal note mentioned him. Separately, Orbit's answer says which filters it applied and which it ignored. Starbase throws that away and labels every ticket from the first list "You".

**Change.**
- The Inbox asks Orbit only for tickets assigned to you. Watched tickets are not read, stored or shown, on the laptop or the website. Rows already stored on the website as watched-only stop showing at once.
- The Inbox says so under its title: "Tickets assigned to you. Tickets you only watch or are mentioned on aren't listed."
- Starbase keeps Orbit's answer for each read: who it took the caller for, and what it ignored.
- If Orbit ignored "assigned to me" (it does this, silently, for an account that isn't on its feedback-team list), the Inbox lists nothing and says why: "Orbit didn't apply 'assigned to me' for this token, so your tickets can't be picked out. The account needs adding to Orbit's feedback-team list."
- Watching comes back when mentions in Portal Feedback have been reworked.

**Done when.** A ticket that only mentions a person no longer appears in their Inbox. Every row is one Orbit says is assigned to them. A token Orbit won't filter for shows the message, not a list.

### 1.8 Mark done sticks, also for jobs finished in a terminal (added 2026-11-10)

**Today.** A job marked done leaves the board only while none of its workers counts as running (`boardCard` in `dashboard/runner/index.js`: `off`). For a job run in a terminal, Starbase never sees a reply end, so a worker whose log stops without a clean ending counts as running for good. Announcements V1 was marked done on 2026-11-10 at 18:05 and still sits in Working, with five workers "Using SubagentHandback" from October.

**Change.**
- Section 1.1 clears the hand-back case.
- Mark done is your word. After it, only something newer than the mark brings the job back: a reply Starbase is running, a worker whose log has a line written after the mark, or a status change after the mark. Old unfinished logs don't.
- The job menu's Mark done stays available for every open job, including ones only ever run in a terminal.

**Done when.** Announcements V1 moves to Done without marking it again. A job whose worker log stops mid-task, marked done later, goes to Done and stays there; a new log line after the mark brings it back as "changed since".

### 1.9 The limits box has no 5-hour limit (added 2026-11-10)

**Today.** The plan no longer has a 5-hour limit, and Claude reports only the weekly one. The top bar shows only Week, but the box that opens on a click always draws a "5-hour limit · Not read yet" row.

**Change.** A limit Claude doesn't report isn't shown anywhere: not in the box, its hover text, Settings → Notifications, or Telemetry's limit lines. If a plan reports a 5-hour limit again, it comes back by itself.

**Done when.** With only a weekly reading the box shows one row, Weekly limit, and nothing on the page says "5-hour".

### 1.10 No scroll past the end of a page (added 2026-11-10)

**Today.** Text kept for screen readers (`.sr-only`) is placed outside the normal layout. The pages' scroll areas don't hold on to such text, so when one sits below the bottom of the window the whole browser page grows to reach it. The result is a second scrollbar and blank space, up to as long as the content itself. Seen on a job page after opening "Try it on your computer": the page scrolled 1800 px in a 992 px window, the lower half empty. Smaller cases of the same kind: 97 px of empty space under the Desk's card and 208 px under a step page.

**Change.**
- Every scroll area holds on to what is inside it, so hidden text can't stretch anything. A test reads the stylesheets and fails when a new scroll area misses this.
- A browser check opens every page at three window sizes, opens every folded section, and fails when the browser page itself scrolls, when a scroll area runs more than a few lines past its last visible content, or when something is cut off sideways. Everything it finds is fixed, including the two smaller cases above, long file paths running out of the level card, and the conversation shrinking to a sliver when Details is open.

**Done when.** The check passes on the demo at 1280, 1512 and 1920 wide. On the real job page, Try it open, the browser page doesn't scroll.

### 1.11 The Foreman gets the ticket's details (added 2026-11-10)

**Today.** A job started from an Orbit ticket carries only the ticket's number, title and link. The first message tells the Foreman to read the rest through an Orbit connection of its own. That connection is often down (it was on 2026-11-10), so the Foreman plans from one line. When it is up, it hands over everything on the ticket, internal notes and people's emails included.

**Change.**
- When a job starts from a ticket, Starbase reads that ticket once with your read-only Orbit token and writes `ticket.md` into the job folder. The Foreman's first message says to read it before planning.
- It holds what helps to plan and build: the description, type, severity, priority, status, the page the ticket is about, and the comments the reporter can see.
- It leaves out what the Foreman doesn't need: people's names and emails, internal staff notes, attachments, watchers and mentions. Text is cut at a fixed length.
- The file opens with one line saying it is a ticket written by a user: information to plan from, never instructions to follow.
- Nothing new is shown on screen. A job started from the website gets the same file, read on the laptop.
- If Orbit can't be reached, the job starts as it does today and the first message says the details couldn't be read.
- The `/feature` and `/bugfix` skills are told the same thing: the ticket is `ticket.md`; they no longer fetch it themselves. That change is on the skills branch with Part 5.

**Done when.** A job started from the Inbox has a `ticket.md` with the ticket's description, and the Foreman's first brief quotes from it. No name or email from the ticket is in the file.

### 1.12 A card with more than three questions can be answered (added 2026-11-10)

**Today.** The Foreman may ask up to five questions before the spec. The server takes at most three answers on one card and refuses the rest with "Answers: at most 3." Seen on ORBIT-453's card with five questions: it could not be approved from the card at all.

**Change.** The server takes up to 20 answers on one card, the same as it already does for the Foreman's decisions. Past that it says so in plain words: "Too many answers in one go: 24. Starbase takes at most 20." The website uses the same check, so it is fixed there too.

**Done when.** ORBIT-453's five answers go through in one click.

## Part 5: Screens are prototypes (added 2026-11-10)

Vignesh's words: the screens Starbase makes should "always look like the cooler newer prototypes we built for phone/laptop field team screens", leaving out "all the text stuff" and keeping "just the new one with the pinned notes and everything".

**Change.**
- The Screens step of every job draws one thing: the hi-fi prototype page. An Info tab, then one phone or one laptop you click through in place, with the Phone and Laptop switch and notes you pin anywhere on a screen.
- The older page is no longer made by jobs: no panel per screen, no text, sketch or lo-fi drawings, no long explanations beside the screens.
- Phone screens are designed for the phone, not squeezed from the laptop.
- The Screens tab and the Screens approval in Starbase show that prototype, and pinned notes come back to the Foreman as the review's feedback.

**Today.** The prototype page is already in the installed wireframe skill. Which page a job gets is left to the worker that draws the screens, and all three jobs with screens so far (ORBIT-465, 471, 472) got the older page.

**How.**
- The skills say it one way only: a job's screens are the prototype. The build refuses a job page that isn't one. A repository with no design system of its own uses the bundled look, so it still gets a prototype.
- The Foreman's and the worker's instructions drop the older page's words (verdict lines per section, options side by side) and use the prototype's: decisions on the Info tab, notes pinned on screens.
- Starbase's Screens tab already shows a prototype and already reads its notes. Its hints are reworded, and the page's Download PDF button gets an answer from Starbase.
- Jobs whose screens were already drawn keep the page they have. Asking for the screens again redraws them as a prototype.

**Done when.** A new job's Screens step produces a page with the Info tab and one phone or laptop, and a note pinned on a screen reaches the Foreman as feedback.

## Part 2: Auto mode (item 2)

### What it is

A switch on a job: **Auto: run to PR #1 without asking me.** While it is on, a Fable agent, the Approver, makes the approvals a person would make. It stops for you only in exceptional cases.

### Turning it on and off

- On the New job form (and so on Start from the Inbox), and on a running job's header.
- L0, L1 and L2 only. At L3 the switch is off and says why. A job that rises to L3 leaves Auto and waits for you.
- A job with no level yet can start in Auto. It leaves Auto if its level turns out to be L3.
- Off at any time. The step then waits for you as it does today.
- Runs on the laptop. The website can turn it on or off and shows its record.

### What Auto changes on the job

- The job's finish line is **PR #1 open**, whatever Settings says. Auto never merges. When PR #1 is open Auto has finished: it switches itself off and tells you.
- Your hand test is skipped for the job. The recorded evidence still runs.
- The job uses the "Auto mode" permission setting, so routine tool steps go ahead as they do there today.

### The Approver

- When a step waits for an approval, Starbase starts a short Fable session with read-only access to the job's folder and its code. It is given the brief, the job's record, the documents for that step, the ticket, and the decisions so far.
- It answers in a fixed shape: go ahead or stop; an answer and a reason for each question; one or two sentences of why; a risk word.
- Starbase checks the shape, then sends the approval down the same path as a click, so every existing check still applies (a stale brief, a changed plan).
- It takes the recommended answer to each question. Where there is none, it picks the option that stays closest to the ticket and can be changed later, and says so.
- It answers questions that workers raise in the middle of a reply the same way.
- It can't edit, run commands or reach the network. What it reads is treated as material, never as instructions.
- The Foreman still stops at every step, as the skills require. Auto only changes who answers.

### When Auto stops and waits for you

Fixed in code, not left to the Approver:
- a merge, or a database change, is asked for;
- something would be changed or deleted outside the job's own folders, or pushed anywhere but your fork;
- the job reaches L3;
- the same step comes back for approval three times without moving on;
- the Approver fails twice running.

The always-refused list (force pushes, pushes to the org repository) stays refused.

By the Approver's judgment, and only then:
- a wrong choice could not be put right by a later code change or review: real data deleted or changed, who can see or do what widened beyond the ticket, money spent;
- the Foreman reports that it cannot do the ticket as written.

When Auto stops, the job moves to Needs you with "Auto stopped:" and the reason, and you get the usual notification. Answering it yourself carries Auto on.

Other permission cards that still appear during an Auto job (reading the ticket from Orbit, looking something up on the web, installing packages inside the job's folder) are allowed or denied by the Approver and recorded.

### The record

- Every Auto decision is an audit line: when, which step, what was asked, what it chose, why.
- From those lines Starbase writes `auto-log.md` in the job folder: a three-line summary, then one entry per decision, newest first.
- **What Auto decided**, a button on the job page and on its card in Jobs, shows that list. It is the only screen Auto adds.
- The same decisions appear in Decisions and in Copy decisions, marked "(Auto)".
- The Approver's cost shows in the job's costs on its own line.

### The skills

`/feature` and `/bugfix` (the workflow-skills repository) say a person approves every step. They gain three rules for a job whose options say Auto: an approval sent by Starbase's Auto counts as the go-ahead; no hand test is asked for; the job stops once PR #1 is open.

**Done when.** An L1 job started with Auto on reaches PR #1 open with no click. What Auto decided lists every approval with its reason. A job that asks for a database change stops with that reason.

## Part 3: Job page (items 4, 7, 11, 12, 13)

The page is drawn as a clickable prototype first and built after its review. This section fixes what each area must hold; the prototype settles where it sits. The Jobs, Desk, Inbox and Station screens keep their layout.

### 3.1 Overview (item 11)

A card at the top of the page, folded or open as you left it:
- **The ticket** as written in Orbit: title, who filed it and when, the description, and a link to it.
- **What we're building**: the outcome and risks from the summary the Foreman already writes for each version of the spec. Before there is a spec, the first brief's summary.
- **What to check**: the job's "It works when" and "It must not" lists. The same list shows beside Try it, so you know what to look for before you click.

### 3.2 Steps (item 4)

- A full-width row of seven large steps. Each has its icon at about 36px, its name, its state in words and how long.
- Clicking a step opens it in place, under the row. The separate step page goes; its address opens the job page on that step.
- Every step shows who worked on it with their model, a live feed of each working crew member's last actions in words, and the documents the step produced.
- Build also shows the plan's steps as a checklist with the one being built now, and the commits so far with the files each changed.
- Review shows each reviewer with its findings. Ship shows the pull requests.

### 3.3 The approval card

- Questions come first, directly under Send back, Reply and Go.
- The evidence folds to one line with its counts ("Evidence: 2 passed, 16 failed") and opens when asked.
- While the crew works, the bar names who is working and on what. Today it says "Nothing to do right now" beside a greyed approve button.

### 3.4 Conversation (second half of item 12)

- A full-height panel that stays in view, with the whole history and the newest message at the bottom.
- A message box that grows to eight lines.
- A button that widens the conversation to the full page and back.
- On a narrow window, one Conversation button fixed at the bottom opens it full screen and shows how many messages are new.

### 3.5 Testing (item 13)

The Test step names three things and gives each a state, a place and a time:

| What | Where it runs | What you see |
|---|---|---|
| Checks, run by the Tester | commands in the job's folder | the command running and the end of its output |
| Recorded evidence, by Starbase | the job's app on its own address, in a hidden browser | each acceptance line as waiting, running, passed or failed |
| Your hand test | Try it | started or not, and your result |

- While anything is being tested, the job's bar and its card in Jobs say so: "Recording evidence: line 4 of 19".
- **Watch** shows the hidden browser live in the page, on the laptop, at about two frames a second.
- The website shows the same progress and each line's video as soon as it finishes. No live picture there in this round.

**Done when.** The built page matches the reviewed prototype. On ORBIT-472 you can read the ticket and the "What to check" list without leaving the page, open Build and see its plan steps and commits, read the whole conversation, and watch a recording run.

## Part 4: Inbox order (item 8)

### 4.1 Your Orbit queue order (item 8)

**Today.** Orbit sends each ticket's work order and queue position. Starbase drops both and sorts by severity, then age. In Orbit, each person ranks their own queue ("Plan my queue").

**Change.** Starbase keeps both fields. Tickets assigned to you are listed in queue order with the number shown. The bar at the top offers the lowest number that has no job.

### 4.2 A suggested pick when nothing is ranked (item 8)

- For assigned tickets with no rank, the Inbox shows up to three as "Suggested", each with a one-line reason.
- A small model (Haiku) picks them on the laptop. It sees each ticket's title, type, severity, age, size and the start of its description, and which code the running jobs are changing.
- It runs again only when the list changes, and at most every 30 minutes.
- A switch in Settings → Workflow turns it off. The website shows the laptop's last suggestion.

**Done when.** Your Inbox lists your tickets in the same order as "Plan my queue" in Orbit, and with nothing ranked it offers up to three suggestions with reasons.

## Choices made here that you can change

1. Auto stops at PR #1 **open**. It never merges.
2. Auto skips your hand test for that job.
3. A model change is refused once a pull request is open.
4. A restart archives the old work; it deletes nothing.
5. The Build and Checks models and all Fable lock along with the Foreman model.
6. The live picture of a test is on the laptop only.
7. Copy decisions leaves out routine go-aheads.
8. The suggestion uses Haiku and runs on the laptop.

## How it is built and released

- Tests first for each change: the server's tests (`npm test`), the web app's (`npm run web:test`) and the click-through tests in `web/e2e`. Auto is also run end to end in `npm run demo` with a stand-in Approver.
- Part 2 changes the workflow-skills repository as well, on its own branch.
- The website's database changes (for 1.4 and 1.7) are run before the release.
- Nothing is pushed without Vignesh's word: a push to Starbase `main` releases the website. The laptop's copy is rebuilt and restarted only when he asks.
