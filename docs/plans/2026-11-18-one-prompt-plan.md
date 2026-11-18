# One prompt, PR comments in one click, a Desk that agrees: plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. This plan is built with a fresh subagent for each task and a fresh reviewer for each task, then one review of the whole branch. Do not build it inline (not superpowers:executing-plans). Steps use checkbox (`- [ ]`) syntax for tracking.

Written 18 Nov 2026 by the session that built "talk any time". That session is finished. **Everything in this file is for a new session on Opus.** The owner chose how it is built (his words, 18 Nov): "fresh subagent and reviewer per task is needed".

**Goal:** Make Starbase's job page as simple to talk to as Claude Code in a terminal: one place to type, PR review comments picked up fast and addressed in one click, a Desk that never shows what he already settled inside a job, and PR #2 merged by him without Raj's approval.

**Architecture:** Four parts, each shippable on its own. (A) Web only: the Foreman's ask moves from the top-left card into one prompt block above the single message box; Enter sends, a message never approves. (B) Server and web: a cheap per-PR watch triggers the existing GitHub read for one repository; every "address" runs as a review round (the one engine that already pushes, replies, resolves and asks again); the prompt shows one PR line with one button. (C) The server says whose turn a job is (`yourTurn`) and the web works out the Desk's queue in one function used by every count. (D) Orbit's PR route, the nudges and the skills stop naming Raj for PR #2.

**Tech stack:** Node 24 server in `dashboard/` (`node --test`), React 19 + TypeScript + Vite in `web/` (vitest, jsdom), Playwright scripts in `web/e2e/`, the `gh` CLI for every GitHub read and write, the workflow skills repository for the Foreman's instructions.

**Spec:** `docs/plans/2026-11-18-one-prompt-design.md` (beside this file). It has his words, what the code does today, the approaches, the design and the calls made for him. Where this plan and the design disagree, the design wins and the difference goes in the ledger as a `Ruling:`.

---

## How this plan is run

The session that opens this plan is the **controller**. It loads superpowers:subagent-driven-development and follows it. It writes no product code and fixes nothing itself. This section sets what that skill leaves open, and four places where this plan overrides it.

**Before Task A1:** use the worktree that exists (`/Users/moxie/Projects/starbase-job-page`); do not make another. Create the branch there (`git switch -c feature/one-prompt`, from `feature/talk-anytime`, as "Where things stand" says). Start the ledger and run the skill's pre-flight scan (`references/preflight.md`).

**For every task, in the order of the table under "Task order", one task at a time:**

1. Record BASE (`git rev-parse HEAD`). Cut the task's brief with the skill's own script, run from this worktree: `bash <skill directory>/scripts/task-brief docs/plans/2026-11-18-one-prompt-plan.md A1`. Task ids are `A1` to `E1`. The skill prints its directory when it loads.
2. Dispatch a **fresh implementer**: a general-purpose agent with `model: "opus"`, the skill's `implementer-prompt.md`, and in it: the task's "Where it fits" line, the brief's path ("read this first: it is your requirements, with the exact values to use verbatim"), the block under "Constraints for every dispatch" pasted whole, and the report file's path. An implementer never reads this plan file.
3. When it reports DONE, write the review package (`scripts/review-package` with the BASE from step 1) and dispatch a **fresh reviewer**: a general-purpose agent with `model: "opus"`, the skill's `task-reviewer-prompt.md`, the brief, the report, the diff file and the same constraints block. The reviewer is never the agent that built the task and never the controller. Each brief ends with "Done when": that list is what the reviewer holds the diff to.
4. Findings go through the skill's fix loop (`references/fix-loop.md`, read before every round), each round ending with a fresh scoped re-review. Then the ledger line, then the next task.

**Where this plan overrides the skill (binding):**

