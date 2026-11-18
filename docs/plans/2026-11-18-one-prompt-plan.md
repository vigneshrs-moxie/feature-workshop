# One prompt, PR comments in one click, a Desk that agrees: plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

Written 18 Nov 2026 by the session that built "talk any time". That session is finished. **Everything in this file is for a new session on Opus.** Subagents run on Opus too (the owner's standing preference).

**Goal:** Make Starbase's job page as simple to talk to as Claude Code in a terminal: one place to type, PR review comments picked up fast and addressed in one click, a Desk that never shows what he already settled inside a job, and PR #2 merged by him without Raj's approval.

**Architecture:** Four parts, each shippable on its own. (A) Web only: the Foreman's ask moves from the top-left card into one prompt block above the single message box; Enter sends, a message never approves. (B) Server and web: a cheap per-PR watch triggers the existing GitHub read for one repository; every "address" runs as a review round (the one engine that already pushes, replies, resolves and asks again); the prompt shows one PR line with one button. (C) The server says whose turn a job is (`yourTurn`) and the web works out the Desk's queue in one function used by every count. (D) Orbit's PR route, the nudges and the skills stop naming Raj for PR #2.

**Tech stack:** Node 24 server in `dashboard/` (`node --test`), React 19 + TypeScript + Vite in `web/` (vitest, jsdom), Playwright scripts in `web/e2e/`, the `gh` CLI for every GitHub read and write, the workflow skills repository for the Foreman's instructions.

**Spec:** `docs/plans/2026-11-18-one-prompt-design.md` (beside this file). It has his words, what the code does today, the approaches, the design and the calls made for him. Read it before Task A1. Where this plan and the design disagree, the design wins and the difference goes in the ledger.

---

## Where things stand (18 Nov 2026, about 5 pm MST)

- **Live Starbase:** port 4477, launchd service `com.moxie.starbase`, runs `main` (`a900427`) from `/Users/moxie/Projects/feature-workshop`.
- **Built today, not live, not pushed:** branch `feature/talk-anytime` in the worktree `/Users/moxie/Projects/starbase-job-page`. It has: Send goes into a running reply (`POST /api/runs/:id/steer`), the status line above the box (`web/src/jobpage/left/NowLine.tsx`), the animated crew member on the step in progress, the header's `Try it` button, the branch and PR-line fixes, and the session-log speed fix. Server 2,415 tests and web 2,520 tests pass. This plan builds on it.
- **Skills, not merged (skills `main` is live through a link in `~/.claude/skills`):**
  - `/Users/moxie/Projects/claude-feature-workflow-pr2`, branch `feature/pr2-you-merge`, commit `3be3e55`: PR #2 needs no approval (Part D's skill text, already written).
  - `/Users/moxie/Projects/claude-feature-workflow-talk`, branch `feature/talk-anytime`, commit `231af6c`: the `/feature` paragraph "A message at any time". The owner doubts it; Task A6 rewrites it.
- **This work:** in `/Users/moxie/Projects/starbase-job-page`, a new branch `feature/one-prompt` cut from `feature/talk-anytime` (its head is the commit that added this plan and its design). If `main` already contains that branch (`git merge-base --is-ancestor feature/talk-anytime main`), cut from `main` instead.

## Read first, in this order

All paths under `/Users/moxie/Projects/starbase-job-page/` unless they start with `~` or `/`. Files in this codebase open with long design comments; they are accurate, read them before the code.

1. `docs/plans/2026-11-18-one-prompt-design.md`: the design.
2. `docs/superpowers/specs/2026-11-16-job-page-glance-layout-design.md`: why the laptop page is laid out as it is. Part A changes where Your move sits; the rest of that design stays.
3. `web/src/jobpage/JobPage2.tsx` (the header comment and the tree at the end), `left/YourMove.tsx`, `left/MessageBox.tsx`, `left/NowLine.tsx`, `left/AsksRow.tsx`, `left/gateBody.ts`.
4. `dashboard/lib/review-round.js` (header, `candidatesOf`, `groupRounds`, `reviewView`, `sendPlan`, `createReviewRounds` and its `actions`), `dashboard/lib/pr-comments.js`, `dashboard/lib/pr-feedback.js`, `dashboard/lib/pr-lines.js`, `dashboard/lib/flow.js`, `dashboard/lib/gh-write.js`, `dashboard/lib/nudges.js`.
5. `web/src/jobpage/reader/PrView.tsx`, `reader/PrRound.tsx`, `left/PrLines.tsx`; `web/src/home/homeModel.ts` (`deskQueue`), `home/nudges.ts`, `home/DeskView.tsx`, `app/TopBar.tsx`.
6. Skills: `/Users/moxie/Projects/claude-feature-workflow/tools/skills/ship/review-rounds.md` and `/Users/moxie/Projects/claude-feature-workflow/common/skills/workflow-common/notes-and-comments.md` ("PR comments").
7. Memory notes: `starbase-talk-anytime-build`, `starbase-ui-design-bar`, `prefers-summaries-first-ui`, `starbase-runs-main`, `subagents-stall-on-permission-prompts`.

## The owner's bar (his words, do not soften)

- "what i wanted was to be able to send a message at any point, it didnt have to be answered immediately."
- "it was getting hard to know how to do that with 3 or 4 different inputs … i wanted that to be simpler and basically closer to the claude code on the terminal experience."
- "make sure addressing github comments from reviews are easy and is super simple and picked up fast … just address them by clicking a button or something ideally."
- "if i address something for a job inside the job, then it shouldnt still show up at my desk as a number or a row"
- Earlier, still standing: "keep only useful things on the screen", "make everything move smooth and clean, fast like it was built for performance".

A page that passes its tests and still shows two places to type, or a Desk number that is off by one, has failed.

## Global constraints

**Safety and his laptop**
- Work only in `/Users/moxie/Projects/starbase-job-page` and in worktrees of the skills repository. Never edit `/Users/moxie/Projects/feature-workshop` (the running Starbase) or `/Users/moxie/Projects/claude-feature-workflow` (the live skills).
- No merge to `main`, no push, no rebuild or restart of the running Starbase, no `install.sh`, without the owner's word each time. A push to Starbase `main` deploys the website.
- The running Starbase may be read with GET only (`http://127.0.0.1:4477/api/...`). Never POST to it. Never print or store its token. Never run `starbase logout`.
- Tests and agents never read or write the real `~/.starbase`, never read a `.env` file, never call the real GitHub (`STARBASE_GH` points at the fake `web/e2e/lib/fakeGh.cjs` or a test's own), never touch `~/.claude/feature-work`, `~/Projects/orbit-*` or `~/Projects/moxie-portal*`.
- `.superpowers/` is untracked and holds his real conversation. Never `git add -A` or `git add .`; add files by name. No bare `git stash`. Never add `-vN` to a branch name.
- A test sample that looks like a secret is spelled in two parts (`'sk_' + 'live_…'`).
- **Every GitHub write stays behind his yes** (`dashboard/lib/gh-write.js` `yes()`). Nothing in this plan adds a write that runs by itself. Agents never merge.

**Running things**
- Every test command: `nice -n 15`. Server, one file: `nice -n 15 node --test --test-timeout=240000 dashboard/test/<file>`. Web, one file: `nice -n 15 npm run web:test -- --maxWorkers=3 <path under web/>`. Build: `npm run web:build`.
- **One suite at a time, with no builder testing beside it.** On 18 Nov, three test runs at once (load average 34) made these fail, and each passed alone: `site-link-queue.test.js` "timing: 5,000 events…", `web/src/jobpage/notes/Pointable.test.tsx` and `reader/ConversationView.test.tsx` speed tests, `web/src/panes/Foreman/ThreadCrew.test.tsx` snapshot. If one of them fails, run it alone before believing it.
- At most two agents building or testing at once; one writing agent per worktree. `dashboard/test/evidence-server.test.js` is run by one process at a time.
- Every dispatch to a subagent forbids deleting (`rm`), forbids subagents of its own, and names the files it may change.

**Code rules already enforced by tests**
- CSP `style-src 'self'`: no inline `style=` (`web/src/app/inlineStyle.test.ts`).
- Every stylesheet a source file imports is listed in `web/src/main.tsx` (`web/src/app/cssOrder.test.ts`). Put new rules in `web/src/jobpage/jobpage.css` unless a task says otherwise.
- Buttons, selects, radios and checkboxes come from `web/src/components/`; new files that draw buttons go on the list in `web/src/theme/controlRules.test.ts`.
- A new field on the job card or the page payload must be added to the website's mirror shape (`dashboard/test/mirror-shape.test.js` names where), or the website drops it.
- Speed rule 5 (the page's header comments): a component reads the store through a selector that returns a primitive or a stable string, so an unrelated event draws nothing.
- Say "Starbase" in every word a person reads. UI words are plain; a button says what it does.

**Commits:** one commit per task step that passes, subject in the repository's style (`feat(job page): …`, `fix(server): …`), ending with the co-author trailer your session's instructions give.

**Ledger:** keep `.superpowers/sdd/2026-11-18-one-prompt-plan/ledger.md` (untracked): each task's commit, test counts, and every call you made that this plan did not.

## Review focus

Inputs and conditions the design implies and that will bite him if missed. Each has its test in the task named.

1. **Typing with an input method** (accents, Japanese): Enter that confirms a composition must not send. Task A3.
2. **A second press**: `Address them`, `Send back` and Go pressed twice, or pressed on the Desk and on the job page at once, send once. Tasks B4, B6, C1.
3. **A comment that arrives while the Foreman is fixing** joins the round and is counted on the line; it is never lost and never starts a second message by itself. Task B4.
4. **GitHub not reachable** (`gh` signed out, no network, rate limit): the watch backs off and says why once; the page keeps the last read and its buttons say why they are off. Tasks B3, B6.
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
| `dashboard/lib/pr-watch.js` (new) | One cheap question per open PR; says when one changed. |
| `dashboard/lib/review-round.js` | Also opens a round by his ask (`address`), and offers the merge when the route lets him merge with no reviewer. |
| `dashboard/lib/flow.js` | Can read one repository (`only`). |
| `dashboard/lib/job-payload.js` | `prAsk` in place of `prMove`. |
| `dashboard/lib/nudges.js` | PR #2 nudges follow the route; no name is hard-coded. |
| `dashboard/runner/index.js` | Starts the watch; `yourTurn` on each job card; one shared PR read. |

---

## Phase A. One prompt (web only)

Look for the owner after this phase (Task A6). If he is not there, carry on with Phase B; his changes come in as a fix round.

### Task A1: The prompt frame

**Files:**
- Create: `web/src/jobpage/left/Prompt.tsx`, `web/src/jobpage/left/Prompt.test.tsx`
- Modify: `web/src/jobpage/JobPage2.tsx` (the tree, about lines 425–493; the `deciding` Splitter and `WIDTH.decide`), `web/src/jobpage/jobpage.css` (the wide grid, about lines 592–630 and 663–668), `web/src/jobpage/JobPage2.test.tsx`, `web/src/theme/controlRules.test.ts`
- Test: `web/src/jobpage/left/Prompt.test.tsx`, `web/src/jobpage/JobPage2.test.tsx`, `web/src/jobpage/phone/PhoneJob2.test.tsx` (must pass unchanged)

**Interfaces:**
- Produces: `Prompt({ job, boxRef, runner, lead, onLead, onOpen, phone }: PromptProps)`. It renders, in this order: `<AsksRow>`, `<NowLine>`, `<div className="jp2-ask">` holding `<YourMove job onOpen inPrompt />` (not on the phone), `<MessageBox boxRef onOpen stopElsewhere />`. Task B6 adds `<PrAsk>` between `NowLine` and `.jp2-ask`.
- Consumes: `YourMove`'s new prop `inPrompt?: boolean` (Task A2 gives it meaning; in this task it is passed and ignored).

**Layout rules (exact):**
- **Wide (1100 px and wider):** `Prompt` is the foot of `section.jp2-convo`, replacing the three elements there now. `.jp2-movewrap` keeps only `<PageProblem />`. The grid has no decision column: delete the `[data-deciding]` column rules, the `is-decide` `Splitter` and `--jp2-decide-w`. `deciding` still shows `DecideTabs` over the reader and still hides `StepPanel`. While `data-deciding` is set, the conversation column's default width is `clamp(360px, 32vw, 600px)` (else today's `clamp(320px, 28vw, 560px)`); a width he dragged (`--jp2-convo-w`) wins in both.
- **Mid (760–1100 px):** `Prompt` is the foot of `.jp2-left`, replacing the three elements there now. `YourMove` is no longer in `.jp2-movewrap`.
- **Phone:** unchanged. `YourMove` stays in `.jp2-movewrap` at the top of the job screen; `Prompt` gets `phone` and draws no `.jp2-ask`.
- `.jp2-ask`: `max-height: 50vh` (mid: `40vh`), `overflow-y: auto`, thin scrollbar; `.jp2-ask:empty { display: none }`. Its calls row (`.jp2-ym-calls`) is `position: sticky; bottom: 0` with the block's background, so Go and Send back always touch the box.
- Conversation hidden (`data-convo="hidden"`): the rule that hides the column's children also keeps `.jp2-ask` (`:not(.jp2-asks):not(.jp2-now):not(.jp2-ask):not(.jp2-mbw)`).

- [ ] **Step 1: Write the failing tests.** In `JobPage2.test.tsx` (use the file's existing wide/mid/phone helpers and its gate fixture):
  - `wide: the Foreman’s ask sits in the conversation column, directly above the message box`: `page.querySelector('.jp2-convo .jp2-ask')` holds the gate card; `page.querySelector('.jp2-ask + .jp2-mbw')` is not null; `page.querySelector('.jp2-movewrap .jp2-ym')` is null.
  - `wide: nothing waits: no ask block is drawn`: `.jp2-ask` has no child elements.
  - `wide: a decision no longer takes a column`: no element with class `is-decide`; `main.jp2` still has `data-deciding` and the reader still shows `DecideTabs`.
  - `mid: the ask sits in the left pane’s foot, above the box`.
  - `the conversation hidden: the ask, the status line and the box stay along the foot`.
  - `a width change from wide to mid keeps the draft and the picks` (type a draft, pick an option, change the width, read both back from the store and the DOM).
  In `Prompt.test.tsx`: `the order is quick asks, status line, ask, box` (compare `children` class names).
- [ ] **Step 2: Run them; they fail** (`nice -n 15 npm run web:test -- --maxWorkers=3 src/jobpage/JobPage2.test.tsx src/jobpage/left/Prompt.test.tsx`).
- [ ] **Step 3: Build `Prompt.tsx`, change the tree and the stylesheet** as the layout rules say. Update `JobPage2.tsx`'s header comment (the layout by width) to match.
- [ ] **Step 4: Run** `src/jobpage` and `npm run typecheck -w web`: all pass, `PhoneJob2.test.tsx` unchanged.
- [ ] **Step 5: Commit** (`feat(job page): the Foreman’s ask sits above the message box, in one prompt`).

### Task A2: The ask, compact, inside the prompt

**Files:**
- Modify: `web/src/jobpage/left/YourMove.tsx`, `web/src/jobpage/jobpage.css`
- Test: `web/src/jobpage/left/YourMove.test.tsx`

**Interfaces:**
- Consumes: `inPrompt` from Task A1.
- Produces: with `inPrompt`, `YourMove` returns `null` when nothing waits and nothing was asked (no `jp2-ym-one` line, no `StopReply`: the status line has both).

**Rules with `inPrompt`:**
- The card has no `jp2-card-label` (the status line says `Waiting for you · since …`) and no `jp2-card-happened` list (the reader shows the brief). The ask is whole: no one-line cut, no `More`.
- A question's options are one per row at every width.
- `AskedList` (what he asked) stays under the card.
- The `Sent · …` line (`jp2-ym-sent`) stays.
- Sizes: the ask 14px/20px weight 600; options 13px/18px. Colours from the existing tokens only.

- [ ] **Step 1: Failing tests:** `in the prompt, a job with nothing waiting draws nothing`; `in the prompt the card has no Needs-you label and shows the whole ask` (a 300-character ask has no `More` button and no ellipsis class); `in the prompt each option is its own row`; `Go and Send back are the last row of the ask block`; `outside the prompt (the phone) the card is as before` (label present).
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run `src/jobpage`; pass.**
- [ ] **Step 5: Commit** (`feat(job page): the ask is compact in the prompt, and says nothing when nothing waits`).

### Task A3: Enter sends, and a message never approves

**Files:**
- Modify: `web/src/jobpage/left/MessageBox.tsx` (`onKeyDown`, `pressSend`, `backNow`, the titles, the header comment), `web/src/jobpage/left/YourMove.tsx` (header comment: the keys)
- Test: `web/src/jobpage/left/MessageBox.test.tsx`, `web/src/jobpage/left/YourMove.test.tsx`

**Rules (exact):**
- Laptop (`!narrow`): Enter with no Shift and no Alt, and not composing (`e.nativeEvent.isComposing` false and `e.keyCode !== 229`), sends (`pressSend()`), and the default is prevented. Shift+Enter and Alt+Enter add a line.
- Phone (`narrow`): Enter adds a line; the Send button sends.
- ⌘↵ / Ctrl+↵, any width: with words or notes in the box it sends, exactly as Enter. With an empty box and no notes: Go when a go-ahead waits (`pressKey('jp-go')`), else nothing.
- ⌘↵ pressed inside the box with words must never reach the page's `jp-go` key (stop it there).
- `pressSend` at a go-ahead sends a message (`POST /api/job/:slug/send`, `{ kind: 'message', text }`), with any notes composed in front as `composeFor(notes, words)` does. The branch that turned Send into Send back when notes exist, and `backNow`, are removed: the Send button always says `Send` or `Send · n notes`.
- Send button on a laptop shows the key: `Send` then `<Kbd>↵</Kbd>` (`web/src/components/Kbd`). Its title: `Send your words to the Foreman as a message (Enter). Shift+Enter starts a new line.`
- The box's title at a go-ahead: `Enter sends your words to the Foreman as a message. Go carries them as a note, Send back as the change.`
- Placeholders are unchanged (`PLACEHOLDER`, `INTO_REPLY`, `AT_ASK`).

- [ ] **Step 1: Failing tests** in `MessageBox.test.tsx`:
  - `Enter sends the words as a message`: one `POST /api/job/<slug>/send` with `{ kind: 'message', text: 'hello' }`; the box is empty after.
  - `Shift+Enter adds a line and sends nothing`.
  - `Enter while an input method is composing sends nothing` (`fireEvent.keyDown(box, { key: 'Enter', isComposing: true })`, and again with `keyCode: 229`): no request.
  - `at a go-ahead, Enter with words posts to /send and never to /gate`.
  - `⌘↵ with words at a go-ahead sends the message; with an empty box it presses Go` (assert `/gate` is posted only in the second case).
  - `on the phone Enter adds a line`.
  - `at a go-ahead with two notes the button says Send · 2 notes and posts one message with the notes in front`.
  - `while a reply runs, Enter goes into the reply` (`POST /api/runs/<id>/steer`).
  Rewrite the existing tests that pin ⌘↵ as Go with words in the box and Send turning into Send back; list each renamed test in the ledger.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run `src/jobpage`; pass.**
- [ ] **Step 5: Commit** (`feat(job page): Enter sends, and a message never approves a step`).

### Task A4: Your own answer is the box

**Files:**
- Modify: `web/src/jobpage/left/YourMove.tsx` (`GateCard`, the crew question in `PermissionCard`), `web/src/jobpage/jobStore.ts` (delete `setOwn` and `ui.own` if no caller remains), `web/src/jobpage/jobpage.css` (delete `.jp2-ym-ownin` rules)
- Test: `web/src/jobpage/left/YourMove.test.tsx`; `left/gateBody.test.ts` must pass unchanged (`gateBody` still takes `GatePicks.own`)

**Rules (exact):**
- No `<input>` in the ask. The `Your own answer` row stays; picking it runs `pick(q.id, OWN)` then `pressKey('jp-write')` (the cursor goes to the box). A question with no options shows one line under it: `Write your answer in the message box.`
- At Go and at Send back, every question whose pick is `OWN`, or that has no options, takes the box's words, trimmed, as its `other`. When the words were used this way they are not also sent as the note; notes (pinned in the reader) still go as the note.
- Go with such a question and an empty box sends nothing, puts the cursor in the box and says: `Write your answer in the message box, then press Go.` Go is not disabled for this case (so the press can say it).
- The crew question (a permission with questions) follows the same rule; its answer posts as today with the box's words.
- After a send that used the words, the box is emptied; on a refusal they come back (today's `giveBack`).

- [ ] **Step 1: Failing tests:** `Your own answer has no field; picking it puts the cursor in the message box`; `Go with Your own answer picked sends the box’s words as that answer and no note` (assert the body's `answers[qid]` is `{ other: 'do X' }` and it has no `note` key); `Go with Your own answer picked and an empty box sends nothing and says Write your answer in the message box, then press Go.`; `a question with no options takes the box’s words`; `two questions on Your own answer both carry the box’s words`; `a crew question’s own answer comes from the box`; `a refused Go puts the words back in the box`.
- [ ] **Step 2: Run; fail.** **Step 3: Implement.** **Step 4: Run `src/jobpage` and typecheck; pass.**
- [ ] **Step 5: Commit** (`feat(job page): a question’s own answer is typed in the message box`).

### Task A5: The search folds to an icon

**Files:**
- Modify: `web/src/jobpage/reader/ConversationView.tsx` (the tools row, only with `column`), `web/src/jobpage/jobpage.css`
- Test: `web/src/jobpage/reader/ConversationView.test.tsx`

**Rules:** In the conversation column (`column`), the tools row shows an icon button (`aria-label="Search the conversation"`, title `Search the conversation (/)`) and `Jump to latest`. Pressing the button, or `/`, shows the same field in the row with the cursor in it. Escape with words clears them; Escape or blur with no words folds it back to the button. While it has words it stays open. In the reader (mid, phone) the field stays as today.

- [ ] **Step 1: Failing tests:** `in the column the search is a button until pressed`; `/ opens it with the cursor in it`; `Escape with words clears them and keeps it open; Escape again folds it`; `in the reader the field is always there`.
- [ ] **Step 2–4: Fail, implement, pass.**
- [ ] **Step 5: Commit** (`feat(job page): the conversation’s search is an icon until he needs it`).

### Task A6: Words, the guide, browser checks, a look for him

**Files:**
- Modify: `docs/guide/05-deciding.md`, `docs/guide/09-the-website.md`, `docs/guide/10-keys-and-command-box.md` (the ask above the box, Enter sends, ⌘↵, own answer, no Steer line); `/Users/moxie/Projects/claude-feature-workflow-talk/feature/skills/feature/SKILL.md` (the paragraph "A message at any time")
- Run: `web/e2e/noJump.mjs`, `noEmptyScroll.mjs`, `themeSweep.mjs`, `contrast.mjs`, `jobSpeed.mjs`

- [ ] **Step 1: The guide** in its own plain style; `nice -n 15 node --test dashboard/test/docs.test.js` passes.
- [ ] **Step 2: The skills paragraph** (design, call 9). Replace the paragraph's body with this rule, in the skill's voice: a message that arrives while a step runs is read at the next step and answered in a few lines, then the step carries on; if it asks to change something already made, say so and take it up when the current step ends, unless the person says now; it is never a go-ahead for a push, a PR, a reviewer request, a merge or a check that writes data. Commit on that branch by file name. Do not merge.
- [ ] **Step 3: Build and run the browser checks** (`npm run web:build`, then each script as its header says). Fix what they flag.
- [ ] **Step 4: Whole web suite alone** (`nice -n 15 npm run web:test`): all pass.
- [ ] **Step 5: A look for him.** Start the demo (`PORT=4491 node dashboard/demo/run-demo.js`, add `?play=full` to the address). Take four screenshots at 1906 and 1280 px wide: `tag-colours` (a go-ahead), `bulk-archive` (working), a job with questions, the conversation hidden. Tell him the address and what to try: type and press Enter at a go-ahead; pick `Your own answer`; press Go. Stop the demo when he is done.
- [ ] **Step 6: Commit** (`docs(guide): one prompt`).

---

## Phase B. PR comments: fast, visible, one click

### Task B1: One read per PR, and all of it

**Files:**
- Modify: `dashboard/lib/git.js` (`prComments` l.228, `prConversation` l.251, `prChecks` l.184; add `prThreads`, `sharedPrReads`), `dashboard/lib/review-round.js` (`readPr` l.964, `itemOf` l.242), `dashboard/lib/pr-comments.js` (`rowsOf` l.143–236, `createPrComments` `wanted` l.436), `dashboard/runner/index.js` (where `createReviewRounds`, the feedback pass and `createPrComments` get their readers), `web/src/jobpage/types.ts` (`PrRow`), `web/src/jobpage/reader/PrView.tsx` (`stateWords`, the row's author)
- Test: `dashboard/test/pr-comments.test.js`, `dashboard/test/review-round.test.js`, `web/src/jobpage/reader/PrView.test.tsx`

**Interfaces:**
- Produces `git.prThreads(gh, repo, n): Promise<{ ok: boolean, resolved: Set<string> }>`: the ids (`'c' + databaseId`) of every comment in a thread GitHub has resolved. One read-only `gh api graphql` query of `repository.pullRequest.reviewThreads(first: 100) { nodes { isResolved comments(first: 100) { nodes { databaseId } } } pageInfo { hasNextPage endCursor } }`, following pages.
- Produces `git.sharedPrReads(gh, { ttlMs = 20_000, now = Date.now }): { prComments, prConversation, prChecks, prThreads, drop(repo, n) }`: the same four reads, kept per `repo#n` for `ttlMs`, with callers during a read sharing it. The runner makes one and hands it to all three engines; a GitHub write for that PR calls `drop`.
- `PrRow` gains `bot: boolean` and `resolved: boolean`. A row whose comment is in a resolved thread has state `answered` and `resolved: true`; its state word is `Resolved on GitHub`; it is not counted in `fresh`. A reviewer's comment after the resolve makes it `new` again.
- `review-round.js` items gain `bot: boolean`.
- `createPrComments` reads every job with an open or draft PR on its lane (not only jobs whose page is open), newest change first, up to `RAW_MAX`.

- [ ] **Step 1: Failing tests:** `a thread resolved on GitHub is answered, says Resolved on GitHub, and is not new`; `a reviewer’s reply after the resolve makes it new again`; `a bot’s comment is a row marked bot` (author `coderabbitai[bot]`); `the three engines after one refresh make each list call once` (a fake gh that counts calls per path); `readPr reads past 100 comments` (150 fake comments, all become items); `a job whose page is not open still gets rows`. Web: `a bot’s row shows bot beside the author`; `a resolved row says Resolved on GitHub`.
- [ ] **Step 2–4: Fail, implement, pass** (`pr-comments.test.js`, `pr-comments-server.test.js`, `pr-feedback*.test.js`, `review-round*.test.js`, `PrView.test.tsx`).
- [ ] **Step 5: Commit** (`fix(server): one GitHub read per PR for every engine, with resolved threads and bots told apart`).

### Task B2: Read one repository

**Files:**
- Modify: `dashboard/lib/flow.js` (`refresh` l.319, `#refresh`, the view), `dashboard/runner/index.js` (`prRead` l.2601; the three passes on the `flow` event), `dashboard/lib/review-round.js`, `dashboard/lib/pr-comments.js` (their pass entry points)
- Test: `dashboard/test/flow.test.js`, `dashboard/test/pr-lines-server.test.js`

**Interfaces:**
- `FlowWatch.refresh({ network = false, only = null }: { network?: boolean, only?: string[] | null })`: with `only` (repository paths, as `gatherRepo` keys them) the network read fetches and lists just those repositories; the others keep their last facts and their `fetchedAt`. A request during a refresh runs after it and merges: `only` lists are joined, and a request with no `only` wins.
- The emitted view gains `read: string[] | null`: the repositories read from the network in this refresh (`null`: all, or none read).
- The three passes skip jobs whose repository is not in `view.read` when it is not `null`.
- `prRead(slug)` (the page's opening read and Pull now) passes `only: [the job's repository path]`.

- [ ] **Step 1: Failing tests:** `refresh({ network: true, only: [a] }) fetches and lists a only; b keeps its PRs and its fetchedAt`; `two requests during a refresh run once after it, for both repositories`; `Pull now reads only the job’s repository` (the fake gh sees no call for the other repository).
- [ ] **Step 2–4: Fail, implement, pass.**
- [ ] **Step 5: Commit** (`perf(server): Pull now reads the job’s repository, not every one`).

### Task B3: The PR watch

**Files:**
- Create: `dashboard/lib/pr-watch.js`, `dashboard/test/pr-watch.test.js`
- Modify: `dashboard/runner/index.js` (`start()`: beside the flow watch, only when a `gh` runner exists), `web/e2e/lib/fakeGh.cjs` (answer `repos/<repo>/pulls/<n>`)

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
- First sight of a PR only stores its fingerprint. A different fingerprint later calls `onChange`. At most 4 `gh` calls in flight. A failing `gh` doubles the wait (from the due time) up to `WATCH_MAX_WAIT_MS` and sets `problem` to gh's first line; the next answer that works clears it and returns to the normal times.
- The runner's `onChange` is `flow.refresh({ network: true, only: [repoPath] })`.

- [ ] **Step 1: Failing tests** (fake gh, fake clock): `nothing is reported on first sight`; `a new review comment (review_comments 2 → 3) calls onChange once, with the job’s repository`; `two PRs of one repository changing in one tick call onChange once`; `the open job is asked every 30 s, the others every 3 min`; `gh failing backs off to ten minutes, says why once, and recovers`; `never more than four calls in flight` (20 PRs).
- [ ] **Step 2–4: Fail, implement, pass.** Then `pr-comments-server.test.js`: `a comment that appears on GitHub shows as a row without Pull now` (advance the clock 30 s).
- [ ] **Step 5: Commit** (`feat(server): a new PR comment is picked up within 30 seconds on the open job`).

### Task B4: Address is a round

**Files:**
- Modify: `dashboard/lib/review-round.js` (`groupRounds` l.285, `actions` l.1276, `foremanMessage` l.515, `sendPlan` l.620, `reviewView` l.755–767 labels), `dashboard/lib/pr-feedback.js` (parks no single card for a comment or a check a round took), `dashboard/site/routes-job-page.js` (new route; `fix` and `fix-check` go through it), `dashboard/runner/index.js` (the job page's `fix` and `fixCheck`, about l.2660–2710)
- Test: `dashboard/test/review-round.test.js`, `review-round-server.test.js`, `pr-comments-server.test.js`, `pr-feedback-server.test.js`

**Interfaces:**
- `groupRounds`: a lone new comment or a lone failed check also opens a round (state `asked`); the joining rules are unchanged. So packet N parks no single-comment card; its record still marks each taken item `'round'`.
- New action `actions.address(slug, { pr, ids, note } = {})`, reachable as `reviewRounds.act(slug, 'address', body)`:
  1. The round to use on PR `pr`: its open round in state `asked`, `new-comment` or `check-failed`; else a new one **opened by his ask** (`openedBy: 'you'`), holding every candidate that is unanswered, not his own, not from a summary bot (`isSummaryBot`) and not in an earlier round, plus the failed checks on the head. This is how comments that were on the PR before Starbase first looked get addressed.
  2. `ids` (when given) are the items included; the others in the round are `left_out`.
  3. Then exactly what `fix` does: the Foreman's message, state `fixing`, the Desk card dropped.
  4. A round already `fixing`, or a second call while the first is in flight: nothing more is sent; the round as it stands is returned.
- A by-ask round's reviewer is the one author when every item has the same author, else `null`. `foremanMessage` then opens with `You asked to address N comments on PR #n: this is round k.` (with a reviewer: today's sentence).
- `sendPlan`'s `request` step is left out when the round has no reviewer or its reviewer is a bot.
- Route: `POST /api/job/:slug/pr/:n/address { ids?: string[], note?: string }` → `{ round: number, state: string, sent: boolean }`. `POST …/pr/:n/fix { ids }` and `…/fix-check` call the same action with their ids (their row marks and audit lines stay).
- The round's fix action label, everywhere it is shown (`reviewView`): `Address them` (was `Fix with the Foreman`); key `a` on the Desk stays.

- [ ] **Step 1: Failing tests:**
  - `a lone comment opens a round and parks no single card`.
  - `address with no round opens one by your ask with every unanswered comment and the failed checks` (three comments seeded before the first look, one failed check: four items, state `fixing`, one message to the Foreman).
  - `address uses the asked round and adds lone items to it`.
  - `ids limit what is included; the rest are left out`.
  - `address twice sends one message` (two calls in parallel: the fake Foreman receives one).
  - `a comment that arrives while the round is fixing joins it and sends nothing by itself` (state `new-comment`, the item is in the round's file).
  - `a round with no reviewer, or a bot reviewer, has no request step`.
  - `Fix these goes through a round: the rows say Fixing and the round is fixing`.
  - End to end in `review-round-server.test.js`: `Address them on PR #2: fix, ready, Send back pushes, opens and merges the follow-up PR #1, posts the replies, resolves the threads`.
- [ ] **Step 2–4: Fail, implement, pass** (run the four files one at a time).
- [ ] **Step 5: Commit** (`feat(server): every address runs as a review round, opened by his click when no review opened one`).

### Task B5: The prompt's PR line in the payload

**Files:**
- Modify: `dashboard/lib/job-payload.js` (`prMoveOf` l.801 → `prAskOf`; keep `prMove` until Task B6 removes its last reader, then delete it), the mirror shape, `web/src/jobpage/types.ts`
- Test: `dashboard/test/job-payload.test.js`, `dashboard/test/mirror-shape.test.js`

**Interfaces:**
```ts
type PrAsk = null | {
  n: 1 | 2; number: number | null;
  state: 'stopped' | 'ready' | 'new' | 'sending' | 'fixing' | 'merge';
  line: string;                       // the words below, built on the server
  comments: number; failing: number; fixed: number; since: string | null;
  next: null | { id: 'address' | 'send-back' | 'carry-on' | 'merge' | 'merge-admin'; label: string; go: string | null; says: string[]; expect: string[] | null; confirm: string | null };
};
```
- One line per job: the first of PR #1 and PR #2 in this order of state: `stopped`, `ready`, `new`, `sending`, `fixing`, `merge`. `null` when neither needs him and nothing is under way.
- It is built from the round's view (`reviewView`), the rows' counts (`factsOf`) and, for `ready`, `reviewRounds.planFor(slug)`: `says` and `expect` are its `steps`, so `send({ expect })` refuses a plan that changed since he looked, as today. `confirm` is the words `actions.merge` asks for (`Merge PR #2`); it is `null` for the other actions.
- On the website's payload `next` is always `null`.

| State | `line` (exact; `PR #2`, counts and names vary) | `next.label` → `next.go` |
|---|---|---|
| `new` | `PR #2 · 3 comments to address`; one: `1 comment to address`; with checks: `… · 1 check failing`; checks only: `PR #1 · 1 check failing` | `Address them` → `null` (one click) |
| `fixing` | `PR #2 · the Foreman is fixing 3` | none |
| `ready` | `PR #2 · 3 fixed · replies drafted` | `Send back…` → `Send back` (`says`: the round's Send-back steps in words) |
| `sending` | `PR #2 · sending back · step 2 of 5` | none |
| `stopped` | `PR #2 · Send back stopped at step 3 of 5` | `Carry on` → `Try again from here` |
| `merge` | `PR #2 · checks passing · yours to merge` | `Merge…` → `Merge PR #2` (Task D2) |

- [ ] **Step 1: Failing tests:** one per row of the table (line and `next`); `PR #1 new and PR #2 ready: the line is PR #2’s`; `the website’s payload carries prAsk with next null`; `no PR needs him: prAsk is null`.
- [ ] **Step 2–4: Fail, implement, pass.**
- [ ] **Step 5: Commit** (`feat(server): the page payload names the one PR line and its one action`).

### Task B6: One line, one button, on the page

**Files:**
- Create: `web/src/jobpage/left/PrAsk.tsx`, `web/src/jobpage/left/PrAsk.test.tsx`
- Modify: `web/src/jobpage/left/Prompt.tsx` (mount it between `NowLine` and `.jp2-ask`), `left/YourMove.tsx` (delete `PrMoveLine` and `hasPr`), `reader/PrView.tsx` (the bar, the rows, the top), `left/PrLines.tsx` (the laptop line's count), `left/Steps.tsx` (the Ship cell's word), `web/src/theme/controlRules.test.ts`
- Test: `PrAsk.test.tsx`, `reader/PrView.test.tsx`, `left/PrLines.test.tsx`, `left/Steps.test.tsx`, `left/YourMove.test.tsx`

**Interfaces:**
- Consumes `payload.prAsk` (Task B5), `POST /api/job/:slug/pr/:n/address` (Task B4), the round's routes `POST /api/review/:slug/send { go: true, expect }` and `…/merge`.
- `PrAsk({ onOpen, at }: { onOpen?(t: ReaderTarget, from?: HTMLElement | null): void; at: 'prompt' | 'view' })`: the line, the `next` button and `Look` (opens `{ kind: 'pr', id: String(n) }`; not drawn with `at: 'view'`).

**Rules (exact):**
- `Address them`: one click. The line says `Sent · Undo` for four seconds (the asks row's rule and timing); Undo in that time posts nothing; after it, one `POST …/address`. Title: `Sends the Foreman every comment and failed check listed here: it fixes each on the branch, one commit each, and drafts a reply to each. Nothing goes to GitHub until you press Send back.`
- `Send back…`, `Merge…`, `Carry on`: the first click opens the confirm in place, above the box: each `says` line, then the `go` button (primary) and `Not yet`. The second click posts once: Send back and Carry on `POST /api/review/:slug/send { go: true, expect }`, the merge `POST /api/review/:slug/merge { go: true, confirm }`. A refusal (409: the steps changed) says the server's words and reloads the page payload.
- GitHub not reachable (the payload's `githubDown`, as `PrView.tsx` reads it): the line stays, its button is off and its title says why.
- On the website: the line only, then `Your laptop does this.`
- PR view: `PrAsk at="view"` at the top. The bar's primary is `Address ticked (k)` (was `Fix these`; same title, ending `…Nothing goes to GitHub until you press Send back.`). Each row in state `new` has a quiet button `Address this` (posts `{ ids: [id] }`). Row reply boxes and `Post it` stay for a comment that is not in a round.
- Laptop PR lines (`PrLines.tsx`): each line with comments ends in a link `3 comments ›` (`1 new ›` when some are new: `2 new ›`) that opens the PR view.
- Ship's cell in the steps row (`Steps.tsx`): its word is `3 comments` while `prAsk.state === 'new'`, ahead of the PR's state word.

- [ ] **Step 1: Failing tests:** `each state draws its line and its one button` (table over the six states); `Address them posts once after four seconds; a second click in that time changes nothing; Undo posts nothing`; `Send back… lists what goes, then posts once with the steps it showed`; `a stale Send back says why and asks for the page again`; `GitHub not reachable: the line stays, the button is off and says why`; `the website shows the line and no button`; PR view: `Address this posts that one id`, `the bar says Address ticked (2)`; `a PR line with 3 comments ends in 3 comments › and opens the PR view`; `Ship’s word is 3 comments while they are new`; `Your move draws no PR line`.
- [ ] **Step 2–4: Fail, implement, pass** (`src/jobpage`, typecheck). Then delete `prMove` from the payload and its type (Task B5's leftover) and run `job-payload.test.js`.
- [ ] **Step 5: Commit** (`feat(job page): a PR that needs him is one line above the box with one button`).

### Task B7: He hears about it once, by name

**Files:**
- Modify: `dashboard/runner/index.js` (`tellPermission` l.2340 and where a round card is parked), `dashboard/lib/review-round.js` (the card's words)
- Test: `dashboard/test/notify.test.js`, `dashboard/test/review-round-server.test.js`

**Rules:** One notification when a round opens and one when new comments join a round that is not being fixed; none for his own comments, for summary bots, or while he is looking at Starbase (today's rule). Title: the job's title. Body (exact forms): `Raj asked for changes on PR #2 · 4 comments`, `3 comments on PR #1 to address`, `1 comment on PR #1 to address`, `A check failed on PR #1`. Never `A question for you.` for a PR.

- [ ] **Step 1: Failing tests:** one per body form; `ten comments in one review tell him once`; `his own comment tells him nothing`.
- [ ] **Step 2–4: Fail, implement, pass.**
- [ ] **Step 5: Commit** (`feat(server): a PR comment’s notification names the PR and the job`).

### Task B8: The skills say the same

**Files (a new worktree of the skills repository: `git -C /Users/moxie/Projects/claude-feature-workflow worktree add -b feature/pr-address ../claude-feature-workflow-pr-address main`):**
- Modify: `common/skills/workflow-common/notes-and-comments.md` ("## PR comments"), `tools/skills/ship/review-rounds.md` ("## The steps")

**Rules:** A round can be opened by the person's ask, with no reviewer. A request typed in words ("address the PR comments", "pull the comments and fix them") is handled as a round: read with `gh` (comments, reviews, conversation, and which threads are resolved), plan, fix one commit per item, run the checks, draft a reply per comment, end with the `--- Comments answered ---` block. Resolved threads and the person's own comments are skipped. Never push, reply, resolve, ask for a review or merge: Send back does those after the person's yes.

- [ ] **Step 1: Edit both files** in the skills' own voice. **Step 2:** `nice -n 15 node --test dashboard/test/pr-comments.test.js` in the Starbase worktree still parses the block the skill describes. **Step 3: Commit by file name on `feature/pr-address`. Do not merge.**

### Task B9: A demo he can click

**Files:**
- Modify: `web/e2e/prPath.mjs`, `web/e2e/lib/fakeGh.cjs`, `package.json` (script `demo:pr`: `KEEP=1 node web/e2e/prPath.mjs`), `docs/guide/` (the page on pull requests)

- [ ] **Step 1:** The fake gh also serves a bot's comment (`coderabbitai[bot]`), one resolved thread, and the `pulls/<n>` object for the watch. **Step 2:** `prPath.mjs` walks: a comment appears and shows within 30 s with no Pull now; `Address them`; the demo Foreman fixes; `Send back…` lists the steps; the replies are posted to the fake. **Step 3:** `npm run web:build && node web/e2e/prPath.mjs` passes. **Step 4:** The guide's page says how comments arrive and the two clicks. **Step 5: Commit** (`test(e2e): comments arrive, Address them, Send back`).

---

## Phase C. A Desk that agrees with the job page

### Task C1: The server says whose turn it is

**Files:**
- Modify: `dashboard/runner/index.js` (the job card, about l.1040–1060), the mirror shape, `web/src/api/types.ts` (`Job.yourTurn?: boolean`)
- Create: `dashboard/test/desk-turn.test.js` (with `dashboard/test/helpers/dashboard.js`)

**Interfaces:**
- Each job card gains `yourTurn: boolean`. It is `true` only when the job waits for him (a go-ahead, questions, a reply, or a permission card) **and** none of these holds: a reply is running for the job; a reply is held for the usage limit (`limits.heldFor(f.dir)`, the card's `heldReply`); a message waits behind a reply (`waitingMessages.get(f.dir)`). A fourth case, a decision made on the website that the laptop has not taken yet, is known only to the website: Task C2 handles it there.
- The board is told (the snapshot's change event) whenever one of those three changes, in the same tick as the action's answer.

- [ ] **Step 1: Failing tests** (each reads the board the way the Desk does):
  - `a job at a go-ahead is his turn`.
  - `Go is accepted: not his turn at once, before the Foreman has said a word`.
  - `Go held for the usage limit: not his turn`.
  - `a message sent at a go-ahead: not his turn while the reply runs; his turn again when it ends and the go-ahead still waits`.
  - `a message waiting behind a running reply: not his turn`.
  - `a Go refused (a newer brief): still his turn`.
  - `a reply that errors before the Foreman read the Go: his turn again`.
  - `two Go posts at once: one is accepted, and it is not his turn`.
  - `a permission answered: its card is gone from the board at once`.
  - `Address them: the round’s Desk card is gone at once` (Task B4).
- [ ] **Step 2–4: Fail, implement, pass.**
- [ ] **Step 5: Commit** (`feat(server): each job says whether it is his turn`).

### Task C2: One queue on the web

**Files:**
- Create: `web/src/home/deskOpen.ts`, `web/src/home/deskOpen.test.ts`
- Modify: `web/src/home/homeModel.ts` (`deskQueue` skips a job with `yourTurn === false`), `web/src/app/TopBar.tsx` (`deskCountOf`), `web/src/home/HomeView.tsx` (l.62–65), `web/src/home/DeskPage.tsx`, `web/src/home/DeskView.tsx` (l.429; its own `settled` set stays on top, for the instant), `web/src/jobpage/left/Header.tsx` (`NextNeedsYou`), `web/src/alerts/useAlerts.ts` (the tab title's number), `web/src/views/Hosted/HostedWorkshop.tsx` (passes `queued`)

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
- `yourTurn === undefined` (an older server, the first paint) counts as his turn.
- `reviewing`: a job with a review round shows the round's card and not its PR nudges (`ROUND_NUDGES`). Today only `DeskView.tsx` (l.426–429) applies this, so the top bar counts nudges the list hides; the rule moves into `deskOpen`.
- `queued`: on the website (`web/src/views/Hosted/HostedWorkshop.tsx`), the slugs whose queued decision is still open (`isOpen` in `web/src/views/Hosted/QueuedDecision.tsx`). Such a job is not his turn. The laptop passes none.
- Every screen named above calls these and nothing else for a Desk number or list.

- [ ] **Step 1: Failing tests:** `deskOpen.test.ts`: `a job that is not his turn is not listed and not counted`; `a permission card is listed whatever the job’s turn`; `Shipping entries are listed and not counted`; `nextUp skips the open job and jobs that are not his turn`; `a job with a review round counts once: its round, not its PR nudges`; `a job with an open queued decision is not listed`. One table test rendering `TopBar`, `HomeView`, the header's `Next` and the tab title for the same state: `the four numbers agree`.
- [ ] **Step 2–4: Fail, implement, pass** (`src/home`, `src/app`, `src/jobpage`, `src/alerts`).
- [ ] **Step 5: Commit** (`fix(web): one Desk queue for the list, the top bar, the header and the tab title`).

### Task C3: Two screens agree

**Files:**
- Create: `web/e2e/deskAgree.mjs` (as `web/e2e/prPath.mjs` is built: its own demo server and port)

- [ ] **Step 1: Write it:** two pages, the Desk and a job. Press Go on the job page: within 2 s the job's row is gone from the Desk and the top bar's number is one lower in both pages. Send a message at a go-ahead: the row is gone while the Foreman replies and back when it asks again. Press `Address them`: the PR's entry is gone from the Desk. Reload the Desk page after each: the same.
- [ ] **Step 2: Run** (`npm run web:build && node web/e2e/deskAgree.mjs`); fix what fails; pass.
- [ ] **Step 3: Commit** (`test(e2e): what he settles in a job leaves the Desk`).

---

## Phase D. PR #2 without Raj's approval

### Task D1: The route and the nudges

**Files:**
- Modify: `dashboard/profiles/orbit.md` (l.25), `dashboard/lib/nudges.js`, `dashboard/lib/pr-lines.js` (`second()`, `PR_SENTENCES`), `dashboard/runner/index.js` (pass the repository's route to `nudgesFor`, as review rounds get it from `profileFor`), `web/src/home/nudges.ts` only if a word is hard-coded there
- Test: the tests beside `dashboard/lib/nudges.js` and `dashboard/test/pr-lines.test.js`

**Rules (exact):**
- `orbit.md`: `  - "PR #2: the moxie branch into staging (you merge it)"`. In the notes under the settings: a review from Raj (`@rajmehta0311`) is asked for only when he says so.
- `nudgesFor(card, lane, { finishLine, dismissed, sent, inRound, route })`, `route` being `parseRoute`'s output. With `who = routeStep(route, 2).reviewer?.name ?? null`:
  - **`who` is null and he may merge** (Orbit now): no `pr2-review`. PR #2 open, not a draft, checks not failing → `pr2-merge`, title `Merge PR #2`, text `PR #2 (#n) is open and its checks pass. You merge it: no approval is needed.` Changes requested by anyone → `pr2-changes`, title `Address the review on PR #2`.
  - **`who` is named** (another repository): today's three nudges, with the route's name where the word Raj is now (`Ask ${who} for a review?`, `${who} approved PR #2…`, `Address ${who}’s review on PR #2`), and the sentence `Please request ${who}’s review on PR #2.`
- `pr-lines.js` `second()` (l.179–183): `request-review` only when the route names a reviewer, with that name in its words. On Orbit there is then no button for it: a review of PR #2 is asked for in words to the Foreman, who requests it with his yes (the skills' rule).
- No user-facing string in `dashboard/lib` or `web/src` contains the word `Raj` afterwards, except names read from a route or from GitHub (`grep -rn "Raj" dashboard/lib web/src --include="*.js" --include="*.ts" --include="*.tsx" | grep -v test` shows only comments).

- [ ] **Step 1: Failing tests:** `Orbit’s route: an open PR #2 with passing checks is his to merge, and nobody is asked for a review`; `failing checks: no merge nudge`; `changes requested: Address the review on PR #2`; `a route that names a reviewer keeps the three nudges with that name`; `the PR line offers Request review only when the route names a reviewer`.
- [ ] **Step 2–4: Fail, implement, pass.**
- [ ] **Step 5: Commit** (`feat(server): PR #2 follows the route: on Orbit he merges it and no approval is asked for`).

### Task D2: Merging PR #2 from Starbase

**Files:**
- Modify: `dashboard/lib/review-round.js` (`reviewView`, `actions.merge` l.1750), `dashboard/lib/gh-write.js` (the merge write), `dashboard/lib/job-payload.js` (`prAsk` state `merge`, Task B5)
- Test: `dashboard/test/review-round.test.js`, `dashboard/test/gh-write.test.js`

**Rules:**
- A PR with no open round, whose route step lets him merge and names no reviewer, that is open, not a draft, with passing checks and no conflicts, has the view state `you-merge`: headline `PR #2 · checks passing · yours to merge`, one action `merge` with go `Merge PR #2` and says `[ 'PR #2 (#n): <org branch> into staging', 'Head <sha7> · checks passing', 'A merge commit' | 'Squashed' (the route), 'Starbase merges it on GitHub. Nothing else changes.' ]`. `actions.merge(slug, { go, confirm, admin })` accepts that state as it accepts `approved-you-merge` (its `needState` list), with the same `go: true` and `confirm` (`Merge PR #2`, case ignored).
- GitHub refuses because it still asks for a review (the PR's `reviewDecision` is `REVIEW_REQUIRED`, or gh's refusal says a review is required): the view says `GitHub still asks for an approving review before this merges.` and offers a second action `merge-admin`, label `Merge as admin`, with its own yes and says `[ 'Uses your admin right on <org repo> to merge without the review GitHub asks for.' ]`. It posts `{ go: true, confirm: 'Merge PR #2 as admin', admin: true }`; `actions.merge` refuses `admin` without that exact confirm (case ignored) and passes `admin: true` to `deps.write.mergePr`, which runs `gh pr merge <n> --repo <org repo> --merge --admin` (`--squash` when the route says squash). It is audited as `review-merge-admin`. It is never run without that click.

- [ ] **Step 1: Failing tests:** `a route where he merges and nobody reviews: an open PR #2 with passing checks is his to merge`; `failing checks, a draft, or conflicts: not offered`; `the merge runs once, with his yes, and the round’s history has it`; `GitHub asks for a review: Merge as admin is offered, and --admin is passed only after its own yes`; `gh-write: merge with admin passes --admin`.
- [ ] **Step 2–4: Fail, implement, pass.**
- [ ] **Step 5: Commit** (`feat(server): he can merge PR #2 from Starbase once its checks pass`).

### Task D3: The guide

- [ ] **Step 1:** Every guide page that says Raj reviews or merges PR #2 (`grep -rn "Raj" docs/guide`) says the new rule. `docs.test.js` passes. **Step 2: Commit** (`docs(guide): PR #2 is his to merge`).
- [ ] The skill text is already written (`feature/pr2-you-merge`, `3be3e55`). Do not merge it; it is in the handover.

---

## Phase E. Finish

### Task E1: Everything together

- [ ] **Step 1: Whole server suite, alone** (`nice -n 15 npm test`). **Step 2: Whole web suite, alone** (`nice -n 15 npm run web:test`). **Step 3:** `npm run web:build`, then `web/e2e/prPath.mjs`, `deskAgree.mjs`, `noJump.mjs`, `noEmptyScroll.mjs`, `themeSweep.mjs`, `contrast.mjs`, `jobSpeed.mjs`. Every one passes, or the ledger names the test, the error and why it is not this build.
- [ ] **Step 4: A fresh reviewer** (superpowers:requesting-code-review) on the whole branch against the design, with the Review focus list. Fix what it confirms.
- [ ] **Step 5: Handover** at `.superpowers/sdd/2026-11-18-one-prompt-plan/handover.md`: what is built, each branch and its head, the test counts, what was left, and the steps that need his word, in this order: merge `feature/one-prompt` (it contains `feature/talk-anytime`) into `main`, `npm run web:build`, restart Starbase on 4477 (it interrupts a running reply); merge the three skills branches (`feature/pr2-you-merge`, `feature/pr-address`, `feature/talk-anytime`); push.
- [ ] **Step 6: Update the memory note** `starbase-talk-anytime-build` with the new branch, its head and what is live.

## Open with the owner

Defaults are chosen so nothing waits. Each is listed in the design under "Calls I made".

| Question | Default built |
|---|---|
| Enter sends on a laptop? | Yes; Shift+Enter is a new line; the phone keeps Enter as a new line. |
| ⌘↵ with an empty box at a go-ahead | Still Go. |
| A lone comment opens a round | Yes, so the Desk has one entry per PR and every finish is one Send back. |
| The watch's times | 30 s for the open job, 3 min for the rest. |
| `Merge as admin` | Offered only after GitHub refuses, with its own yes. |
| The `/feature` paragraph "A message at any time" | Rewritten smaller (Task A6), left unmerged. |
| PR #3 | Unchanged. |