- **Models.** Every dispatch names `model: "opus"`: implementers, reviewers, re-reviewers, fix rounds 4 and 5, and the final whole-branch review. Nothing runs on Fable (it uses the owner's usage too fast). Where the skill says "a more capable model", dispatch a fresh Opus agent.
- **Tests.** The implementer's "full suite before committing" is its brief's **Run** line, which ends with the whole suite of the side it touched. Nothing else runs tests at that time: never dispatch a second agent while an implementer works, and reviewers do not re-run suites (the skill's rule).
- **Nothing is deleted.** Do not delete the plan's workspace at the end. The owner clears it.
- **The finish is "keep the branch".** No merge, no PR, no push, no rebuild or restart of the running Starbase. Those go in the handover for the owner's word.

**Stops:** only the skill's four. A design question never stops the run: rule on it, write the `Ruling:` line in the ledger, carry on. "Open with the owner" below lists the defaults already chosen.

**Ledger:** `progress.md` in the directory `scripts/sdd-workspace` prints (`.superpowers/sdd/2026-11-18-one-prompt-plan/`). `.superpowers/sdd/2026-11-13-job-page-plan/` belongs to another plan: leave it alone.

**A quiet subagent:** after 15 minutes without a word, look at its report file and at the modified times of the files it was to change before waiting longer. Subagents have stalled silently on a permission prompt here before.

**After the last task (the controller):**

1. The final whole-branch review, as the skill's `references/final-review.md` says, on Opus, pointed at the design, the "Review focus" list below and the ledger's deferred minors. One fix wave, one scoped re-review.
2. Write `docs/plans/2026-11-18-one-prompt-handover.md` and commit it by name. It holds: what is built, phase by phase; each branch and its head (Starbase `feature/one-prompt`; skills `feature/pr2-you-merge`, `feature/pr-address`, `feature/talk-anytime`); the test counts from Task E1; every `Ruling:` line from the ledger with what it costs if wrong; the minors deferred; how to look at it (the demo command and what to try); and the steps that need his word, in this order: merge `feature/one-prompt` into `main`, `npm run web:build`, restart Starbase on 4477 (it interrupts a running reply), merge the skills branches, push.
3. Update the memory note `starbase-one-prompt-plan` with the branch, its head and what is live.
4. The last message to the owner: what is built, the handover's path, and "Rulings I made".

## Where things stand (18 Nov 2026)

- **Live Starbase:** port 4477, launchd service `com.moxie.starbase`, runs `main` (`a900427`) from `/Users/moxie/Projects/feature-workshop`.
- **Built 18 Nov, not live, not pushed:** branch `feature/talk-anytime` in the worktree `/Users/moxie/Projects/starbase-job-page`. It has: Send goes into a running reply (`POST /api/runs/:id/steer`), the status line above the box (`web/src/jobpage/left/NowLine.tsx`), the animated crew member on the step in progress, the header's `Try it` button, the branch and PR-line fixes, and the session-log speed fix. Server 2,415 tests and web 2,520 tests pass. This plan builds on it.
- **This work:** in `/Users/moxie/Projects/starbase-job-page`, a new branch `feature/one-prompt` cut from `feature/talk-anytime` (its newest commits are this plan and its design). If `main` already contains that branch (`git merge-base --is-ancestor feature/talk-anytime main`), cut from `main` instead.
- **Skills** (skills `main`, `/Users/moxie/Projects/claude-feature-workflow`, is live through a link in `~/.claude/skills`; nothing here is merged into it unless the owner did so himself):
  - `feature/pr2-you-merge`, commit `3be3e55`: PR #2 needs no approval. Part D's skill text, already written.
  - `feature/pr-address`, cut from `3be3e55`, checked out in the worktree `/Users/moxie/Projects/claude-feature-workflow-pr2`. Empty so far; Task B10 writes into it.
  - `feature/talk-anytime`, commit `231af6c`, in the worktree `/Users/moxie/Projects/claude-feature-workflow-talk`: the `/feature` paragraph "A message at any time". The owner doubts it; Task A6 rewrites it.

## Read first (the controller)

1. `docs/plans/2026-11-18-one-prompt-design.md`: the design. It is short; read all of it.
2. The memory notes `starbase-one-prompt-plan`, `starbase-talk-anytime-build`, `starbase-ui-design-bar`, `prefers-summaries-first-ui`, `starbase-runs-main`, `subagents-stall-on-permission-prompts`, `prefers-opus-over-fable-for-usage`.
3. Nothing else. Each task's brief names what its implementer reads. Files in this codebase open with long design comments; they are accurate.

## The owner's bar (his words, do not soften)

- "what i wanted was to be able to send a message at any point, it didnt have to be answered immediately."
- "it was getting hard to know how to do that with 3 or 4 different inputs … i wanted that to be simpler and basically closer to the claude code on the terminal experience."
- "make sure addressing github comments from reviews are easy and is super simple and picked up fast … just address them by clicking a button or something ideally."
- "if i address something for a job inside the job, then it shouldnt still show up at my desk as a number or a row"
- Earlier, still standing: "keep only useful things on the screen", "make everything move smooth and clean, fast like it was built for performance".

A page that passes its tests and still shows two places to type, or a Desk number that is off by one, has failed.

## Global constraints

**For the controller**

- No merge to `main`, no push, no rebuild or restart of the running Starbase, no `install.sh`, without the owner's word each time. A push to Starbase `main` deploys the website.
- The running Starbase may be read with GET only (`http://127.0.0.1:4477/api/...`). Never POST to it. Never print or store its token. Never run `starbase logout`.
- One implementer at a time. Never a second writing agent in a worktree. Never add `-vN` to a branch name.
- Agents never merge a pull request and never approve one.

**Constraints for every dispatch (paste this list whole into every implementer and reviewer prompt)**

- You work in `/Users/moxie/Projects/starbase-job-page` on the branch `feature/one-prompt`. You change only the files your brief lists, and their tests. A brief that names a skills worktree means that worktree and no other.
- Never delete anything: no `rm`, no `git clean`, no `git reset --hard`, no `git checkout --` or `git restore` on work that is not yours. Never start a subagent. Never `git add -A` or `git add .`: add files by name. No bare `git stash`. No push, no merge, no new branch.
- Never edit or run anything in `/Users/moxie/Projects/feature-workshop` or `/Users/moxie/Projects/claude-feature-workflow`. Never send anything but a GET to `127.0.0.1:4477`. Never read `~/.starbase`, a `.env` file, `~/.claude/feature-work`, `~/Projects/orbit-*` or `~/Projects/moxie-portal*`. Never call the real GitHub: tests use a fake `gh` (`STARBASE_GH`, `web/e2e/lib/fakeGh.cjs` or the test's own).
- `.superpowers/` holds the owner's real conversation. Touch only the brief and report paths you were given.
- Test first: write the tests your brief names, see them fail for the reason you expect, then write the code. Your report carries the failing output and the passing output.
- Every test command starts with `nice -n 15`. While you work, run the focused files. Before you commit, run your brief's whole **Run** line once, in its order. These four are timing-sensitive on this laptop: `dashboard/test/site-link-queue.test.js` ("timing: 5,000 events…"), `web/src/jobpage/notes/Pointable.test.tsx`, `web/src/jobpage/reader/ConversationView.test.tsx` (the speed tests) and `web/src/panes/Foreman/ThreadCrew.test.tsx` (a snapshot). If one fails in a whole-suite run, run that file alone once and report both results.
- Rules the test suite enforces: no inline `style=` (`web/src/app/inlineStyle.test.ts`); every stylesheet is listed in `web/src/main.tsx` (`web/src/app/cssOrder.test.ts`), so put new rules in `web/src/jobpage/jobpage.css` unless your brief says otherwise; buttons, selects, radios and checkboxes come from `web/src/components/`, and a new file that draws buttons goes on the list in `web/src/theme/controlRules.test.ts`; a new field on the job card or the page payload is added to the website's mirror shape (`dashboard/test/mirror-shape.test.js` says where); a component reads the store through a selector that returns a primitive or a stable string.
- Words a person reads: say "Starbase"; plain words; a button says what it does. A string your brief gives in backticks is used exactly as written, curly apostrophes included.
- A test sample that looks like a secret is spelled in two parts (`'sk_' + 'live_…'`).
- Every GitHub write stays behind the owner's yes (`dashboard/lib/gh-write.js` `yes()`). You add no write that runs by itself.
- Line numbers in your brief are from 18 Nov. If a line moved, find the function by its name.
- Commit by file name with the subject your brief gives, ending with the co-author trailer your session's instructions give.

## Review focus

Inputs and conditions the design implies and that will bite him if missed. Each has its test in the task named.

1. **Typing with an input method** (accents, Japanese): Enter that confirms a composition must not send. Task A3.
2. **A second press**: `Address them`, `Send back` and Go pressed twice, or pressed on the Desk and on the job page at once, send once. Tasks B5, B7, C1.
3. **A comment that arrives while the Foreman is fixing** joins the round and is counted on the line; it is never lost and never starts a second message by itself. Task B5.
4. **GitHub not reachable** (`gh` signed out, no network, rate limit): the watch backs off and says why once; the page keeps the last read and its buttons say why they are off. Tasks B4, B7.
5. **An action that fails after the click** (a Go refused as stale, a reply that errors before the Foreman read anything): the job comes back to the Desk and the count. Task C1.
6. **Two tabs**: the Desk in one, the job in another. Task C3.

## File map

| File | Responsibility after this plan |
|---|---|
| `web/src/jobpage/left/Prompt.tsx` (new) | The prompt block: quick asks, status line, PR line, the Foreman's ask, the box, in that order. |
| `web/src/jobpage/left/PrAsk.tsx` (new) | The one PR line in the prompt and at the top of the PR view, with its one button. |
| `web/src/jobpage/left/YourMove.tsx` | The Foreman's ask (gate, question, permission). No field of its own; no working line when in the prompt. |
| `web/src/jobpage/left/MessageBox.tsx` | The only box. Enter sends. Never approves when it has words. |
| `web/src/home/deskOpen.ts` (new) | The Desk's queue and its counts, for every screen. |
| `dashboard/lib/git.js` | Also `sharedPrReads` (one read per PR for every engine) and `prThreads` (which threads are resolved). |
| `dashboard/lib/pr-watch.js` (new) | One cheap question per open PR; says when one changed. |
| `dashboard/lib/review-round.js` | Also opens a round by his ask (`address`), and offers the merge when the route lets him merge with no reviewer. |
| `dashboard/lib/flow.js` | Can read one repository (`only`). |
| `dashboard/lib/job-payload.js` | `prAsk` in place of `prMove`. |
| `dashboard/lib/nudges.js` | PR #2 nudges follow the route; no name is hard-coded. |
| `dashboard/runner/index.js` | Starts the watch; `yourTurn` on each job card; one shared PR read. |

## Task order

One at a time, top to bottom. "Needs" is what must be on the branch first.

| Task | What | Side | Needs |
|---|---|---|---|
| A1 | The prompt frame | web | |
| A2 | The ask, compact, inside the prompt | web | A1 |
| A3 | Enter sends, and a message never approves | web | A1 |
| A4 | Your own answer is the box | web | A3 |
| A5 | The search folds to an icon | web | |
| A6 | The guide, the skill paragraph, the browser checks | web, skills | A1 to A5 |
| B1 | One GitHub read per PR, and all of it | server | |
| B2 | Resolved threads and bots on the rows | server, web | B1 |
| B3 | Read one repository | server | |
| B4 | The PR watch | server | B3 |
| B5 | Address is a round | server | B2 |
| B6 | The PR line in the payload | server | B5 |
| B7 | The PR line in the prompt | web, server | A1, B6 |
| B8 | The PR view, the PR lines and the Ship step | web | B7 |
| B9 | He hears about it once, by name | server | B5 |
| B10 | The skills say the same | skills | B5 |
| B11 | The PR path in a browser | e2e | B4, B5, B8 |
| C1 | The server says whose turn it is | server | B5 |
| C2 | One queue on the web | web | C1 |
| C3 | Two screens agree | e2e | C2, B7 |
| D1 | The route and the nudges | server | |
| D2 | Merging PR #2 from Starbase | server | B7, D1 |
| E1 | Everything together | all | every task |

## Open with the owner

Defaults are chosen so nothing waits. Each is listed in the design under "Calls I made".

| Question | Default built |
|---|---|
| Enter sends on a laptop? | Yes; Shift+Enter is a new line; the phone keeps Enter as a new line. |
| ⌘↵ with an empty box at a go-ahead | Still Go. |
| A lone comment opens a round | Yes, so the Desk has one entry per PR and every finish is one Send back. |
| The watch's times | 30 s for the open job, 3 min for the rest. |
| `Merge as admin` | Offered only when GitHub still asks for a review, with its own yes. |
| The `/feature` paragraph "A message at any time" | Rewritten smaller (Task A6), left unmerged. |
| PR #3 | Unchanged. |

---

## Phase A. One prompt

### Task A1: The prompt frame

**Where it fits:** the first of six web tasks that give the job page one place to type. This one only moves things: the Foreman's ask goes from the top-left card to directly above the message box.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "1. One prompt".

**Read first:** `web/src/jobpage/JobPage2.tsx` (the header comment; the tree at about l.425–494; `deciding` at about l.209; `WIDTH`), `web/src/jobpage/jobpage.css` (the wide grid, about l.592–630 and 663–668), `web/src/jobpage/left/YourMove.tsx` (header comment), `left/MessageBox.tsx` (its props), `left/NowLine.tsx`, `left/AsksRow.tsx`, `docs/superpowers/specs/2026-11-16-job-page-glance-layout-design.md`.

**Files:**
- Create: `web/src/jobpage/left/Prompt.tsx`, `web/src/jobpage/left/Prompt.test.tsx`
- Modify: `web/src/jobpage/JobPage2.tsx`, `web/src/jobpage/jobpage.css`, `web/src/jobpage/JobPage2.test.tsx`, `web/src/theme/controlRules.test.ts` (only if `Prompt.tsx` draws a button itself)
- Must pass unchanged: `web/src/jobpage/phone/PhoneJob2.test.tsx`

**Interfaces:**
- Produces: `Prompt({ job, boxRef, runner, lead, onLead, onOpen, phone }: PromptProps)`. It renders, in this order: `<AsksRow>`, `<NowLine>`, `<div className="jp2-ask">` holding `<YourMove job onOpen inPrompt />` (not on the phone), `<MessageBox boxRef onOpen stopElsewhere />`. It passes each child the props that child takes today. Task B7 adds a PR line between `NowLine` and `.jp2-ask`.
- Produces: `YourMove` takes a new prop `inPrompt?: boolean`. In this task it is accepted and changes nothing (Task A2 gives it meaning).

**Layout rules (exact):**
- **Wide (1100 px and wider):** `Prompt` is the foot of `section.jp2-convo`, replacing the three elements there now (asks row, status line, message box). `.jp2-movewrap` keeps only `<PageProblem />`. The grid has no decision column: delete the `[data-deciding]` column rules, the `is-decide` `Splitter`, `WIDTH.decide` and `--jp2-decide-w`. `deciding` still shows `DecideTabs` over the reader and still hides `StepPanel`. While `data-deciding` is set, the conversation column's default width is `clamp(360px, 32vw, 600px)` (else today's `clamp(320px, 28vw, 560px)`); a width he dragged (`--jp2-convo-w`) wins in both.
- **Mid (760–1100 px):** `Prompt` is the foot of `.jp2-left`, replacing the three elements there now. `YourMove` is no longer in `.jp2-movewrap`.
- **Phone:** unchanged. `YourMove` stays in `.jp2-movewrap` at the top of the job screen; `Prompt` gets `phone` and draws no `.jp2-ask`.
- `.jp2-ask`: `max-height: 50vh` (mid: `40vh`), `overflow-y: auto`, thin scrollbar; `.jp2-ask:empty { display: none }`. Its calls row (`.jp2-ym-calls`) is `position: sticky; bottom: 0` with the block's background, so Go and Send back always touch the box.
- Conversation hidden (`data-convo="hidden"`): the rule that hides the column's children also keeps `.jp2-ask` (`:not(.jp2-asks):not(.jp2-now):not(.jp2-ask):not(.jp2-mbw)`).
- Update `JobPage2.tsx`'s header comment (the layout by width) to match.

**Tests to write first:**
- In `JobPage2.test.tsx` (use the file's existing wide, mid and phone helpers and its gate fixture):
  - `wide: the Foreman’s ask sits in the conversation column, directly above the message box`: `.jp2-convo .jp2-ask` holds the gate card; `.jp2-ask + .jp2-mbw` is not null; `.jp2-movewrap .jp2-ym` is null.
  - `wide: nothing waits: no ask block is drawn`: `.jp2-ask` has no child elements.
  - `wide: a decision no longer takes a column`: no element with class `is-decide`; `main.jp2` still has `data-deciding` and the reader still shows `DecideTabs`.
  - `mid: the ask sits in the left pane’s foot, above the box`.
  - `the conversation hidden: the ask, the status line and the box stay along the foot`.
  - `a width change from wide to mid keeps the draft and the picks`: type a draft, pick an option, change the width, read both back from the store and the DOM.
- In `Prompt.test.tsx`: `the order is quick asks, status line, ask, box` (compare the children's class names).

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused files; the new tests fail because `Prompt` does not exist and the ask is still in `.jp2-movewrap`.
- [ ] **Step 3:** Build `Prompt.tsx`; change the tree and the stylesheet as the layout rules say.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(job page): the Foreman’s ask sits above the message box, in one prompt`.

**Run:** `nice -n 15 npm run web:test -- --maxWorkers=3 src/jobpage/JobPage2.test.tsx src/jobpage/left/Prompt.test.tsx src/jobpage/phone/PhoneJob2.test.tsx`, then `npm run typecheck -w web`, then `nice -n 15 npm run web:test`.

**Done when:**
- On the wide and mid pages `YourMove` is mounted in one place, `.jp2-ask`, directly before `.jp2-mbw`; `.jp2-movewrap` holds only `PageProblem`.
- No `is-decide` splitter, `WIDTH.decide` or `--jp2-decide-w` remains in `JobPage2.tsx` or `jobpage.css`.
- `PhoneJob2.test.tsx` passes and that file is not in the diff.
- No inline style; no new stylesheet.

### Task A2: The ask, compact, inside the prompt

**Where it fits:** Task A1 moved the Foreman's ask above the message box. This task trims it so that, there, it shows only the ask and its buttons.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "1. One prompt" ("One status, one Stop").

**Read first:** `web/src/jobpage/left/YourMove.tsx` (`YourMove`, `Card`, `GateCard`, `AskCard`, `PermissionCard`, `AskedList`, `StopReply`, the `jp2-ym-one` line), `web/src/jobpage/left/NowLine.tsx`, `web/src/jobpage/left/Prompt.tsx`.

**Files:**
- Modify: `web/src/jobpage/left/YourMove.tsx`, `web/src/jobpage/jobpage.css`
- Test: `web/src/jobpage/left/YourMove.test.tsx`

**Interfaces:**
- Consumes: the prop `inPrompt?: boolean` on `YourMove` (Task A1 passes it from `Prompt`).
- Produces: with `inPrompt`, `YourMove` returns `null` when nothing waits and nothing was asked.

**Rules with `inPrompt` (without it, nothing changes):**
- No "Working · …" line (`jp2-ym-one`) and no `StopReply`: the status line above has both.
- The card has no `jp2-card-label` (the status line says `Waiting for you · since …`) and no `jp2-card-happened` list (the reader shows the brief). The ask is shown whole: no one-line cut, no `More`.
- A question's options are one per row at every width.
- `AskedList` (what he asked) stays under the card. The `Sent · …` line (`jp2-ym-sent`) stays.
- Sizes: the ask 14px/20px weight 600; options 13px/18px. Colours from the existing tokens only.

**Tests to write first** (`YourMove.test.tsx`):
- `in the prompt, a job with nothing waiting draws nothing`.
- `in the prompt a running reply draws no Working line and no Stop`.
- `in the prompt the card has no Needs-you label and shows the whole ask`: a 300-character ask has no `More` button and no ellipsis class.
- `in the prompt each option is its own row`.
- `Go and Send back are the last row of the ask block`.
- `outside the prompt the card is as before`: the label is present.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused file; the `in the prompt` tests fail because `inPrompt` changes nothing yet.
- [ ] **Step 3:** Implement the rules.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(job page): the ask is compact in the prompt, and says nothing when nothing waits`.

**Run:** `nice -n 15 npm run web:test -- --maxWorkers=3 src/jobpage/left/YourMove.test.tsx`, then `npm run typecheck -w web`, then `nice -n 15 npm run web:test`.

**Done when:**
- With `inPrompt` and nothing waiting, `YourMove` renders nothing, so `.jp2-ask` is empty and hidden.
- On the wide page the status line is the only "Working" line and holds the only Stop.
- Every existing test of the card without `inPrompt` still passes unchanged.

### Task A3: Enter sends, and a message never approves

**Where it fits:** the message box is now the one place to type. Today ⌘↵ in it at a go-ahead presses Go, so a typed question approves the step. This task makes Enter send a message, always.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "1. One prompt" and "Calls I made" 1 to 3.

**Read first:** `web/src/jobpage/left/MessageBox.tsx` (the header comment; `onKeyDown`, `pressSend`, `backNow`, `composeFor`, the constants `PLACEHOLDER`, `INTO_REPLY`, `AT_ASK`, `STEER_WORDS`), `web/src/jobpage/left/MessageBox.test.tsx` (the tests that pin ⌘↵ and Send back), `web/src/components/Kbd.tsx`, `web/src/jobpage/left/YourMove.tsx` (the header comment's key list; `decide`).

**Files:**
- Modify: `web/src/jobpage/left/MessageBox.tsx`, `web/src/jobpage/left/YourMove.tsx` (the header comment's key list only)
- Test: `web/src/jobpage/left/MessageBox.test.tsx`, `web/src/jobpage/left/YourMove.test.tsx`

**Rules (exact):**
- Laptop (`!narrow`): Enter with no Shift and no Alt, and not composing (`e.nativeEvent.isComposing` is false and `e.keyCode !== 229`), sends (`pressSend()`) and the default is prevented. Shift+Enter and Alt+Enter add a line.
- Phone (`narrow`): Enter adds a line; the Send button sends.
- ⌘↵ / Ctrl+↵, at any width: with words or notes in the box it sends, exactly as Enter. With an empty box and no notes: Go when a go-ahead waits (`pressKey('jp-go')`), else nothing.
- ⌘↵ pressed inside the box with words never reaches the page's `jp-go` key.
- `pressSend` at a go-ahead sends a message (`POST /api/job/:slug/send` with `{ kind: 'message', text }`), with any notes composed in front as `composeFor` does. The branch that turned Send into Send back when notes exist, and `backNow`, are removed: the Send button always says `Send` or `Send · n notes`.
- Go still carries the box's words as its note, and Send back as the change: `YourMove`'s `decide` reads the draft as today. Do not change that.
- The Send button on a laptop shows the key: `Send` then `<Kbd>↵</Kbd>`. Its title: `Send your words to the Foreman as a message (Enter). Shift+Enter starts a new line.`
- The box's title at a go-ahead: `Enter sends your words to the Foreman as a message. Go carries them as a note, Send back as the change.`
- The placeholders are unchanged.

**Tests to write first** (`MessageBox.test.tsx`):
- `Enter sends the words as a message`: one `POST /api/job/<slug>/send` with `{ kind: 'message', text: 'hello' }`; the box is empty after.
- `Shift+Enter adds a line and sends nothing`.
- `Enter while an input method is composing sends nothing`: `fireEvent.keyDown(box, { key: 'Enter', isComposing: true })`, and again with `keyCode: 229`; no request either time.
- `at a go-ahead, Enter with words posts to /send and never to /gate`.
- `⌘↵ with words at a go-ahead sends the message; with an empty box it presses Go`: `/gate` is posted only in the second case.
- `on the phone Enter adds a line`.
- `at a go-ahead with two notes the button says Send · 2 notes and posts one message with the notes in front`.
- `while a reply runs, Enter goes into the reply`: `POST /api/runs/<id>/steer`.
- Rewrite the existing tests that pin ⌘↵ as Go with words in the box, and Send turning into Send back. List each rewritten test in your report.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused files; the new tests fail because plain Enter adds a line today and ⌘↵ at a go-ahead posts to `/gate`.
- [ ] **Step 3:** Implement the rules.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(job page): Enter sends, and a message never approves a step`.

**Run:** `nice -n 15 npm run web:test -- --maxWorkers=3 src/jobpage/left/MessageBox.test.tsx src/jobpage/left/YourMove.test.tsx`, then `npm run typecheck -w web`, then `nice -n 15 npm run web:test`.

**Done when:**
- From the box with words in it, nothing reaches `/api/job/:slug/gate` except through the Go and Send back buttons.
- `backNow` is gone and the Send button never reads `Send back`.
- Enter during composition sends nothing (both forms tested).
- The phone's Enter is a new line.

### Task A4: Your own answer is the box

**Where it fits:** a question's "Your own answer" has its own text field inside the ask today, a second place to type. This task removes it: the message box holds those words.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "1. One prompt" ("Your own answer is the box") and "Calls I made" 4.

**Read first:** `web/src/jobpage/left/YourMove.tsx` (`GateCard`, especially the own-answer `<input>` at about l.539; the crew question in `PermissionCard` at about l.695; `decide`; `BACK_HINT`), `web/src/jobpage/left/gateBody.ts` (`OWN`, `GatePicks`, `gateBody`), `web/src/jobpage/jobStore.ts` (`ui.draft`, `ui.own`, `setOwn`), `web/src/jobpage/left/MessageBox.tsx` (`giveBack`; the `jp-write` key).

**Files:**
- Modify: `web/src/jobpage/left/YourMove.tsx`, `web/src/jobpage/jobStore.ts` (delete `setOwn` and `ui.own` if nothing else uses them), `web/src/jobpage/jobpage.css` (delete the `.jp2-ym-ownin` rules)
- Test: `web/src/jobpage/left/YourMove.test.tsx`
- Must pass unchanged: `web/src/jobpage/left/gateBody.test.ts` (`gateBody` still takes `GatePicks.own`; the caller now fills it from the box)

**Rules (exact):**
- No `<input>` in the ask. The `Your own answer` row stays; picking it runs `pick(q.id, OWN)` then `pressKey('jp-write')`, which puts the cursor in the box. A question with no options shows one line under it: `Write your answer in the message box.`
- At Go and at Send back, every question whose pick is `OWN`, or that has no options, takes the box's words, trimmed, as its own answer (`GatePicks.own[q.id]`). When the words were used this way they are not also sent as the note; notes pinned in the reader still go as the note.
- Go with such a question and an empty box sends nothing, puts the cursor in the box and says: `Write your answer in the message box, then press Go.` Go is not disabled for this case, so the press can say it.
- The crew question (a permission with questions) follows the same rule; its answer posts as today, with the box's words.
- After a send that used the words, the box is emptied; on a refusal they come back (today's `giveBack`).

**Tests to write first** (`YourMove.test.tsx`):
- `Your own answer has no field; picking it puts the cursor in the message box`.
- `Go with Your own answer picked sends the box’s words as that answer and no note`: the body's answer for that question is `{ other: 'do X' }` and the body has no `note` key.
- `Go with Your own answer picked and an empty box sends nothing and says Write your answer in the message box, then press Go.`
- `a question with no options takes the box’s words`.
- `two questions on Your own answer both carry the box’s words`.
- `a crew question’s own answer comes from the box`.
- `a refused Go puts the words back in the box`.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused file; the new tests fail because the field still exists and the box's words go as the note.
- [ ] **Step 3:** Implement the rules.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(job page): a question’s own answer is typed in the message box`.

**Run:** `nice -n 15 npm run web:test -- --maxWorkers=3 src/jobpage/left/YourMove.test.tsx src/jobpage/left/gateBody.test.ts src/jobpage/left/MessageBox.test.tsx`, then `npm run typecheck -w web`, then `nice -n 15 npm run web:test`.

**Done when:**
- `YourMove.tsx` draws no text `<input>`.
- `gateBody.ts` and `gateBody.test.ts` are not in the diff.
- The report says whether `ui.own` and `setOwn` were deleted or are still used, and by what.
- The words are never sent twice (as an answer and as the note).

### Task A5: The search folds to an icon

**Where it fits:** the conversation column's search field looks like a second place to type. In the column it becomes an icon until he wants it.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "1. One prompt" ("One text box on the page").

**Read first:** `web/src/jobpage/reader/ConversationView.tsx` (the `column` prop; the tools row at about l.455–478: `.jp2-cv-tools`, `.jp2-cv-sbox`, `.jp2-cv-search`, `Jump to latest`; how keys are registered in this file), `web/src/jobpage/reader/ConversationView.test.tsx`.

**Files:**
- Modify: `web/src/jobpage/reader/ConversationView.tsx`, `web/src/jobpage/jobpage.css`
- Test: `web/src/jobpage/reader/ConversationView.test.tsx`

**Rules:**
- With `column` (the conversation column): the tools row shows an icon button (`aria-label="Search the conversation"`, title `Search the conversation (/)`) and `Jump to latest`. Pressing the button, or `/` when the cursor is not in a text field, shows today's field in the row with the cursor in it.
- Escape with words clears them. Escape, or leaving the field, with no words folds it back to the button. While it has words it stays open.
- Without `column` (the reader on mid and phone): the field stays as today.
- The icon comes from where this file's other icons come from. The button comes from `web/src/components/`.

**Tests to write first** (`ConversationView.test.tsx`):
- `in the column the search is a button until pressed`.
- `/ opens it with the cursor in it`.
- `/ typed in a text field does not open it`.
- `Escape with words clears them and keeps it open; Escape again folds it`.
- `in the reader the field is always there`.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused file; the column tests fail because the field is always drawn.
- [ ] **Step 3:** Implement the rules.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(job page): the conversation’s search is an icon until he needs it`.

**Run:** `nice -n 15 npm run web:test -- --maxWorkers=3 src/jobpage/reader/ConversationView.test.tsx`, then `npm run typecheck -w web`, then `nice -n 15 npm run web:test`.

**Done when:**
- On the wide page with nothing typed in search, the message box is the only text field in the conversation column.
- Searching itself (matches, counts, jumping) behaves as before; its existing tests pass unchanged.

### Task A6: The guide, the skill paragraph, the browser checks

**Where it fits:** Tasks A1 to A5 changed where he types and what Enter does. This task makes the guide and the Foreman's skill say so, and checks the page in a real browser.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "1. One prompt" and "Calls I made" 9.

**Read first:** `docs/guide/05-deciding.md`, `docs/guide/09-the-website.md`, `docs/guide/10-keys-and-command-box.md` (and `docs/guide/keys-table.mjs` if the keys table is generated), `web/e2e/noJump.mjs` (its header says how the browser scripts run against the demo), `dashboard/demo/run-demo.js` (which demo job waits at a go-ahead), `/Users/moxie/Projects/claude-feature-workflow-talk/feature/skills/feature/SKILL.md` (the paragraph "A message at any time").

**Files:**
- Modify: `docs/guide/05-deciding.md`, `docs/guide/09-the-website.md`, `docs/guide/10-keys-and-command-box.md`
- Modify, in the skills worktree `/Users/moxie/Projects/claude-feature-workflow-talk` (branch `feature/talk-anytime`): `feature/skills/feature/SKILL.md`
- Create: `web/e2e/onePrompt.mjs`
- Run: `web/e2e/noJump.mjs`, `noEmptyScroll.mjs`, `themeSweep.mjs`, `contrast.mjs`, `jobSpeed.mjs`

**Rules:**
- The guide, in its own plain style: the Foreman's ask sits directly above the message box; Enter sends a message and never approves; Shift+Enter is a new line; ⌘↵ with an empty box at a go-ahead is Go; "Your own answer" is typed in the box; Send while the Foreman works goes into its reply. Remove any line that describes a separate answer field or a Steer control.
- The skill paragraph: keep its heading; replace its body with this rule, in the skill's voice. A message that arrives while a step runs is read at the next step and answered in a few lines, then the step carries on. If it asks to change something already made, say so and take it up when the current step ends, unless the person says now. It is never a go-ahead for a push, a PR, a reviewer request, a merge or a check that writes data. Commit that one file by name on `feature/talk-anytime` in that worktree. Do not merge it.
- `web/e2e/onePrompt.mjs`, built the way `noJump.mjs` is (same way of finding the running demo). On a demo job that waits at a go-ahead, at 1906×1000 and again at 1280×800, it fails unless:
  1. exactly one text entry is visible inside `main.jp2` (count visible `textarea`, `input[type="text"]`, `input[type="search"]`, `input:not([type])` and `[contenteditable="true"]`);
  2. Go and Send back are inside the window without scrolling, and the ask block's bottom edge is within 16 px of the top of `.jp2-mbw`;
  3. the page has no sideways scroll;
  4. typing `hello` and pressing Enter adds his message to the conversation, and the Go button is still there;
  5. with the conversation hidden, the ask, the status line and the box are still visible.

- [ ] **Step 1:** Write `web/e2e/onePrompt.mjs`.
- [ ] **Step 2:** `npm run web:build`. Start the demo in the background as `noJump.mjs`'s header says and note its process id. Run `node web/e2e/onePrompt.mjs`; fix what it flags in the files Tasks A1 to A5 changed.
- [ ] **Step 3:** Run `noJump.mjs`, `noEmptyScroll.mjs`, `themeSweep.mjs`, `contrast.mjs` and `jobSpeed.mjs`, each as its own header says. Fix what they flag in the files Tasks A1 to A5 changed. Stop the demo by its process id (never `pkill`).
- [ ] **Step 4:** Edit the three guide pages. Run `nice -n 15 node --test --test-timeout=240000 dashboard/test/docs.test.js`.
- [ ] **Step 5:** Edit the skill paragraph and commit it in the skills worktree.
- [ ] **Step 6:** Run the rest of the Run line. Commit in the Starbase worktree: `docs(guide): one prompt, and a browser check that there is one place to type`.

**Run:** `nice -n 15 node --test --test-timeout=240000 dashboard/test/docs.test.js`, then `npm run typecheck -w web`, then `nice -n 15 npm run web:test` (only if Step 2 or 3 changed product code).

**Done when:**
- `onePrompt.mjs` passes at both widths, and its output is in the report.
- Each of the five other scripts passes, or the report gives the script, its output and why the failure does not come from Tasks A1 to A5.
- The guide nowhere describes an answer field inside the ask or a Steer button (`grep -rn "Steer\|own answer" docs/guide` is in the report).
- The skills commit touches one file and is not merged.

---

## Phase B. PR comments: fast, visible, one click

### Task B1: One GitHub read per PR, and all of it

**Where it fits:** the first of eleven tasks that make PR review comments fast to arrive and one click to address. Today three engines (review rounds, the Desk's PR feedback cards, the job page's PR rows) each read the same PR from GitHub after every refresh. This task makes them share one read, read past the first page, and read every job that has an open PR.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "What Starbase does today → PR comments" and "2. PR comments".

**Read first:** `dashboard/lib/git.js` (`prChecks` about l.184, `prComments` about l.228, `prConversation` about l.251), `dashboard/lib/review-round.js` (`readPr` about l.964), `dashboard/lib/pr-comments.js` (the header comment; `createPrComments`; `wanted` about l.436; `RAW_MAX`), `dashboard/lib/pr-feedback.js` (how it reads a PR), `dashboard/runner/index.js` (where the three get their readers: search for `createReviewRounds(`, `createPrComments(` and `feedbackPass`).

**Files:**
- Modify: `dashboard/lib/git.js`, `dashboard/lib/review-round.js`, `dashboard/lib/pr-comments.js`, `dashboard/lib/pr-feedback.js`, `dashboard/runner/index.js`
- Create: `dashboard/test/pr-reads.test.js`
- Test: `dashboard/test/review-round.test.js`, `dashboard/test/pr-comments.test.js`, `dashboard/test/pr-comments-server.test.js`

**Interfaces:**
- Produces `sharedPrReads(gh, { ttlMs = 20_000, now = Date.now } = {})` exported from `git.js`. It returns `{ prComments, prConversation, prChecks, drop }`: the three reads `git.js` already exports, each taking the arguments it takes today after `gh`, plus `drop(repo, n)`. A read's answer is kept per read and per `repo#n` for `ttlMs`. A caller during a read gets that read's promise. A failed read is not kept. `drop(repo, n)` forgets everything kept for that PR. Task B2 adds a fourth read to it.
- The runner makes one `sharedPrReads` and hands it to review rounds, PR feedback and PR comments. Each engine reads a PR's comments, conversation and checks only through it. After any GitHub write for a PR (a reply, a resolve, a push, a merge), the engine that wrote calls `drop(repo, n)`.
- `readPr` in `review-round.js` reads every page, the way `git.js` `prComments` does.
- `createPrComments` reads every job with an open or draft PR on its lane, not only the jobs whose page is open: newest change first, at most `RAW_MAX` (32).

**Tests to write first:**
- `pr-reads.test.js`: `two callers within 20 s share one gh call`; `a caller after 20 s reads again`; `callers during a read share its promise`; `a failed read is not kept`; `drop forgets one PR and leaves the others`.
- `review-round.test.js`: `readPr reads past 100 comments`: 150 fake line comments on two pages all become candidates.
- `pr-comments.test.js`: `a job whose page is not open still gets rows`.
- `pr-comments-server.test.js`: `after one refresh the three engines make each list call once per PR`: a fake `gh` that counts calls per path.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused files; they fail because `sharedPrReads` does not exist, `readPr` stops at one page, and a job with no open page gets no rows.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `fix(server): one GitHub read per PR for every engine, past the first page, for every job with an open PR`.

**Run:** `nice -n 15 node --test --test-timeout=240000 dashboard/test/pr-reads.test.js dashboard/test/review-round.test.js dashboard/test/pr-comments.test.js`, then `nice -n 15 node --test --test-timeout=240000 dashboard/test/pr-comments-server.test.js`, then `nice -n 15 npm test`.

**Done when:**
- The runner creates one `sharedPrReads` and all three engines use it; outside `git.js`, no engine calls `prComments`, `prConversation` or `prChecks` on the bare `gh` for a PR's lists.
- Every GitHub write path for a PR calls `drop`.
- A failed read is retried by the next caller, not served from the kept answer.

### Task B2: Resolved threads and bots on the rows

**Where it fits:** Starbase never reads which review threads were resolved on GitHub, so a resolved comment still shows as new. It reads whether an author is a bot and then drops it. This task carries both to the job page's PR rows and to review-round items.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "2. PR comments" ("Truer rows").

**Read first:** `dashboard/lib/git.js` (`sharedPrReads` from Task B1; where `bot` is computed, about l.232 and l.254), `dashboard/lib/pr-comments.js` (`rowsOf` about l.143–236; how `fresh` is counted), `dashboard/lib/review-round.js` (`itemOf` about l.242; `bot` about l.205), `web/src/jobpage/types.ts` (`PrRow`), `web/src/jobpage/reader/PrView.tsx` (`stateWords`; where the author is drawn), `dashboard/lib/gh-write.js` (`resolveThread`, for the GraphQL shape already used).

**Files:**
- Modify: `dashboard/lib/git.js`, `dashboard/lib/pr-comments.js`, `dashboard/lib/review-round.js`, `web/src/jobpage/types.ts`, `web/src/jobpage/reader/PrView.tsx`, the mirror shape if rows are mirrored
- Test: `dashboard/test/pr-reads.test.js`, `dashboard/test/pr-comments.test.js`, `dashboard/test/review-round.test.js`, `web/src/jobpage/reader/PrView.test.tsx`

**Interfaces:**
- Produces `prThreads(gh, repo, n): Promise<{ ok: boolean, resolved: Set<string> }>` exported from `git.js`: the ids (`'c' + databaseId`) of every comment in a thread GitHub has resolved. One read-only `gh api graphql` query of `repository.pullRequest.reviewThreads(first: 100) { nodes { isResolved comments(first: 100) { nodes { databaseId } } } pageInfo { hasNextPage endCursor } }`, following pages. A failing query gives `{ ok: false, resolved: new Set() }`.
- `sharedPrReads` also returns `prThreads`, kept the same way.
- `PrRow` gains `bot: boolean` and `resolved: boolean`. A row whose comment is in a resolved thread has state `answered` and `resolved: true`, and is not counted in `fresh`. If the thread is unresolved again on GitHub, the row is what it would have been. When `prThreads` is not `ok`, rows are as they are today.
- A review-round item gains `bot: boolean`.

**Words (exact):** a resolved row's state word is `Resolved on GitHub`. A bot's row shows the word `bot` beside the author's name.

**Tests to write first:**
- `pr-reads.test.js`: `prThreads follows pages`: two pages of threads; `prThreads failing says ok false and an empty set`.
- `pr-comments.test.js`: `a thread resolved on GitHub is answered and not counted as new`; `a thread unresolved again is new again`; `prThreads not ok leaves the rows as they were`; `a bot’s comment is a row with bot true` (author `coderabbitai[bot]`).
- `review-round.test.js`: `an item from a bot has bot true`.
- `PrView.test.tsx`: `a bot’s row shows bot beside the author`; `a resolved row says Resolved on GitHub`.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused files; they fail because `prThreads` does not exist and rows carry neither field.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(server): a thread resolved on GitHub is answered, and a bot’s comment is marked`.

**Run:** `nice -n 15 node --test --test-timeout=240000 dashboard/test/pr-reads.test.js dashboard/test/pr-comments.test.js dashboard/test/review-round.test.js`, then `nice -n 15 npm run web:test -- --maxWorkers=3 src/jobpage/reader/PrView.test.tsx`, then `npm run typecheck -w web`, then `nice -n 15 npm test`, then `nice -n 15 npm run web:test`.

**Done when:**
- A resolved comment never counts toward a "new" or "to address" number.
- The GraphQL call is a query only; nothing is written.
- `bot` reaches both the row and the round item.

### Task B3: Read one repository

**Where it fits:** "Pull now" and the page's opening read refresh every repository Starbase knows, which is slow. This task lets a refresh read one repository, so a later task can react to one changed PR cheaply.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "2. PR comments" ("Picked up fast").

**Read first:** `dashboard/lib/flow.js` (the header comment; `refresh` about l.319; `#refresh`; `gatherRepo`; `NETWORK_EVERY_MS`), `dashboard/runner/index.js` (`prRead` about l.2601; the passes chained on the `flow` event, about l.1940–1960), `dashboard/lib/review-round.js` and `dashboard/lib/pr-comments.js` (their `pass(view)`).

**Files:**
- Modify: `dashboard/lib/flow.js`, `dashboard/runner/index.js`, `dashboard/lib/review-round.js`, `dashboard/lib/pr-comments.js`, `dashboard/lib/pr-feedback.js`
- Test: `dashboard/test/flow.test.js`, `dashboard/test/pr-lines-server.test.js`

**Interfaces:**
- `FlowWatch.refresh({ network = false, only = null } = {})`. `only` is a list of repository paths, as `gatherRepo` keys them. With it, the network read fetches and lists just those repositories; the others keep their last facts and their `fetchedAt`. A request that arrives during a refresh runs after it and is merged with any other waiting request: `only` lists are joined, and a request with no `only` wins.
- The view the watch emits gains `read: string[] | null`: the repositories read from the network in this refresh, or `null` when all were read or none.
- Each of the three passes skips a job whose repository is not in `view.read`, when `view.read` is not `null`.
- `prRead(slug)` passes `only: [the job's repository path]`.

**Tests to write first:**
- `flow.test.js`: `refresh({ network: true, only: [a] }) fetches and lists a only; b keeps its PRs and its fetchedAt`; `two requests during a refresh run once after it, for both repositories`; `a request with no only wins over one with only`.
- `pr-lines-server.test.js`: `Pull now reads only the job’s repository`: the fake `gh` sees no call for the other repository.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused files; they fail because `only` is ignored.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `perf(server): Pull now reads the job’s repository, not every one`.

**Run:** `nice -n 15 node --test --test-timeout=240000 dashboard/test/flow.test.js`, then `nice -n 15 node --test --test-timeout=240000 dashboard/test/pr-lines-server.test.js`, then `nice -n 15 npm test`.

**Done when:**
- A refresh with `only` makes no `git fetch` and no `gh` call for another repository.
- Repositories not read keep their facts; no job loses its PR lines after a one-repository refresh.
- The whole-map refresh on its timer behaves as before.

### Task B4: The PR watch

**Where it fits:** a new PR comment can sit for up to ten minutes before Starbase reads it. This task adds a watch that asks GitHub one cheap question per open PR, often, and triggers the full read of that one repository only when something changed.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "2. PR comments" ("Picked up fast") and "Calls I made" 7.

**Read first:** `dashboard/lib/flow.js` (`refresh` with `only`, from Task B3; the view's lanes and their PRs), `dashboard/runner/index.js` (`start()`, where the flow watch starts; how the runner knows a job's page is open, the signal `pr-comments.js` uses to pick which jobs to read), `web/e2e/lib/fakeGh.cjs`, `dashboard/test/pr-comments-server.test.js` (how a server test fakes `gh` and time).

**Files:**
- Create: `dashboard/lib/pr-watch.js`, `dashboard/test/pr-watch.test.js`
- Modify: `dashboard/runner/index.js`, `web/e2e/lib/fakeGh.cjs` (answer `repos/<repo>/pulls/<n>`)
- Test: `dashboard/test/pr-comments-server.test.js`

**Interfaces:**
```js
export const WATCH_OPEN_MS = 30_000;   // a job whose page is open
export const WATCH_REST_MS = 180_000;  // every other job with an open PR
export const WATCH_MAX_WAIT_MS = 600_000;
/** What one `gh api --method GET repos/<repo>/pulls/<n>` answer says about change. */
export function fingerprint(pr) // `${updated_at}|${comments}|${review_comments}|${commits}|${head.sha}|${state}|${merged}|${mergeable_state}`
export function createPrWatch({ gh, jobs, isOpen, onChange, now = Date.now, setTimer = setTimeout })
// jobs(): Promise<{ slug, repo /* owner/name */, repoPath, prs: number[] /* open or draft */ }[]>
// isOpen(slug): boolean  (a live page watches the job)
// onChange({ repoPath, slugs: string[] }): called once per repository per tick
// returns { start(), stop(), tick(): Promise<void>, state(): { problem: string | null, lastAt: number | null } }
```
- The first sight of a PR only stores its fingerprint. A different fingerprint later calls `onChange`. At most 4 `gh` calls are in flight. A failing `gh` doubles that PR's wait, up to `WATCH_MAX_WAIT_MS`, and sets `problem` to gh's first line; the next answer that works clears `problem` and returns to the normal times.
- In the runner, `onChange` is `flow.refresh({ network: true, only: [repoPath] })`. The watch starts only when a `gh` runner exists, and stops with the runner.

**Tests to write first** (`pr-watch.test.js`, with a fake `gh` and a fake clock):
- `nothing is reported on first sight`.
- `a new review comment (review_comments 2 → 3) calls onChange once, with the job’s repository`.
- `two PRs of one repository changing in one tick call onChange once`.
- `the open job is asked every 30 s, the others every 3 min`.
- `gh failing backs off to ten minutes, says why once, and recovers`.
- `never more than four calls in flight`: 20 PRs.
- In `pr-comments-server.test.js`: `a comment that appears on GitHub shows as a row without Pull now`: drive the watch's `tick()` after the fake `gh` gains a comment.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused files; they fail because `pr-watch.js` does not exist.
- [ ] **Step 3:** Implement the watch and start it in the runner.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(server): a new PR comment is picked up within 30 seconds on the open job`.

**Run:** `nice -n 15 node --test --test-timeout=240000 dashboard/test/pr-watch.test.js`, then `nice -n 15 node --test --test-timeout=240000 dashboard/test/pr-comments-server.test.js`, then `nice -n 15 npm test`.

**Done when:**
- The watch makes one GET per open PR per tick and nothing else; it never writes.
- A `gh` that fails does not spin: the wait grows to ten minutes and `problem` is set once.
- The watch's timer is stopped when the runner stops (no test hangs on an open timer).

### Task B5: Address is a round

**Where it fits:** there are two ways to have the Foreman fix PR comments, and they do not connect: the job page's `Fix these` (no push for a PR #2 fix, replies posted one by one, nothing resolved) and review rounds (one Send back that pushes, replies, resolves and asks again). This task makes every "address" a review round, opened by his click when no review opened one.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "Approaches considered → PR comments" and "2. PR comments" ("One click to address", "One click to finish").

**Read first:** `dashboard/lib/review-round.js` (the header comment; `candidatesOf` about l.214; `groupRounds` about l.285; `applyForeman` about l.385; `foremanMessage` about l.515; `sendPlan` about l.620; `reviewView` about l.688, its `asked` state and action labels about l.755–770; `createReviewRounds` about l.1028 and `actions` about l.1276: `fix`, `leave`, `send`, `act`), `dashboard/lib/pr-feedback.js` (the header comment; `isSummaryBot`; how it marks an item a round took), `dashboard/site/routes-job-page.js` (the `fix` and `fix-check` routes), `dashboard/site/routes-review.js`, `dashboard/runner/index.js` (the job page's `fix` and `fixCheck`, about l.2660–2710).

**Files:**
- Modify: `dashboard/lib/review-round.js`, `dashboard/lib/pr-feedback.js`, `dashboard/site/routes-job-page.js`, `dashboard/runner/index.js`
- Test: `dashboard/test/review-round.test.js`, `dashboard/test/review-round-server.test.js`, `dashboard/test/pr-comments-server.test.js`, `dashboard/test/pr-feedback-server.test.js`

**Interfaces:**
- `groupRounds`: a lone new comment or a lone failed check also opens a round (state `asked`). The joining rules are unchanged. So PR feedback parks no single-comment card; its record still marks each taken item `'round'`.
- New action `actions.address(slug, { pr, ids, note } = {})`, reachable as `reviewRounds.act(slug, 'address', body)`:
  1. The round to use on PR `pr`: its open round in state `asked`, `new-comment` or `check-failed`. Else a new one opened by his ask (`openedBy: 'you'`), holding every candidate that is unanswered, not his own, not from a summary bot (`isSummaryBot`) and not in an earlier round, plus the failed checks on the head. This is how comments that were on the PR before Starbase first looked get addressed.
  2. `ids`, when given, are the items included; the others in the round are left out, as unticking does today.
  3. Then exactly what `fix` does: the Foreman's message, state `fixing`, the Desk card dropped.
  4. A round already `fixing`, or a second call while the first is in flight: nothing more is sent, and the round as it stands is returned.
- A by-ask round's reviewer is the one author when every item has the same author, else `null`. With no reviewer, `foremanMessage` opens with `You asked to address N comments on PR #n: this is round k.` With a reviewer it opens as today.
- `sendPlan` leaves out its review-request step when the round has no reviewer or its reviewer is a bot (the item's `bot`, from Task B2).
- New route `POST /api/job/:slug/pr/:n/address { ids?: string[], note?: string }` → `{ round: number, state: string, sent: boolean }`. `POST …/pr/:n/fix { ids }` and `…/fix-check` call the same action with their ids; their row marks and audit lines stay.
- The round's fix action label, wherever `reviewView` gives it: `Address them` (was `Fix with the Foreman`). Its key on the Desk stays `a`.

**Tests to write first:**
- `review-round.test.js`:
  - `a lone comment opens a round`.
  - `address with no round opens one by your ask with every unanswered comment and the failed checks`: three comments seeded before the first look and one failed check give four items, state `fixing`, one message to the Foreman.
  - `address uses the asked round`.
  - `ids limit what is included; the rest are left out`.
  - `a round with no reviewer, or a bot reviewer, has no request step`.
  - `a by-ask round with several authors tells the Foreman: You asked to address 3 comments on PR #1: this is round 1.`
- `review-round-server.test.js`:
  - `address twice sends one message`: two calls in parallel; the fake Foreman receives one.
  - `a comment that arrives while the round is fixing joins it and sends nothing by itself`: state `new-comment`, the item is in the round's file.
  - `Address them on PR #2: fix, ready, Send back pushes, opens and merges the follow-up PR #1, posts the replies, resolves the threads`.
- `pr-feedback-server.test.js`: `a lone comment parks no single card`.
- `pr-comments-server.test.js`: `Fix these goes through a round: the rows say Fixing and the round is fixing`.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the four files one at a time; the new tests fail because `address` does not exist and a lone comment opens no round.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(server): every address runs as a review round, opened by his click when no review opened one`.

**Run:** `nice -n 15 node --test --test-timeout=240000 dashboard/test/review-round.test.js`, then the same command for `dashboard/test/review-round-server.test.js`, for `dashboard/test/pr-feedback-server.test.js` and for `dashboard/test/pr-comments-server.test.js`, one at a time, then `nice -n 15 npm test`.

**Done when:**
- A fix asked for from the job page, from the Desk or by the new route ends in the same place: a round in `fixing`, finished by the round's Send back.
- Two address calls at once send the Foreman one message.
- Nothing new is written to GitHub by this task: `address` only talks to the Foreman.
- A round with no reviewer or a bot reviewer never plans a review request.

### Task B6: The PR line in the payload

**Where it fits:** the job page is told about PR comments by `prMove` (`PR #1 · 3 new comments`), a link with no action. This task replaces it with `prAsk`: one line per job that says what a PR needs from him and the one action to take.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "2. PR comments" ("Visible where he types").

**Read first:** `dashboard/lib/job-payload.js` (`prMoveOf` about l.801; where `prMove` is put on the payload; the website's payload under `// ---------- The website's payload ----------`), `dashboard/lib/review-round.js` (`reviewView` and its states; `view(slug)`; `planFor(slug)` about l.1812; `actions.send`, `actions.merge`), `dashboard/lib/pr-comments.js` (`factsOf`, `lastOf`), `dashboard/runner/index.js` (where the page payload gets its PR facts, about l.2590–2600), `web/src/jobpage/types.ts`, `dashboard/test/mirror-shape.test.js`.

**Files:**
- Modify: `dashboard/lib/job-payload.js`, `dashboard/runner/index.js`, the mirror shape, `web/src/jobpage/types.ts`
- Test: `dashboard/test/job-payload.test.js`, `dashboard/test/mirror-shape.test.js`

**Interfaces:**
```ts
type PrAsk = null | {
  n: 1 | 2; number: number | null;
  state: 'stopped' | 'ready' | 'new' | 'sending' | 'fixing' | 'merge';
  line: string;                       // the words in the table below, built on the server
  comments: number; failing: number; fixed: number; since: string | null;
  next: null | { id: 'address' | 'send-back' | 'carry-on' | 'merge' | 'merge-admin'; label: string; go: string | null; says: string[]; expect: string[] | null; confirm: string | null };
};
```
- The payload gains `prAsk: PrAsk`. `prMove` stays on the payload in this task; Task B7 deletes it.
- One line per job: of PR #1 and PR #2, the one whose state comes first in this order: `stopped`, `ready`, `new`, `sending`, `fixing`, `merge`. `null` when neither needs him and nothing is under way.
- It is built from the round's view (`reviewView`), the rows' counts (`factsOf`) and, for `ready`, `planFor(slug)`: `says` and `expect` are its `steps`, so `send({ expect })` refuses a plan that changed since he looked, as it does today. `confirm` is the words `actions.merge` asks for (`Merge PR #2`); it is `null` for the other actions.
- In the website's payload, `next` is always `null`.

| State | From | `line` (exact; the PR, counts and names vary) | `next.label` → `next.go` |
|---|---|---|---|
| `new` | a round in `asked`, `new-comment` or `check-failed`, or unanswered rows with no round | `PR #2 · 3 comments to address`; one: `PR #2 · 1 comment to address`; with checks: `PR #2 · 3 comments to address · 1 check failing`; checks only: `PR #1 · 1 check failing` | `Address them` → `null` (one click) |
| `fixing` | a round in `fixing`, not ready | `PR #2 · the Foreman is fixing 3` | none |
| `ready` | `planFor(slug)` is not null | `PR #2 · 3 fixed · replies drafted` | `Send back…` → `Send back` |
| `sending` | Send back is running | `PR #2 · sending back · step 2 of 5` | none |
| `stopped` | Send back stopped part-way | `PR #2 · Send back stopped at step 3 of 5` | `Carry on` → `Try again from here` |
| `merge` | the view state `approved-you-merge` | `PR #2 · approved · yours to merge` | `Merge…` → `Merge PR #2` |

**Tests to write first** (`job-payload.test.js`):
- One test per row of the table, asserting `line` and `next` (and `expect` for `ready`, `confirm` for `merge`).
- `PR #1 new and PR #2 ready: the line is PR #2’s`.
- `the website’s payload carries prAsk with next null`.
- `no PR needs him: prAsk is null`.
- `mirror-shape.test.js` knows `prAsk`.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused files; they fail because the payload has no `prAsk`.
- [ ] **Step 3:** Implement `prAskOf` and pass it what it needs from the runner.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(server): the page payload names the one PR line and its one action`.

**Run:** `nice -n 15 node --test --test-timeout=240000 dashboard/test/job-payload.test.js dashboard/test/mirror-shape.test.js`, then `npm run typecheck -w web`, then `nice -n 15 npm test`.

**Done when:**
- Every `line` in the table is produced exactly, including the one-comment and checks-only forms.
- `next.expect` for `ready` equals `planFor(slug).steps`.
- The website's payload never carries an action.
- `prMove` is still on the payload (the page still reads it until Task B7).

### Task B7: The PR line in the prompt

**Where it fits:** the payload now says what a PR needs (`prAsk`, Task B6). This task shows it as one line with one button, directly above the Foreman's ask in the prompt, and retires the old `PR #n · k new comments` link.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "1. One prompt" (the sketch) and "2. PR comments" ("Visible where he types", "One click to address", "One click to finish").

**Read first:** `web/src/jobpage/left/Prompt.tsx`, `web/src/jobpage/left/YourMove.tsx` (`PrMoveLine`, `hasPr`), `web/src/jobpage/left/AsksRow.tsx` and `web/src/jobpage/asks.ts` (the `Sent · Undo` rule and its four seconds: reuse it, do not write a second timer), `web/src/jobpage/types.ts` (`PrAsk`, `ReaderTarget`), `web/src/jobpage/reader/PrView.tsx` (how it reads `githubDown`), `dashboard/lib/job-payload.js` (`prMove`, `prMoveOf`).

**Files:**
- Create: `web/src/jobpage/left/PrAsk.tsx`, `web/src/jobpage/left/PrAsk.test.tsx`
- Modify: `web/src/jobpage/left/Prompt.tsx`, `web/src/jobpage/left/YourMove.tsx` (delete `PrMoveLine` and `hasPr`), `web/src/jobpage/types.ts` (delete `prMove`), `dashboard/lib/job-payload.js` (delete `prMove` and `prMoveOf`), the mirror shape, `web/src/jobpage/jobpage.css`, `web/src/theme/controlRules.test.ts`
- Test: `web/src/jobpage/left/PrAsk.test.tsx`, `web/src/jobpage/left/YourMove.test.tsx`, `web/src/jobpage/left/Prompt.test.tsx`, `dashboard/test/job-payload.test.js`, `dashboard/test/mirror-shape.test.js`

**Interfaces:**
- Consumes: `payload.prAsk` (shape in `web/src/jobpage/types.ts`); `POST /api/job/:slug/pr/:n/address { ids?, note? }`; `POST /api/review/:slug/send { go: true, expect }`; `POST /api/review/:slug/merge { go: true, confirm }`.
- Produces: `PrAsk({ onOpen, at }: { onOpen?(t: ReaderTarget, from?: HTMLElement | null): void; at: 'prompt' | 'view' })`. It draws `prAsk.line`, the `next` button, and `Look` (opens `{ kind: 'pr', id: String(n) }`). With `at: 'view'` there is no `Look`. It draws nothing when `prAsk` is `null`. Task B8 mounts it with `at: 'view'`.
- `Prompt` mounts `<PrAsk at="prompt" onOpen={onOpen} />` between `NowLine` and `.jp2-ask`, at every width.

**Rules (exact):**
- `Address them`: one click. The line says `Sent · Undo` for four seconds; Undo in that time posts nothing; after it, one `POST …/address` with no `ids`. A second click in that time changes nothing. Title: `Sends the Foreman every comment and failed check listed here: it fixes each on the branch, one commit each, and drafts a reply to each. Nothing goes to GitHub until you press Send back.`
- `Send back…`, `Merge…` and `Carry on`: the first click opens the confirm in place, above the box: each `says` line, then the `go` button (primary) and `Not yet`. The second click posts once: Send back and Carry on post `/send` with `{ go: true, expect }`; the merge posts `/merge` with `{ go: true, confirm }`. A refusal (409, the steps changed) shows the server's words and reloads the page payload.
- GitHub not reachable (`githubDown`): the line stays, its button is off and its title says why.
- On the website (`next` is `null`): the line, then `Your laptop does this.`

**Tests to write first:**
- `PrAsk.test.tsx`:
  - `each state draws its line and its one button`: a table over the six states.
  - `Address them posts once after four seconds; a second click in that time changes nothing; Undo posts nothing`.
  - `Send back… lists what goes, then posts once with the steps it showed`.
  - `Merge… posts once with the confirm words`.
  - `a refused Send back says why and asks for the page again`.
  - `GitHub not reachable: the line stays, the button is off and says why`.
  - `the website shows the line and no button`.
  - `at the top of the PR view there is no Look`.
- `Prompt.test.tsx`: `the PR line sits between the status line and the ask`.
- `YourMove.test.tsx`: `Your move draws no PR line`.
- `job-payload.test.js`: the payload has no `prMove`.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused files; they fail because `PrAsk` does not exist and `PrMoveLine` is still drawn.
- [ ] **Step 3:** Build `PrAsk.tsx`, mount it, delete `PrMoveLine`, `hasPr`, `prMove` and `prMoveOf`.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(job page): a PR that needs him is one line above the box with one button`.

**Run:** `nice -n 15 npm run web:test -- --maxWorkers=3 src/jobpage/left/PrAsk.test.tsx src/jobpage/left/Prompt.test.tsx src/jobpage/left/YourMove.test.tsx`, then `nice -n 15 node --test --test-timeout=240000 dashboard/test/job-payload.test.js dashboard/test/mirror-shape.test.js`, then `npm run typecheck -w web`, then `nice -n 15 npm run web:test`, then `nice -n 15 npm test`.

**Done when:**
- A PR that needs him shows as exactly one line in the prompt, with at most one action button and `Look`.
- No press posts twice: `Address them` within its four seconds, and each confirm.
- Nothing is written to GitHub without the second click on a `go` button.
- `prMove`, `prMoveOf`, `PrMoveLine` and `hasPr` are gone from the code (`grep -rn "prMove\|PrMoveLine\|hasPr" dashboard/lib web/src` is in the report).

### Task B8: The PR view, the PR lines and the Ship step

**Where it fits:** the prompt now has the PR line (Task B7). This task puts the same line at the top of the PR view, lets him address one comment or the ticked ones from there, and shows a comment count on the laptop's PR lines and on the Ship step.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "2. PR comments" ("Visible where he types", "One click to address").

**Read first:** `web/src/jobpage/reader/PrView.tsx` (the bar and its `Fix these` button; the rows; `ticked`; the reply box and `Post it`), `web/src/jobpage/reader/PrRound.tsx` (`ELSEWHERE`: the actions it hides), `web/src/jobpage/left/PrAsk.tsx`, `web/src/jobpage/left/PrLines.tsx`, `web/src/jobpage/left/Steps.tsx` (the Ship cell's word).

**Files:**
- Modify: `web/src/jobpage/reader/PrView.tsx`, `web/src/jobpage/left/PrLines.tsx`, `web/src/jobpage/left/Steps.tsx`, `web/src/jobpage/reader/prview.css` or `web/src/jobpage/left/prlines.css` (whichever holds the rules you change)
- Test: `web/src/jobpage/reader/PrView.test.tsx`, `web/src/jobpage/left/PrLines.test.tsx`, `web/src/jobpage/left/Steps.test.tsx`

**Interfaces:**
- Consumes: `PrAsk` with `at: 'view'`; `POST /api/job/:slug/pr/:n/address { ids }`; `payload.prAsk`.

**Rules (exact):**
- PR view: `<PrAsk at="view" />` at the top, when `prAsk.n` is the PR shown. `PrRound.tsx` keeps hiding the actions in `ELSEWHERE`: `PrAsk` is where they are.
- The bar's primary button is `Address ticked (k)`, where k is the number ticked (was `Fix these`). It posts `/address` with the ticked ids. Its title is today's, ending `Nothing goes to GitHub until you press Send back.`
- Each row in state `new` has a quiet button `Address this`, which posts `/address` with `{ ids: [that row's id] }`.
- A row's reply box and `Post it` stay, for a comment he answers by hand.
- Laptop PR lines (`PrLines.tsx`): a line whose PR has comments ends in a link that opens that PR's view: `3 comments ›`, or `2 new ›` when some are new.
- The Ship cell in the steps row (`Steps.tsx`): its word is `3 comments` (`1 comment`) while `prAsk.state === 'new'` and `prAsk.comments > 0`, in place of the PR's state word.

**Tests to write first:**
- `PrView.test.tsx`: `the PR line sits at the top of the PR view`; `the bar says Address ticked (2) and posts those two ids to /address`; `Address this posts that one id`; `a row answered by hand can still be posted with Post it`.
- `PrLines.test.tsx`: `a PR line with 3 comments ends in 3 comments › and opens the PR view`; `with 2 new it says 2 new ›`; `a PR with no comments has no link`.
- `Steps.test.tsx`: `Ship’s word is 3 comments while they are new`; `Ship’s word is the PR’s state when nothing is new`.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused files; they fail because the bar says `Fix these` and the lines carry no count.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(job page): address one comment or the ticked ones from the PR view, and see the count on the PR lines`.

**Run:** `nice -n 15 npm run web:test -- --maxWorkers=3 src/jobpage/reader/PrView.test.tsx src/jobpage/left/PrLines.test.tsx src/jobpage/left/Steps.test.tsx`, then `npm run typecheck -w web`, then `nice -n 15 npm run web:test`.

**Done when:**
- From the PR view he can address everything (the line), the ticked ones (the bar) or one (the row), and all three post to `/address`.
- No button in the PR view still says `Fix these`.
- The comment count is on the laptop's PR line and opens the PR view.

### Task B9: He hears about it once, by name

**Where it fits:** when PR comments arrive, the notification today says "A question for you." This task makes it name the PR and what arrived, once per round.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "2. PR comments" ("the notification names the PR and the job").

**Read first:** `dashboard/runner/index.js` (`tellPermission` about l.2340; `noticeBody`; where a round's Desk card is raised), `dashboard/lib/review-round.js` (where a round's card is parked and its words; `countWords`), `dashboard/test/notify.test.js`.

**Files:**
- Modify: `dashboard/runner/index.js`, `dashboard/lib/review-round.js`
- Test: `dashboard/test/notify.test.js`, `dashboard/test/review-round-server.test.js`

**Rules (exact):**
- One notification when a round opens, and one when new comments join a round that is not being fixed. None for his own comments, none for summary bots, none while he is looking at Starbase (today's rule for that).
- Title: the job's title. Body, by case:
  - one reviewer asked for changes: `Raj asked for changes on PR #2 · 4 comments` (the reviewer's name as the round has it);
  - one reviewer left comments: `Raj left 2 comments on PR #1`;
  - several authors or none: `3 comments on PR #1 to address` (`1 comment on PR #1 to address`);
  - a failed check alone: `A check failed on PR #1`.
- A PR's notification never says `A question for you.`

**Tests to write first:**
- `notify.test.js`: one test per body form above.
- `review-round-server.test.js`: `ten comments in one review tell him once`; `his own comment tells him nothing`; `a comment joining a round that is being fixed tells him nothing`.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused files; they fail because the body is `A question for you.`
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(server): a PR comment’s notification names the PR and what arrived`.

**Run:** `nice -n 15 node --test --test-timeout=240000 dashboard/test/notify.test.js`, then `nice -n 15 node --test --test-timeout=240000 dashboard/test/review-round-server.test.js`, then `nice -n 15 npm test`.

**Done when:**
- Each body form is produced exactly.
- One review with many comments tells him once.
- Notifications for a permission or a Foreman question are unchanged.

### Task B10: The skills say the same

**Where it fits:** Starbase now opens a review round when he asks to address PR comments (Task B5). The Foreman's skills only describe rounds a reviewer opened. This task makes the skills match, in the skills repository.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "2. PR comments".

**Read first, in the worktree `/Users/moxie/Projects/claude-feature-workflow-pr2` (branch `feature/pr-address`):** `common/skills/workflow-common/notes-and-comments.md` (the section "PR comments"), `tools/skills/ship/review-rounds.md` (the section "The steps"), `tools/skills/ship/SKILL.md` (the review-round section). In the Starbase worktree: `dashboard/lib/pr-comments.js` (how it parses the `--- Comments answered ---` block).

**Files (all in `/Users/moxie/Projects/claude-feature-workflow-pr2`, on `feature/pr-address`; you do not work in the Starbase worktree in this task, except to run one test):**
- Modify: `common/skills/workflow-common/notes-and-comments.md`, `tools/skills/ship/review-rounds.md`

**Rules, written in the skills' own voice:**
- A round can be opened by the person's ask, with no reviewer.
- A request typed in words ("address the PR comments", "pull the comments and fix them") is handled as a round: read with `gh` (the comments, the reviews, the conversation, and which threads are resolved), say the plan, fix with one commit per item, run the checks, draft a reply per comment, and end with the `--- Comments answered ---` block exactly as the skill already defines it.
- Threads resolved on GitHub and the person's own comments are skipped.
- Never push, reply, resolve, ask for a review or merge: Send back does those after the person's yes.
- Do not change the format of the `--- Comments answered ---` block.

- [ ] **Step 1:** Confirm the worktree is on `feature/pr-address` (`git -C /Users/moxie/Projects/claude-feature-workflow-pr2 branch --show-current`). If it is not, stop and report BLOCKED.
- [ ] **Step 2:** Edit the two files.
- [ ] **Step 3:** In the Starbase worktree run `nice -n 15 node --test --test-timeout=240000 dashboard/test/pr-comments.test.js`: the block the skill describes is still the block Starbase parses.
- [ ] **Step 4:** Commit the two files by name on `feature/pr-address`: `docs(skills): a review round can be opened by the person’s ask`. Do not merge, do not push.

**Run:** `nice -n 15 node --test --test-timeout=240000 dashboard/test/pr-comments.test.js` (in the Starbase worktree).

**Done when:**
- The diff touches only those two files, in that worktree, on that branch.
- The block's format in the skill is unchanged, character for character.
- Nothing in the new text lets the Foreman push, reply, resolve, request a review or merge by itself.

### Task B11: The PR path in a browser

**Where it fits:** the last task of the PR part. It proves in a real browser, against a fake GitHub, that a comment arrives without a click, is addressed with one click and is sent back with one more, and it leaves a demo he can click through.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "2. PR comments".

**Read first:** `web/e2e/prPath.mjs` (the header: how it scripts the demo job with PR comments on its own port, and `KEEP=1`), `web/e2e/lib/fakeGh.cjs`, `docs/guide/07-shipping.md`, `package.json` (the scripts).

**Files:**
- Modify: `web/e2e/prPath.mjs`, `web/e2e/lib/fakeGh.cjs`, `package.json` (add the script `"demo:pr": "KEEP=1 node web/e2e/prPath.mjs"`), `docs/guide/07-shipping.md`

**Rules:**
- The fake `gh` also serves: a comment from a bot (`coderabbitai[bot]`), one thread that is resolved, and the `repos/<repo>/pulls/<n>` object the watch reads, whose `review_comments` and `updated_at` change when a comment is added.
- `prPath.mjs` walks this path and fails if a step does not happen: a comment is added to the fake after the page is open and shows on the page with no click on Pull now (the script may shorten the watch's time for the test through the environment, not by changing the default); the prompt's line says `PR #1 · 1 comment to address` (with the right count); `Address them`; the demo Foreman fixes; the line says the replies are drafted; `Send back…` lists the steps; `Send back`; the replies are posted to the fake; the resolved thread's row says `Resolved on GitHub`; the bot's row says `bot`.
- The guide's page says, in its plain style: comments show up by themselves within about half a minute on the job that is open; `Address them` sends them to the Foreman; `Send back` pushes, replies and resolves after his yes.

- [ ] **Step 1:** Extend the fake `gh`.
- [ ] **Step 2:** Extend `prPath.mjs` with the path above.
- [ ] **Step 3:** `npm run web:build`, then `node web/e2e/prPath.mjs`. Fix what fails; if the fault is in product code from Tasks B1 to B9, fix it there and say so in the report.
- [ ] **Step 4:** Edit the guide page; run `nice -n 15 node --test --test-timeout=240000 dashboard/test/docs.test.js`.
- [ ] **Step 5:** Run the rest of the Run line. Commit: `test(e2e): comments arrive, Address them, Send back`.

**Run:** `npm run web:build`, then `node web/e2e/prPath.mjs`, then `nice -n 15 node --test --test-timeout=240000 dashboard/test/docs.test.js`, then (only if product code changed) `nice -n 15 npm test` and `nice -n 15 npm run web:test`.

**Done when:**
- `prPath.mjs` passes and its output is in the report.
- The script never presses Pull now on the way.
- `npm run demo:pr` leaves the demo running with PR comments to click through (say the address in the report).
- The watch's default times in `pr-watch.js` are unchanged.

---

## Phase C. A Desk that agrees with the job page

### Task C1: The server says whose turn it is

**Where it fits:** the first of three tasks that keep the Desk in step with the job page. Today a job whose Go was accepted, held for the usage limit, or followed by a waiting message still counts as waiting for him. This task has the server say, per job, whether it is his turn.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "What Starbase does today → The Desk" and "3. A Desk that agrees with the job page".

**Read first:** `dashboard/runner/index.js` (the job card, about l.1000–1062: `needsYou`, `working`, `waitingFor`; `heldReply` and `waiting` about l.1350; `waitingMessages` about l.195 and l.1453), `dashboard/lib/queued.js`, `dashboard/test/helpers/dashboard.js`, `dashboard/test/mirror-shape.test.js`, `web/src/api/types.ts` (`Job`).

**Files:**
- Modify: `dashboard/runner/index.js`, the mirror shape, `web/src/api/types.ts` (`Job.yourTurn?: boolean`)
- Create: `dashboard/test/desk-turn.test.js`

**Interfaces:**
- Each job card gains `yourTurn: boolean`. It is `true` only when the job waits for him (a go-ahead, questions, a reply to give, or a permission card) and none of these holds: a reply is running for the job; a reply is held for the usage limit (`limits.heldFor(f.dir)`); a message waits behind a reply (`waitingMessages.get(f.dir)`).
- The board is told (the snapshot's change event) whenever one of those three changes, in the same tick as the action's answer, so a second client sees it without waiting for a timer.
- A fourth case, a decision made on the website that the laptop has not taken yet, is known only to the website; Task C2 handles it there. Do not add it here.

**Tests to write first** (`desk-turn.test.js`, each reading the board the way the Desk does):
- `a job at a go-ahead is his turn`.
- `Go is accepted: not his turn at once, before the Foreman has said a word`.
- `Go held for the usage limit: not his turn`.
- `a message sent at a go-ahead: not his turn while the reply runs; his turn again when it ends and the go-ahead still waits`.
- `a message waiting behind a running reply: not his turn`.
- `a Go refused (a newer brief): still his turn`.
- `a reply that errors before the Foreman read the Go: his turn again`.
- `two Go posts at once: one is accepted, and it is not his turn`.
- `a permission answered: its card is gone from the board at once`.
- `Address them: the round’s Desk card is gone at once` (`POST /api/job/:slug/pr/:n/address`).

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the new file; the tests fail because the card has no `yourTurn`.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(server): each job says whether it is his turn`.

**Run:** `nice -n 15 node --test --test-timeout=240000 dashboard/test/desk-turn.test.js dashboard/test/mirror-shape.test.js`, then `npm run typecheck -w web`, then `nice -n 15 npm test`.

**Done when:**
- `yourTurn` turns false in the same tick an action is accepted, and true again when the action fails or the Foreman asks again.
- `needsYou` and the other card fields are unchanged (other screens still read them).
- The website's mirror carries `yourTurn`.

### Task C2: One queue on the web

**Where it fits:** the Desk's list, the top bar's number, the job header's `Next · n wait` and the tab title are worked out in separate places with different rules, so they disagree. This task gives them one function, which also honours the server's `yourTurn`.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "3. A Desk that agrees with the job page".

**Read first:** `web/src/home/homeModel.ts` (`deskQueue` about l.422), `web/src/home/nudges.ts` (`DeskEntry`, `deskEntries`, `isShipping`), `web/src/home/DeskView.tsx` (about l.420–430: `settled`, `useReviewList`, `reviewing`, `ROUND_NUDGES`), `web/src/app/TopBar.tsx` (`deskCountOf` about l.48–56), `web/src/home/HomeView.tsx` (about l.60–66), `web/src/home/DeskPage.tsx`, `web/src/jobpage/left/Header.tsx` (`NextNeedsYou`), `web/src/home/findJobs.ts` (`nextNeedsYou`, `needsYouCount`), `web/src/alerts/useAlerts.ts` (`titleFor`), `web/src/views/Hosted/HostedWorkshop.tsx` and `web/src/views/Hosted/QueuedDecision.tsx` (`isOpen`, `queuedOf`).

**Files:**
- Create: `web/src/home/deskOpen.ts`, `web/src/home/deskOpen.test.ts`
- Modify: `web/src/home/homeModel.ts`, `web/src/app/TopBar.tsx`, `web/src/home/HomeView.tsx`, `web/src/home/DeskPage.tsx`, `web/src/home/DeskView.tsx`, `web/src/jobpage/left/Header.tsx`, `web/src/alerts/useAlerts.ts`, `web/src/views/Hosted/HostedWorkshop.tsx`
- Test: `web/src/home/deskOpen.test.ts`, and the existing tests beside each modified file

**Interfaces:**
```ts
/** reviewing: slugs with a review round. queued: slugs with a decision made on the website that the laptop has not taken yet. */
export interface DeskFacts { reviewing?: ReadonlySet<string>; queued?: ReadonlySet<string> }
/** Everything the Desk lists, in its order: the decisions, the nudges before the finish line, then Shipping. */
export function deskOpen(jobs: readonly Job[], permissions: readonly Permission[], facts?: DeskFacts): DeskEntry[];
/** The number every screen shows: deskOpen without the Shipping entries. */
export function deskCount(jobs: readonly Job[], permissions: readonly Permission[], facts?: DeskFacts): number;
/** The job that has waited longest for him other than `except`, and how many wait. */
export function nextUp(jobs: readonly Job[], permissions: readonly Permission[], except: string | null, facts?: DeskFacts): { slug: string; title: string; count: number } | null;
```
- `deskQueue` skips a job whose `yourTurn === false`. `yourTurn === undefined` (an older server, the first paint) counts as his turn. A permission card is listed whatever the job's turn.
- `reviewing`: a job with a review round shows the round's card and not its PR nudges (`ROUND_NUDGES`). Today only `DeskView.tsx` applies this, so the top bar counts nudges the list hides. The rule moves into `deskOpen`.
- `queued`: on the website, the slugs whose queued decision is still open (`isOpen`). Such a job is not his turn. The laptop passes none.
- The Desk's list, the top bar's number, the Jobs page's Desk count, the header's `Next` and the tab title call these and nothing else. `DeskView`'s own `settled` set stays on top of `deskOpen`, for the instant between his click and the server's answer.

**Tests to write first:**
- `deskOpen.test.ts`: `a job that is not his turn is not listed and not counted`; `yourTurn undefined counts as his turn`; `a permission card is listed whatever the job’s turn`; `Shipping entries are listed and not counted`; `nextUp skips the open job and jobs that are not his turn`; `a job with a review round counts once: its round, not its PR nudges`; `a job with an open queued decision is not listed`.
- One table test that renders `TopBar`, `HomeView`, the header's `Next` and the tab title for the same state: `the four numbers agree`.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused files; they fail because `deskOpen.ts` does not exist.
- [ ] **Step 3:** Implement, and move every caller.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `fix(web): one Desk queue for the list, the top bar, the header and the tab title`.

**Run:** `nice -n 15 npm run web:test -- --maxWorkers=3 src/home src/app src/alerts`, then `nice -n 15 npm run web:test -- --maxWorkers=3 src/jobpage/left`, then `npm run typecheck -w web`, then `nice -n 15 npm run web:test`.

**Done when:**
- No screen computes a Desk number or list any other way (`grep -rn "deskEntries(\|deskQueue(\|needsYouCount(" web/src` outside `deskOpen.ts`, `homeModel.ts`, `nudges.ts`, `findJobs.ts` and tests is in the report, and is empty or explained).
- The four numbers agree for the same state, including a job with a review round.
- The memo in `TopBar.tsx` still keeps the count from being recomputed on every event.

### Task C3: Two screens agree

**Where it fits:** the last Desk task. It proves in a real browser, with the Desk in one page and a job in another, that what he settles in the job leaves the Desk.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "3. A Desk that agrees with the job page".

**Read first:** `web/e2e/prPath.mjs` (how a script starts its own demo server on its own port, with the fake `gh`), `web/e2e/noJump.mjs`, `dashboard/demo/run-demo.js` (which demo jobs wait at a go-ahead).

**Files:**
- Create: `web/e2e/deskAgree.mjs`

**Rules:** the script starts its own demo server on its own port, as `prPath.mjs` does, opens two pages (the Desk and a job that waits at a go-ahead) and fails unless:
1. Go pressed on the job page: within 2 seconds the job's row is gone from the Desk page and the top bar's number is one lower in both pages.
2. On another job at a go-ahead, a message typed and sent with Enter: the row is gone while the Foreman replies, and back when it asks again.
3. On a job with PR comments, `Address them`: the PR's entry is gone from the Desk page.
4. After each step, reloading the Desk page shows the same list and the same number.
5. The tab title's number equals the top bar's number at each step.

- [ ] **Step 1:** Write `web/e2e/deskAgree.mjs`.
- [ ] **Step 2:** `npm run web:build`, then `node web/e2e/deskAgree.mjs`. Fix what fails; if the fault is in product code from Tasks C1 or C2, fix it there and say so in the report.
- [ ] **Step 3:** Run the rest of the Run line. Commit: `test(e2e): what he settles in a job leaves the Desk`.

**Run:** `npm run web:build`, then `node web/e2e/deskAgree.mjs`, then (only if product code changed) `nice -n 15 npm test` and `nice -n 15 npm run web:test`.

**Done when:**
- `deskAgree.mjs` passes and its output is in the report.
- The script waits on what the page shows, with a 2-second limit, not on fixed sleeps.
- The script stops the server it started.

---

## Phase D. PR #2 without Raj's approval

### Task D1: The route and the nudges

**Where it fits:** the owner now has admin access to the Orbit repository and merges PR #2 (the org branch into staging) himself. Starbase still tells him to ask Raj for a review. This task makes the Desk's PR nudges follow the repository's route instead of a hard-coded name.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "4. PR #2 without Raj's approval".

**Read first:** `dashboard/profiles/orbit.md` (the `prRoute` lines, about l.23–26), `dashboard/lib/review-round.js` (`parseRoute` about l.115–155; `routeStep`), `dashboard/lib/nudges.js` (the whole file: `nudgesFor` about l.72, the nudge ids `pr1-merge`, `pr2-open`, `pr2-review`, `pr2-changes`, `pr2-merge`), `dashboard/lib/pr-lines.js` (`second()` about l.179–183; `PR_SENTENCES`; `PR2_REVIEW_SENTENCE`; `ACTION_NUDGE`), `dashboard/runner/index.js` (the call to `nudgesFor` about l.1055; `profileFor`), `web/src/home/nudges.ts`.

**Files:**
- Modify: `dashboard/profiles/orbit.md`, `dashboard/lib/nudges.js`, `dashboard/lib/pr-lines.js`, `dashboard/runner/index.js`, `web/src/home/nudges.ts` (only if a name is hard-coded there)
- Test: `dashboard/test/nudges.test.js`, `dashboard/test/nudges-server.test.js`, `dashboard/test/pr-lines.test.js`

**Rules (exact):**
- `orbit.md`, the PR #2 route line becomes: `  - "PR #2: the moxie branch into staging (you merge it)"`. In the notes under the settings, add one line: a review from Raj (`@rajmehta0311`) is asked for only when the owner says so.
- `nudgesFor(card, lane, { finishLine, dismissed, sent, inRound, route })`. `route` is `parseRoute`'s output for the job's repository; the runner passes it. With `who` = the name of PR #2's reviewer in the route, or `null`:
  - **`who` is `null` and the route says he merges PR #2** (Orbit now): no `pr2-review` nudge. PR #2 open, not a draft, checks not failing → `pr2-merge`, title `Merge PR #2`, text `PR #2 (#n) is open and its checks pass. You merge it: no approval is needed.` Changes requested by anyone → `pr2-changes`, title `Address the review on PR #2`.
  - **`who` is named** (another repository's route): today's three nudges, with the route's name where the word Raj is now: `Ask ${who} for a review?`, `${who} approved PR #2…`, `Address ${who}’s review on PR #2`, and the sentence `Please request ${who}’s review on PR #2.`
- `pr-lines.js` `second()`: `request-review` is offered only when the route names a reviewer, with that name in its words.
- Afterwards no string a person reads in `dashboard/lib` or `web/src` contains `Raj`, except a name read from a route or from GitHub.

**Tests to write first:**
- `nudges.test.js`: `Orbit’s route: an open PR #2 with passing checks is his to merge, and nobody is asked for a review`; `failing checks: no merge nudge`; `a draft PR #2: no merge nudge`; `changes requested: Address the review on PR #2`; `a route that names a reviewer keeps the three nudges with that name`.
- `pr-lines.test.js`: `the PR line offers Request review only when the route names a reviewer`.
- `nudges-server.test.js`: `the runner passes the repository’s route: an Orbit job’s card has no pr2-review nudge`.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused files; they fail because the nudges ignore the route and say Raj.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(server): PR #2 follows the route: on Orbit he merges it and no approval is asked for`.

**Run:** `nice -n 15 node --test --test-timeout=240000 dashboard/test/nudges.test.js dashboard/test/pr-lines.test.js`, then `nice -n 15 node --test --test-timeout=240000 dashboard/test/nudges-server.test.js`, then `nice -n 15 npm test`.

**Done when:**
- `grep -rn "Raj" dashboard/lib web/src --include="*.js" --include="*.ts" --include="*.tsx" | grep -v "\.test\."` shows only comments; the output is in the report.
- With Orbit's profile, a job with an open PR #2 and passing checks gets `pr2-merge` and never `pr2-review`.
- A route that names a reviewer behaves as before, with that name.
- PR #3 and PR #1 nudges are unchanged.

### Task D2: Merging PR #2 from Starbase

**Where it fits:** Task D1 tells him PR #2 is his to merge. This task lets him do it from Starbase with one confirmed click, and handles GitHub still asking for a review.

**Design:** `docs/plans/2026-11-18-one-prompt-design.md`, "4. PR #2 without Raj's approval" and "Calls I made" 8.

**Read first:** `dashboard/lib/review-round.js` (`reviewView`, the state `approved-you-merge`; `actions.merge` about l.1750; `needState`; `yesFor`), `dashboard/lib/gh-write.js` (`mergePr`), `dashboard/lib/job-payload.js` (`prAskOf`, the `merge` row), `web/src/jobpage/left/PrAsk.tsx` (how it posts a merge), `docs/guide/07-shipping.md`.

**Files:**
- Modify: `dashboard/lib/review-round.js`, `dashboard/lib/gh-write.js`, `dashboard/lib/job-payload.js`, `web/src/jobpage/left/PrAsk.tsx` (only to send `admin: true` for `merge-admin`), `docs/guide/07-shipping.md` and any other guide page that says Raj reviews or merges PR #2 (`grep -rn "Raj" docs/guide`)
- Test: `dashboard/test/review-round.test.js`, `dashboard/test/gh-write.test.js`, `dashboard/test/job-payload.test.js`, `web/src/jobpage/left/PrAsk.test.tsx`, `dashboard/test/docs.test.js`

**Rules (exact):**
- A PR with no open round, whose route step lets him merge and names no reviewer, that is open, not a draft, with passing checks and no conflicts, has the view state `you-merge`. Headline: `PR #2 · checks passing · yours to merge`. One action `merge`, go `Merge PR #2`, says: `PR #2 (#n): <org branch> into staging`; `Head <sha7> · checks passing`; `A merge commit` or `Squashed` (as the route says); `Starbase merges it on GitHub. Nothing else changes.`
- `actions.merge(slug, { go, confirm, admin })` accepts `you-merge` as it accepts `approved-you-merge`, with the same `go: true` and `confirm` (`Merge PR #2`, case ignored).
- `prAsk` for `you-merge`: state `merge`, line `PR #2 · checks passing · yours to merge`, `next` = `{ id: 'merge', label: 'Merge…', go: 'Merge PR #2', says, expect: null, confirm: 'Merge PR #2' }`.
- **GitHub still asks for a review** (the PR's `reviewDecision` is `REVIEW_REQUIRED`, or the last merge was refused with words saying a review is required): the view has `needsReview: true` and says `GitHub still asks for an approving review before this merges.` Then `prAsk` is: line `PR #2 · checks passing · GitHub still asks for a review`, `next` = `{ id: 'merge-admin', label: 'Merge as admin…', go: 'Merge PR #2 as admin', says: ['Uses your admin right on <org repo> to merge without the review GitHub asks for.', …the four lines above], expect: null, confirm: 'Merge PR #2 as admin' }`.
- `merge-admin` posts `{ go: true, confirm: 'Merge PR #2 as admin', admin: true }`. `actions.merge` refuses `admin` without that exact confirm (case ignored) and passes `admin: true` to `mergePr`, which runs `gh pr merge <n> --repo <org repo> --merge --admin` (`--squash` when the route says squash). It is audited as `review-merge-admin`.
- The guide says: PR #2 is his to merge once its checks pass; no approval is needed; a review is asked for only when he says so.

**Tests to write first:**
- `review-round.test.js`: `a route where he merges and nobody reviews: an open PR #2 with passing checks is his to merge`; `failing checks, a draft, or conflicts: not offered`; `the merge runs once, with his yes and the confirm words`; `GitHub asks for a review: Merge as admin is offered`; `admin without its own confirm words is refused`.
- `gh-write.test.js`: `merge with admin passes --admin`; `merge without admin never passes --admin`.
- `job-payload.test.js`: the two `prAsk` forms above.
- `PrAsk.test.tsx`: `Merge as admin… posts admin true with its confirm words after the second click`.

- [ ] **Step 1:** Write the tests above.
- [ ] **Step 2:** Run the focused files; they fail because `you-merge` does not exist.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Edit the guide; run the whole Run line; everything passes.
- [ ] **Step 5:** Commit: `feat(server): he can merge PR #2 from Starbase once its checks pass`.

**Run:** `nice -n 15 node --test --test-timeout=240000 dashboard/test/review-round.test.js dashboard/test/gh-write.test.js dashboard/test/job-payload.test.js dashboard/test/docs.test.js`, then `nice -n 15 npm run web:test -- --maxWorkers=3 src/jobpage/left/PrAsk.test.tsx`, then `npm run typecheck -w web`, then `nice -n 15 npm test`, then `nice -n 15 npm run web:test`.

**Done when:**
- `--admin` reaches `gh` only from the `merge-admin` action after its own confirm; no other path can set it.
- A merge never runs without `go: true` and the confirm words.
- With failing checks, a draft or conflicts, no merge is offered.
- `grep -rn "Raj" docs/guide` is in the report, and no line left says Raj reviews or merges PR #2.

---

## Phase E. Finish

### Task E1: Everything together

**Where it fits:** the last task. Every other task ran its own side's suite. This one runs everything once more on the finished branch, in a real browser too, and fixes what the combination broke.

**Read first:** the headers of `web/e2e/onePrompt.mjs`, `prPath.mjs`, `deskAgree.mjs`, `noJump.mjs`, `noEmptyScroll.mjs`, `themeSweep.mjs`, `contrast.mjs` and `jobSpeed.mjs` (each says how it runs).

**Files:** none planned. If a run fails, fix it in the file at fault and name the task that owns it in your report.

- [ ] **Step 1:** The whole server suite, alone: `nice -n 15 npm test`. Write the count in the report.
- [ ] **Step 2:** The whole web suite, alone: `nice -n 15 npm run web:test`, then `npm run typecheck -w web`. Write the count in the report.
- [ ] **Step 3:** `npm run web:build`.
- [ ] **Step 4:** Each browser script, one at a time, as its header says: `onePrompt.mjs`, `prPath.mjs`, `deskAgree.mjs`, `noJump.mjs`, `noEmptyScroll.mjs`, `themeSweep.mjs`, `contrast.mjs`, `jobSpeed.mjs`. Stop any demo you started by its process id.
- [ ] **Step 5:** Fix what failed; re-run what you fixed and the suite of the side you touched. Commit fixes by file name: `fix: <what>, found by the whole run`.

**Run:** Steps 1 to 4 are the run.

**Done when:**
- The report has the server count, the web count, the typecheck result, the build result and each script's result.
- Every one passes, or the report names the test, its output and why it is not from this branch.
- No fix widens what a task was asked to build.
