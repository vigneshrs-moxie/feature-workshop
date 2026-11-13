# Job page rebuild: plan (and everything else left over)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to build this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

Written 13 Nov 2026 by the session that built the Auto queue. That session is finished and will not run again. **Everything in this file is for a new session on Opus.** Subagents run on Opus too (the owner's standing preference).

**Goal:** Replace Starbase's job page with the two-pane page from prototype revision 3: his move on the left, a reader on the right, a folded conversation, and everyday actions (approve, send changes back, pull requests, PR comments) done on the page, at the speed rules below.

**Architecture:** A new page in its own folder (`web/src/jobpage/`) that reads one cached payload per job from a new server route and never calls the heavy step route. It lives beside the old page behind a switch until the owner has used it on real jobs; then it becomes the page and the old one is removed. Acting features reuse today's send, gate, permission and GitHub-write routes; new server parts are small modules with their own tests.

**Tech stack:** Node 24 server in `dashboard/` (`node --test`), React 19 + TypeScript + Vite in `web/` (vitest, jsdom), hosted website in `hosted/`, Playwright for browser checks (`web/e2e/`), the workflow skills repository for the Foreman's instructions.

**Spec:** the design brief and the prototype (see "Read first"). The prototype is the reference for look and behaviour; the brief is the reference for rules and numbers. Where they disagree, the brief wins and the difference goes in the ledger.

---

## Part 1. Where things stand

- **The Auto queue is live** since 13 Nov, about 09:50 MST. Starbase `main` = `912703e`, pushed (the website deploys from it). Skills `main` = `0e3ff64`, linked into Claude Code, **not pushed**. The running Starbase (port 4477, launchd service `com.moxie.starbase`) runs from `/Users/moxie/Projects/feature-workshop` on `main`.
- **This work:** worktree `/Users/moxie/Projects/starbase-job-page`, branch `feature/job-page-redesign`, cut from `912703e`. Nothing of the new page is built.
- **The owner has seen prototype revision 3** and asked for this plan "so opus can build it". Two small questions to him were never answered; defaults are chosen in "Open with the owner" so nothing waits.

## Read first, in this order

All paths under `/Users/moxie/Projects/starbase-job-page/` unless they start with `~` or `/`.

1. `.superpowers/job-page-redesign/design-brief.md` — the design. Top half is the frame (revision 2), bottom half ("Revision 3") is acting. **This is the requirements document.**
2. `~/.claude/wireframes/starbase-job-page/starbase-job-page.draft.html` — prototype revision 3. Open it from disk. To look at it with browser tools, serve its folder (`python3 -m http.server 8765 --bind 127.0.0.1`) and stop the server afterwards. Its sources (`gen.py`, `rev3.py`, `page.js`, `page.css`) are in `.superpowers/job-page-redesign/prototype/`: read `page.css` and `page.js` for exact spacing, sizes and behaviour.
3. `.superpowers/job-page-redesign/live-look.md` — what was measured on his real page and why he rejected it.
4. `.superpowers/job-page-redesign/audit.md` — the code audit of today's page: what re-renders, which requests it makes, which tests pin it (section 5), which parts other screens share (5.3). Its line numbers are from 12 Nov; files are right, lines may have moved.
5. `.superpowers/job-page-redesign/usage.md` — what he really sends (201 messages), and Part 2: every route that acts on a job, what Starbase reads from GitHub, what the skills tell the Foreman about PR comments.
6. `.superpowers/job-page-redesign/data/` — job ORBIT-471 saved from his Starbase. Real, private content.
7. Memory notes: `starbase-ui-design-bar`, `prefers-summaries-first-ui`, `starbase-job-page-redesign`, `starbase-runs-main`, `subagents-stall-on-permission-prompts`.

## The owner's bar (his words, do not soften)

- "it should feel like the best improvement over claude code on the terminal so that ill actually want to use it"
- "clicking and picking things should make things easier and faster"
- "suggesting changes and requesting different things than what it built should be easy"
- "many common everyday things like asking it to pull pr comments and making changes according to that should be easy so i dont have to often sway from the site"
- "keep only useful things on the screen", "make everything move smooth and clean, fast like it was built for performance"
- "close some of the sub tasks if they are complete instead of running them forever"

The first redesign passed a prototype review and failed in daily use. This one is judged on his real, long conversations, in the running app, before the old page goes.

## Global constraints

**Safety and his laptop**
- Work only in `/Users/moxie/Projects/starbase-job-page` (and a new worktree of the skills repository for Phase 4). Never edit `/Users/moxie/Projects/feature-workshop`: that folder is the running Starbase.
- No merge to `main`, no push, no rebuild or restart of the running Starbase, no `install.sh`, without the owner's word each time. Any push to Starbase `main` deploys the website.
- The running Starbase may be read with GET only (`http://127.0.0.1:4477/api/...`). Never POST to it. `GET /api/meta` returns a token: never print or store it.
- Tests and agents never read, write or list the real `~/.starbase`, never read a `.env` file, never open a real Postgres (no port 5432, no real `.s.PGSQL.` socket), never touch `~/.claude/feature-work`, `~/Projects/orbit-*` or `~/Projects/moxie-portal*`. Orbit is GET only; Starbase never posts to Orbit. Do not change the Orbit token.
- **Private content:** `.superpowers/` is untracked and holds his real conversation and PR #247's comments. Never `git add -A` or `git add .`; add files by name. Never commit, publish or paste anything from `data/` or the prototype page. Fixtures in the repository are made up (see Task 2).
- A test sample that looks like a secret is spelled in two parts (`'sk_' + 'live_…'`); GitHub refused a push over this before.
- No bare `git stash`. Never add `-vN` to a branch name. Deleting branches, worktrees or files outside the task needs his word.

**Running things**
- Every test command: `nice -n 15`. Server: `nice -n 15 node --test --test-timeout=240000 dashboard/test/<file>`; whole suite `nice -n 15 npm test` once per phase with nothing else running. Web: `nice -n 15 npm run web:test -- --maxWorkers=3` (one file: add its path). Build: `npm run web:build` (type-checks first).
- At most two agents building or testing at once; one writing agent per worktree. `dashboard/test/evidence-server.test.js` is run by one process at a time.
- Subagents stall silently on permission prompts: every dispatch forbids deleting (`rm`), forbids subagents of their own, and names the files it may change.
- One known failure on `main`: `gate-server` test "I2 B", and CI is red because of it (Task L2 below; do that first, on its own branch).

**Code rules already enforced by tests**
- The CSP is `style-src 'self'`: no inline `style=` and no style tags (`web/src/app/inlineStyle.test.ts`). Dynamic sizes go through CSS classes or custom properties set from script on an element's `style` property only where an existing component already does so.
- Buttons, selects, radios and checkboxes come from `web/src/components/` (`controls.css`, `Select`, `Choice`); `web/src/theme/controlRules.test.ts` lists files that may not hand-write `btn` classes. Add the new page's files to that list.
- Every stylesheet balances its braces (`pageCss.test.ts`). Every theme must pass `web/e2e/themeSweep.mjs` and `contrast.mjs`.
- Say "Starbase" in every word a person reads. UI words are plain: no "leverage", "robust", "seamless"; a button says what it does.

**Commits:** one commit per task step that passes, subject in the repository's style (`feat(job page): …`, `fix(server): …`), ending with the co-author trailer your session's instructions give.

## Decisions already made (do not re-ask)

1. Two panes on a laptop (1100 px and wider): left 440 px fixed, reader takes the rest; prose at most 760 px wide. Between 760 and 1100 px the reader slides over the left pane with a back row. At 760 px and under the phone has its own three screens.
2. The reader shows exactly one thing. Default on open: the ask when the job waits for him, the current step's main output when it works, else the conversation.
3. The conversation is one line per item, grouped by step and day; the last exchange is open; small events are folded into `n small events`.
4. Crew telemetry ("Who worked on it", "What they did last", robot figures, scene pictures) is gone from this page. `Details` is one table: step, who, the task it was given, how long, how it ended.
5. Revision 3, R1 to R8 of the brief, are all in scope. `Steer` and the separate Reply mode go.
6. PR replies: `Copy` with `Open on GitHub` is the default way; `Post it` is the second button. He chose to post himself twice.
7. Kept asks (`Keep as an ask`) are stored in the browser (`sb.asks.kept`). One user, one browser; a server store is not needed yet.
8. The website shows the same page. What the website hides today stays hidden (terminals, commits, Try it, the menu's local items) and decisions there are queued for the laptop as today.

## Open with the owner (defaults chosen; tell him at the first review, change on his word)

| Question he was asked | Default built |
|---|---|
| After the Foreman has fixed PR comments, `Push the fixes` showed in three places in the prototype. | Two: the PR's line in the Ship step and the bar of the PR view. The asks row carries a PR action only while the Ship step is **not** the open step. |
| On the phone the PR comments card had no direct button. | It gets one: the PR line on the phone's job screen ends in `Comments · 3 new`, which opens the PR view. |

## Speed rules (part of the design; each has a check in Task 23)

1. Opening a job from Jobs paints the header, Your move and the steps within 150 ms from what the app already holds; the reader fills in without moving anything else.
2. Picking a step, a document, a message or the conversation shows it in under 100 ms. No pick waits on a slow server answer.
3. Nothing moves after it is painted unless he caused it. A new message adds a line and never pushes what he is reading.
4. Go and Send back show their result at once and correct themselves if the server refuses.
5. Only the part that changed redraws. No timer redraws the page.
6. The server answers the page's job request in under 100 ms from a warm cache, and opening the page never runs a database query, a `psql`, a `git` command or a read of every agent's log.
7. No animation longer than 120 ms.

---

## Architecture

### Server

- **`dashboard/lib/job-page.js`** — `buildJobPage(facts) → JobPagePayload`, a pure function. `facts` is what the runner already knows about a job (status, thread items, briefs, documents, stage facts, PR facts). No I/O inside it, so it is cheap to test.
- **`dashboard/lib/job-page-cache.js`** — one entry per open job: `{ v, payload, bodies }`. Rebuilt when the runner sees that job change (the same moments it broadcasts `change`, `thread`, `run` and gate events today), never on a request. `v` goes up only when the payload's JSON really changed.
- **`dashboard/site/routes-job-page.js`** — the page's routes, registered where the other route files are registered:
  - `GET /api/job/:slug/page?v=<n>` → the payload, or `{ same: true, v }` when the caller's `v` is current.
  - `GET /api/job/:slug/item?id=<id>` → one body: `{ id, kind, version, html, text, meta }` for a reply, a brief, a document, a decision list. Bodies of items that cannot change (a past reply, an answered brief, an older document version) are kept after the first render.
  - `GET /api/job/:slug/work` → rows for `Details`.
  - `GET /api/job/:slug/pr/:n` and `POST /api/job/:slug/pr/:n/pull` → the PR view and `Pull now` (Phase 4).
  - Changes and commits keep today's `GET /api/job/:slug/commits` and `/commit/:sha`.
- SSE: one new event, `job-page`, with `{ slug, v }`, sent when a job's `v` goes up. The page refetches `page?v=` on it. No other event makes the new page do work.
- The new page **never** calls `GET /api/job/:slug/stage/:stop` (it builds the whole job and runs `psql`), `/api/stacks` on a timer, or `/api/review/:slug` after every event.

**Payload shape** (names are this plan's; Task 1 may adjust them to the code's habits and must record the final shape in the ledger and in a comment at the top of `job-page.js`):

```ts
type JobPagePayload = {
  v: number;
  slug: string; key: string | null; keyUrl: string | null; title: string;
  state: 'needs-you' | 'working' | 'waiting-github' | 'paused' | 'done';
  stateLine: string;                      // the one line when there is no card
  facts: { level: string; repo: string; cost: number; model: string | null; branch: string | null };
  auto: object;                           // the same object /api/features gives today
  move: null | GateMove | QuestionMove | PermissionMove;
  asked: null | { total: number; done: number; notes: NoteAnswer[] };          // R5
  steps: StepRow[];                       // in the job's own order
  rows: { conversation: { count: number; fresh: number }; decisions: { count: number } };
  open: { kind: ReaderKind; id: string }; // what the reader shows on arrival
  thread: ThreadLine[];                   // one line per item, no bodies
  queued: null | { text: string; at: string };                                  // R8
  prs: PrLine[];                          // R2
  hosted: boolean;
};
type StepRow = { id: string; label: string; state: 'done' | 'current' | 'todo' | 'skipped';
  word: string | null; durationMs: number | null; outputs: Output[] };
type Output = { kind: 'doc' | 'screens' | 'changes' | 'checks' | 'recording' | 'hand-test' | 'findings' | 'walkthrough' | 'pr';
  id: string; label: string; meta: string | null; version: number | null };
type ThreadLine = { id: string; kind: 'reply' | 'you' | 'brief' | 'small'; at: string; step: string;
  headline: string; answered?: string; version: number };
type GateMove = { kind: 'gate'; brief: number; ask: string; since: string; goSays: string;
  questions: { id: string; text: string; options: { id: string; label: string; consequence: string | null; recommended: boolean }[] }[];
  decided: number };
type QuestionMove = { kind: 'question'; ask: string; since: string; quick: string[]; itemId: string };
type PermissionMove = { kind: 'permission'; id: string; what: string; command: string; since: string };
type PrLine = { n: 1 | 2 | 3; state: string; word: string; next: null | { id: string; label: string; says: string[] }; comments: { fresh: number; total: number } };
type NoteAnswer = { n: number; note: string; done: boolean; what: string; target: { kind: ReaderKind; id: string } | null };
```

### Web

- **`web/src/jobpage/`** is the whole new page. It may import shared leaf parts (`DocReader`, `ScreensTab`, `WalkthroughTab`, `TryTab`, `EvidenceStrip`, `AutoSwitch`, `WhatAutoDecided`, `PermissionAlert` words, `gateSent.ts`) but not `JobPage`, `NextStep`, `GateCard`, `ConversationPanel`, `StepPanel`, `ForemanPane` or `Composer`: those stay as they are for the quick look, the Desk and stack parts (audit 5.3).
- **State:** one small store per open job (`web/src/jobpage/jobStore.ts`) holding the payload, the body cache and the page's own UI state (open step, reader target, picks, notes, draft). Components read it through `useSyncExternalStore` with a selector, so a change redraws only the parts that read what changed. The page does not call `useWorkshopState()`; the one thing it needs from the app store (the snapshot's row for this job, for the first paint) is passed in as a prop.
- **First paint** comes from the snapshot row the Jobs page already holds (title, state, step). The payload arrives and fills in; sizes are reserved so nothing shifts.
- **Bodies:** after the first paint the page fetches, when idle and in this order, the body of the default reader view, the last exchange of the conversation, the current step's outputs, then the rest newest first. A pick that finds its body paints in the same frame; one that does not shows the title row at once and the body when it lands.
- **The switch:** `sb.jobPage` in localStorage (`new` or absent). `App.tsx` and `HostedWorkshop.tsx` mount `web/src/jobpage/JobPage2` when it is `new`, else today's page. The `⋯` menu of both pages has `Try the new job page` / `Back to the old job page`. Phase 5 makes new the default.
- **Addresses stay:** `#/job/<slug>`, `/stage/<stop>`, `/conversation`, `/overview` (opens `Ticket and goal`), `/id/<id>`. New: `#/job/<slug>/read/<kind>/<id>` for a reader target, so the back button and a reload return to what he was reading.

### File map

| File | Responsibility |
|---|---|
| `dashboard/lib/job-page.js` (+ `dashboard/test/job-page.test.js`) | Payload builder, pure |
| `dashboard/lib/job-page-cache.js` (+ test) | Warm cache, versions, body cache |
| `dashboard/site/routes-job-page.js` (+ `dashboard/test/job-page-server.test.js`) | Routes and the `job-page` event |
| `dashboard/lib/work-rows.js` (+ test) | `Details` rows: task given, how it ended |
| `dashboard/lib/notes-block.js` (+ test) | Compose the notes message (R4), parse the Foreman's answer (R5) |
| `dashboard/lib/queued.js` (+ test) | One queued message per job (R8) |
| `dashboard/lib/pr-lines.js` (+ test) | PR state and next action (R2) |
| `dashboard/lib/pr-comments.js` (+ test) | Comment rows, their states, drafted replies (R3) |
| `web/src/jobpage/JobPage2.tsx` | Mount, layout by width, keys |
| `web/src/jobpage/jobStore.ts`, `useJob.ts`, `api.ts`, `types.ts` | Store, selectors, fetches, payload types |
| `web/src/jobpage/left/` — `Header.tsx`, `YourMove.tsx`, `Steps.tsx`, `JobRows.tsx`, `MessageBox.tsx`, `AsksRow.tsx` | The left pane |
| `web/src/jobpage/reader/` — `Reader.tsx`, `TitleRow.tsx`, `MessageView.tsx`, `DocView.tsx`, `ChangesView.tsx`, `FindingsView.tsx`, `ChecksView.tsx`, `ConversationView.tsx`, `TicketView.tsx`, `DecisionsView.tsx`, `DetailsView.tsx`, `PrView.tsx` | One file per reader view |
| `web/src/jobpage/notes/` — `Pointable.tsx`, `NoteBox.tsx`, `Pins.tsx`, `chips.ts` | Point, then say (R4) |
| `web/src/jobpage/asks.ts`, `Palette.tsx` | The asks table and `⌘K` (R6) |
| `web/src/jobpage/phone/` — `PhoneJob2.tsx`, `PhoneStep.tsx`, `PhoneReader.tsx` | Phone screens |
| `web/src/jobpage/jobpage.css` | The page's styles, theme tokens only |
| `web/src/jobpage/fixtures/longJob.ts` | Made-up long job for tests |
| `web/e2e/jobSpeed.mjs` | The seven speed checks |

Each `.tsx` has a `.test.tsx` beside it.

---

## Phase 0. Pin the ground

### Task 0: Read, measure, write the interface note

**Files:** create `.superpowers/sdd/<this plan's workspace>/interfaces.md` (untracked). No code.

- [ ] Read the "Read first" list. Click through every scene of the prototype on Laptop and Phone.
- [ ] Read `web/src/job/page/JobPage.tsx`, `web/src/job/NextStep.tsx`, `web/src/panes/Foreman/GateCard.tsx`, `gateSent.ts`, `Composer.tsx`, `useJobThread.ts`, `thread.ts`; `dashboard/runner/index.js` `jobDetail` (about line 1153) and the read table (about line 3476); `dashboard/lib/thread.js`, `stage-view.js`, `session-log.js`, `compose.js`; `dashboard/site/index.js` and `routes-jobs.js`.
- [ ] Write `interfaces.md`: for each payload field, where the runner already has the value; the exact body the gate route takes today for Go, Send back and a message; where SSE events are broadcast; what `api.hosted()` changes. Fix the payload shape above where the code disagrees.
- [ ] Baseline numbers with the demo (`npm run demo`, its own port, never 4477): time to first paint of a job, time for a step pick, server time for `/api/job/:slug` and `/stage/:stop`. Record them in the ledger; Task 23 compares against them.

**Done when:** the note exists, the ledger has the baseline, and every later task's "Consumes" line can be answered from the note.

---

## Phase 1. Speed foundation (server and data; nothing he sees yet)

### Task 1: The payload builder

**Files:** create `dashboard/lib/job-page.js`, `dashboard/test/job-page.test.js`.
**Produces:** `buildJobPage(facts)`; `headlineOf(item)`; `stateOf(facts)`.

- [ ] Tests first, each on a small hand-made `facts` object:
  - `state` is exactly one of the five words; a job at a gate is `needs-you`; a job with a live reply is `working`; a paused job is `paused` even when old crew rows exist (see Task 3).
  - a reply's `headline` is its first bold sentence, else its first sentence, cut at 140 characters on a word; his own message's is its first sentence; a brief's is `Brief #15 · Review · answered: Go` or `· waiting`.
  - notes, decisions made for him and routine events are `kind: 'small'`.
  - `steps` holds only the latest version of each document; a step that is done carries no state word.
  - `open` follows decision 2.
  - a gate's questions carry `recommended` on exactly one option each; `goSays` names what Go does at this step (`open PR #1`), and the page adds `all recommended` or `1 changed`.
  - Review findings count as open only when their status in the latest review document is open. (Known fault: ORBIT-471 showed `2 open` when both were fixed. Find where the stale status comes from and fix it there, with a test.)
- [ ] Implement, pure, no I/O.
- [ ] Run `nice -n 15 node --test --test-timeout=240000 dashboard/test/job-page.test.js`; all pass. Commit.

### Task 2: A made-up long job

**Files:** create `dashboard/test/fixtures/long-job.js` (builds `facts`), `web/src/jobpage/fixtures/longJob.ts` (the payload and bodies as the web sees them), and one long job in the demo (`dashboard/demo/`).

- [ ] Shape it like the real one: 52 thread items (16 Foreman replies with a median of 450 words and one of 800, 16 of his messages, 15 briefs, 5 small notes), seven steps, 22 review files of which the latest of each kind shows, 2 findings, 9 commits over 14 files, one recording, three PRs. Text is invented. Add a second fixture four times as long (200 items) for the speed checks.
- [ ] A test that the fixture's counts are what this task says, so later tests can rely on them. Commit.

### Task 3: Work that has ended reads as ended

**Files:** modify the job-state code the snapshot uses (find it from `working` and `nowDoing` in `dashboard/runner/index.js` and `dashboard/lib/live.js`); test in `dashboard/test/`.

Seen on the running Starbase on 13 Nov: job ORBIT-463 was paused, yet `working: true` with two `nowDoing` rows whose last activity was before the last restart. This is his "running them forever".

- [ ] Reproduce with a test: activity rows older than the server's start, or with no live process behind them, on a paused job.
- [ ] Find the root cause (superpowers:systematic-debugging) and fix it there: a row with no live process is not working, and a paused job is never `working`.
- [ ] The same rule feeds `stateOf` (Task 1) and `work-rows.js` (Task 5). Commit.

### Task 4: The cache, the routes, the event

**Files:** create `dashboard/lib/job-page-cache.js`, `dashboard/site/routes-job-page.js`, tests `dashboard/test/job-page-cache.test.js`, `dashboard/test/job-page-server.test.js`; modify `dashboard/site/index.js` (register) and `dashboard/runner/index.js` (tell the cache when a job changes; broadcast `job-page`).
**Consumes:** `buildJobPage`. **Produces:** `GET /api/job/:slug/page`, `GET /api/job/:slug/item`, SSE `job-page`.

- [ ] Tests: `v` does not move when a rebuild gives the same JSON; `?v=<current>` answers `{ same: true }`; a body of an answered brief is rendered once (count the renders); a request never triggers a rebuild, a `git`, a `psql` or a read of an agent log (spy on the spawn helper and the log reader: zero calls); an unknown slug is 404; the website's mirror gets the same payload shape with `hosted: true` and without local-only fields.
- [ ] Implement. Rebuild on the runner's existing change points, debounced 150 ms per job.
- [ ] Measure with the 200-item fixture: `page` under 100 ms warm (aim for under 20), `item` under 50 ms. Record in the ledger. Commit.

### Task 5: Details rows

**Files:** create `dashboard/lib/work-rows.js`, `dashboard/test/work-rows.test.js`; route in `routes-job-page.js`.

- [ ] Tests: one row per piece of work, newest first: step, role and model, **the task it was given** in one line (the first instruction in its log, not its last tool call), how long, how it ended (`Done`, `Stopped`, `Failed: <one line>`, `Running`); cost by step under the table; no tool-call lists; a row is `Running` only by Task 3's rule.
- [ ] Implement with a cache keyed by each log file's size and time, so an unchanged log is never read twice. Commit.

### Task 6: A store that redraws only what changed

**Files:** create `web/src/jobpage/jobStore.ts`, `useJob.ts`, `api.ts`, `types.ts` and tests.
**Produces:** `createJobStore(slug)`, `useJob(selector)`, `loadPage()`, `loadBody(id)`, `prefetch()`.

- [ ] Tests: two components reading different fields; changing one field re-renders only its reader (count renders); a `job-page` event with the same `v` causes no fetch; a newer `v` causes one fetch and no re-render of parts whose data is equal (keep old object identity for unchanged parts); `loadBody` twice makes one request; prefetch order follows the Architecture section; a failed fetch leaves the last good data and sets one error line.
- [ ] Implement with `useSyncExternalStore`. No timers. Commit.

**Phase 1 ends:** whole server suite and web suite once; record totals in the ledger.

---

## Phase 2. The frame: read and answer (revision 2 of the brief)

For every task here: build against `fixtures/longJob.ts`; look at the result in the demo beside the prototype at 1512, 1100, 900, 390 and 360 px before calling it done; sizes and spacing come from the prototype's `page.css`.

### Task 7: Shell, layout, switch, addresses, keys

**Files:** `web/src/jobpage/JobPage2.tsx`, `jobpage.css`; modify `web/src/app/App.tsx`, `web/src/views/Hosted/HostedWorkshop.tsx`, `web/src/app/router.ts`, the old page's menu (one item).

- [ ] Tests: the switch mounts the new page only when `sb.jobPage` is `new`; old addresses open the right step or view; `read/<kind>/<id>` round-trips; a pick rewrites the address in place; at 1100 px and wider two panes, between 760 and 1100 the reader covers the left pane with a back row and focus moves to it, at 760 and under the phone screens; crossing a width keeps the draft, the picks and the reader target; `[` `]` `j` `k` `Enter` `/` `g c` `g t` `?` work and never fire while he types in a field.
- [ ] Implement. First paint from the snapshot row passed as a prop. Commit.

### Task 8: Header

`left/Header.tsx`. Ticket key linking to Orbit, title, one state word; dim level, repository, cost; the Auto switch (reuse `AutoSwitch`, made optimistic: it flips at once and flips back with a line if the server refuses); the `⋯` menu with everything rare (Mark done or dropped, Notes and options, Change model, Permissions for this job, Copy decisions, How this page works, Open the folder in a terminal, the page switch). Tests: one state word only; the website hides the local items; menu items open the same sheets as today. Commit.

### Task 9: Your move

`left/YourMove.tsx`. Consumes `move`, `asked`, the gate route.

- [ ] Tests: a gate shows the ask once, each question with its options, `recommended` on the Foreman's pick, `Your own answer` last; **the recommended options are already picked and Go is awake** (R1); Go's label is `Go · all recommended`, then `Go · 1 changed` after a change; `↑` `↓` `Space` move and pick, `⌘↵` is Go from anywhere on the page; `n decided for you · confirmed by Go` with `Look`; a free-text ask shows the quoted replies as quick replies that fill the message box and send nothing; a permission takes the slot with the exact command and `Allow once`, `Deny`, `Always allow…`; when the job does not wait the slot is one line; Go shows `Sent` at once, sends once however fast he clicks, and puts the picks back with a plain line if the server refuses; the body sent to the gate route is byte for byte what today's card sends for the same picks (compare against `GateCard`'s output in a test).
- [ ] Implement. Extract nothing from `GateCard.tsx`; write the small amount of pick state fresh and prove equality by the test above. Commit.

### Task 10: Steps and the job rows

`left/Steps.tsx`, `left/JobRows.tsx`. Seven rows, one line each, state mark, name, dim duration; the current step open with its outputs; a click opens the step and shows its main output in the reader; `Ticket and goal`, `Conversation · 52 · 1 new`, `Decisions · 13 made for you`, `Details`. Tests: only a step that is not done carries a state word; outputs list only latest versions; opening a step never changes the height of anything above it; with the ask folded to its headline the pane fits a 900 px tall window on the long fixture. Commit.

### Task 11: The message box

`left/MessageBox.tsx`. One box, docked, grows to eight lines.

- [ ] Tests: the draft survives a refresh, a step pick, a permission card, a width change and a reload (reuse the `fw.draft.<slug>` key so the old page's draft carries over); words with Go travel as the approval's note, words with Send back as the change, words alone as a message (R8: no Reply mode); Send shows `Sent` at once and puts the words back if refused, with the server's reason in plain words (limit reached, the terminal holds the job).
- [ ] While a reply runs the box says `Sends when the Foreman finishes`, with `Stop it and send now` beside it; no Steer (wired in Task 16). Commit.

### Task 12: The reader and its text views

`reader/Reader.tsx`, `TitleRow.tsx`, `MessageView.tsx`, `DocView.tsx`, `TicketView.tsx`, `DecisionsView.tsx`.

- [ ] Tests: the reader shows exactly one view; every view has the same title row (what, version, when, previous and next, older versions); body text 15 px on a 24 px line, at most 80 characters; headings one step above body; the part that asks him carries the left rule; a document shows `Key points` first when it has them and an outline at the right edge when the reader is wide enough; older versions open from the title row; switching views keeps each view's own scroll place; a body not yet loaded shows the title row at once and reserves no jumpy height.
- [ ] Implement, reusing `DocReader` and `ServerHtml` for rendering where they fit. Commit.

### Task 13: The conversation

`reader/ConversationView.tsx`.

- [ ] Tests on the long fixture: about 50 lines, grouped `Review · Tuesday`; each past item one line (who by position and tint, not a grey word); a click opens it in place and a second folds it; small events are `5 small events`, opening on a click; the last exchange is open on arrival with a line where new ones start; `Open all in this step`, a filter box that narrows as he types, `Jump to latest`; **a new message arriving while he reads adds a line and moves nothing on screen** (assert `scrollTop` and the bounding box of the item under the pointer are unchanged); opening an item above the fold keeps the clicked line where it was.
- [ ] On the 200-item fixture, opening the conversation commits in under 100 ms in the jsdom timing test and renders only the lines, not 200 bodies. Commit.

### Task 14: Changes, findings, checks and recording, details

`reader/ChangesView.tsx`, `FindingsView.tsx`, `ChecksView.tsx`, `DetailsView.tsx`.

- Changes: commits as a small list, files on the left, the diff on the right at full width; the diff of the first file is fetched ahead; a file pick paints at once when fetched and never moves the file list.
- Findings: open first, one line each with severity and file, opening to detail; fixed and not doing folded; `8 reviewers found nothing else` as one line; no card per reviewer.
- Checks and recording: the video or pictures large, the checks as a short list, `Record again`, which commit it was made on, said plainly when older than the final commit; `Your hand test` (R7): the list to check, `Start the app`, `Open it`, `It works`, `Something is wrong…`. Hidden on the website where Try it is hidden today.
- Details: the Task 5 table; `Open in terminal` only on a running row and never on the website.

Tests for each bullet. Commit per view.

### Task 15: Phone

`phone/PhoneJob2.tsx`, `PhoneStep.tsx`, `PhoneReader.tsx`. Its own three screens by address, not the laptop squeezed: job screen (back, title, state word, Your move in full, steps, job rows, the message box fixed at the bottom), step screen, reader screen with a back row. Tests: the order of the job screen; the back row follows history; no sideways scroll at 390 and 360 px (`noEmptyScroll.mjs` extended to the new page); the box never covers the last row. Commit.

**Phase 2 ends:** whole suites, build, `noJump.mjs`, `noEmptyScroll.mjs`, `themeSweep.mjs`, `contrast.mjs` against the demo with the new page switched on; `jobSpeed.mjs` (Task 23 may be pulled forward) for rules 1, 2, 3, 5, 6. **Then stop and tell the owner:** the reading page is ready behind the switch; with his word it goes to `main` with the old page still the default, so he can use it on real jobs.

---

## Phase 3. Acting (revision 3: R4, R5, R6, R8)

### Task 16: Queued messages (R8)

**Files:** `dashboard/lib/queued.js`, test; modify the send route in `dashboard/site/routes-jobs.js` and the runner's end-of-reply point; `left/MessageBox.tsx`.

- [ ] Server tests: `send` with `queue: true` while the Foreman works stores one message for the job and answers 202; it is sent when the reply ends, once; a second queued message replaces the first only with `replace: true`, else 409 naming the first; it survives a Starbase restart; cancel removes it; limits and the terminal lock still refuse when it is time to send, and the payload then says why in `queued`; Auto never queues.
- [ ] `Stop it and send now` stops the run, then sends. The page shows the queued words under the box with `Cancel`. Commit.

### Task 17: Point, then say (R4)

**Files:** `web/src/jobpage/notes/*`, `dashboard/lib/notes-block.js` and tests.

- [ ] `notes-block.js`: `composeNotes({ notes, words }) → string`. Tests fix the text exactly:

```
--- Notes (3) ---
1. [change] Plan v2 · step 4 "Add the filter to the table"
   > the words he pointed at, at most 300 characters
   Note: use the existing badge
2. [drop] Spec v3 · acceptance line 6
   > …
3. [pin] Recording 0:14 · pin 1 at 62% across, 18% down
   Note: the Apply button sits on top of the table
--- End of notes ---
```

  followed by his typed words, if any. Kinds: `change`, `drop`, `explain`, `pin`.
- [ ] `Pointable`: every block in the reader (a plan step, a spec paragraph or acceptance line, a diff line, a finding, a check, a paragraph of a Foreman message, a decision) shows `+` in its left margin on hover; a click, a text selection or `n` opens a note box in place with `Change`, `Drop this`, `Explain`. `Pins`: a click on a recording frame or a screen drops a numbered pin with a note box; pasting an image into the message box opens it in the reader to pin on.
- [ ] Notes gather as chips in the message box; a chip jumps to its place; `×` removes it; they survive a reload. At a gate: `Send back · 3 notes` and `Go · and do these 3`; elsewhere `Send · 3 notes`. `Show what will be sent` shows the exact text. `Explain` sends at once and its answer opens beside the block.
- [ ] Tests for each sentence above, plus: the `+` never changes line height or shifts text; a note on a block that a new document version removed says so instead of vanishing. Commit in two or three steps.

### Task 18: The answer to each request (R5)

**Files:** `notes-block.js` (`parseAnswered(reply) → NoteAnswer[]`), `job-page.js` (`asked`), `left/YourMove.tsx`, `reader/DocView.tsx`; the skills repository (see Task 24 for how to work there).

- [ ] The Foreman's answer format, parsed from the end of its reply:

```
--- Notes answered ---
1. done · Plan v3 · step 4 removed
2. done · commit abc1234 · EmployeesTable.tsx
3. not done · the badge component has no small size
--- End ---
```

- [ ] Tests: the parser is strict about the fence lines and forgiving about spacing; a reply without the block gives `asked: null` and the page shows the reply as today; `What you asked · 3 of 3 done` with a line per note opening that exact change; a note not done shows why and `Ask again`; a document with an older version has `What changed since v2` marking added and removed lines.
- [ ] Skills: `/feature` and `/bugfix` Foremen are told that a message with a `--- Notes (n) ---` block is answered note by note and ends with the answered block. Commit in both repositories.

### Task 19: Asks and `⌘K` (R6)

**Files:** `web/src/jobpage/asks.ts`, `left/AsksRow.tsx`, `Palette.tsx`.

- [ ] `asks.ts` is one table: id, label, the exact text it sends, the steps it shows on, whether it needs a word. Use the table in the brief (R6). Tests: at most four in the row, fitted to the open step; an ask with nothing to fill sends at once and shows `Sent · Undo` for four seconds (Undo cancels before it leaves: hold the send for those four seconds); an ask that needs a word puts its text in the box with the cursor in the gap; hovering shows the exact text; `⌘K` lists all asks and the page's places with a search field; `Go faster` posts the job's options (one reviewer a round, no second looks) and says what it switched, with Undo restoring the options it replaced; `Keep as an ask` from a sent message's line stores it under `sb.asks.kept` and lists it under `Yours`.
- [ ] No hidden prompts anywhere: a test walks every ask and asserts its text is shown on hover. Commit.

**Phase 3 ends:** suites, build, browser checks, then tell the owner what is new behind the switch.

---

## Phase 4. Pull requests on the page (R2, R3, R7)

Before building, write a one-page design note in the plan's workspace and rule on these, from the code (`dashboard/lib/pr-feedback.js`, `review-round.js`, `gh-write.js`, `flow.js`, `git.js`, `nudges.js`, and `usage.md` Part 2):

- One list of comment rows is the truth. Today a comment can become a Needs-you card (`pr-feedback.js`) or part of a review round (`review-round.js`), and no job ever used either. The lead's recommendation: comments become rows of the PR view; the Needs-you card becomes one line in Your move (`PR #1 · 3 new comments`); a review round is the same list with the reviewer's verdict on top; `review-round.js` keeps doing the push, reply, resolve and re-request sequence behind `Push the fixes`. The old review panel leaves the job page; its routes stay for the other screens that use it.
- Every write to GitHub goes through `gh-write.js` and needs his click. A click on a PR button is that yes. Nothing else may push.

### Task 20: PR lines with one next action (R2)

**Files:** `dashboard/lib/pr-lines.js`, test; `routes-job-page.js`; `left/Steps.tsx` (Ship), `left/AsksRow.tsx`.

- [ ] Server tests, with `gh` and `git` faked: each of PR #1, #2, #3 gets a state from GitHub and at most one next action: `not open` → `Push and open PR #1`; `open` with commits not pushed → `Push update (2 commits)`; `merged 2:02 pm` → none; PR #2 `not open` → `Open PR #2` only after PR #1 merged; `open` → `Request review`. `says` lists exactly what will go: the commits, from which branch to which, the title. GitHub unreachable or `gh` signed out: the line says so and has no button. A PR merged, reviewed or opened by hand is noticed on the next read and the Foreman is told with the existing fixed sentences (`nudges.js`); he never types "merged".
- [ ] Web: the first click opens the line in place with `says`; the second (`Push and open`) is his yes. It sends the fixed sentence for that action with a go-ahead that covers exactly this job's push to its own fork branch and its own `gh pr create`, through the go-ahead Starbase already has for the PR steps (`dashboard/test/go-ahead.test.js` shows it). **Do not add a second way for a push to be allowed.** Do Task L3 (the go-ahead covers only the push) before this ships.
- [ ] GitHub is read when the page opens if the last read is older than two minutes, and on `Pull now`; never on a timer from the page. Commit.

### Task 21: PR comments (R3)

**Files:** `dashboard/lib/pr-comments.js`, test; `reader/PrView.tsx`; the skills repository.

- [ ] Server tests, `gh` faked: every comment not answered yet is a row, **including ones made before Starbase first looked and ones from his own login**; each row has who, file and line, the full comment, the three code lines it sits on, and a state (`New`, `Fixing`, `Fixed in abc1234`, `Left`); `Pull now` reads at once and reports `read just now`; a failed check has its failing lines (`failedLog`) and a `Fix it` action.
- [ ] `Fix these` sends one prepared message quoting each ticked comment (id, file, line, words) and marks them `Fixing`. The Foreman's answer carries, per comment id, the commit that fixed it and a drafted reply; parse it like Task 18's block (`--- Comments answered ---`).
- [ ] Web tests: new comments are ticked; `x` ticks the one under the pointer; the bar reads `3 ticked · Fix these · What is he asking? · Leave`; after the Foreman is done each row shows `Fixed in abc1234` (opens that commit's diff) and its drafted reply, editable in place; `Copy` with `Open on GitHub` is the default, `Post it` posts through `gh-write.js` and shows `Posted`; then the PR line's button is `Push the fixes (2 commits)`.
- [ ] Skills: the `/feature` PR section and `/bugfix` say how to read review comments (line comments, reviews, conversation comments), to fix on the job's branch one commit per comment, never to push or reply on GitHub, and to answer with the block and a drafted reply per comment in the reply style of `tools/skills/ship/review-rounds.md`. Commit in both repositories.

### Task 22: The asks for Ship and the hand test (R6 Ship row, R7)

The Ship row of the asks table (`Pull PR comments`, `Shorten the PR text`, `Mark done`, and the PR's next action by the rule in "Open with the owner"); the hand test's `It works` and `Something is wrong…` send their fixed texts. Tests as in Task 19. Commit.

**Phase 4 ends:** suites, build, browser checks; an end-to-end run of the PR path against the demo with faked `gh` (open, comment, fix, reply, push). Tell the owner.

---

## Phase 5. Prove it, switch over

### Task 23: The speed checks

**Files:** `web/e2e/jobSpeed.mjs` (Playwright, against the demo with the 200-item job, GET only except the demo's own fakes).

- [ ] One check per speed rule, each printing its number: (1) header, Your move and steps painted within 150 ms of the click on Jobs; (2) step, document, message and conversation picks under 100 ms at the 95th percentile over 30 picks; (3) zero layout shift not caused by input (PerformanceObserver `layout-shift` with `hadRecentInput` false) over a two-minute run with messages arriving; (4) `Sent` within 50 ms of Go, and the picks back after a refused Go; (5) with the page idle for 60 s, zero React commits and zero requests except the event stream; one arriving message commits only the conversation count and the line; (6) `page` under 100 ms and no `git`, `psql` or log read during a page open; (7) no transition or animation in `jobpage.css` over 120 ms (a static test).
- [ ] Run it with two other test runs going, as his laptop usually is. Record the table in the ledger. Any miss is a bug to fix, not a number to explain.

### Task 24: The skills changes, checked

Work in a new worktree of `/Users/moxie/Projects/claude-feature-workflow` on a branch `feature/job-page-asks`. The skills are linked live from that repository's `main`, so nothing changes for running jobs until it is merged there. Read each changed section back as the Foreman would get it; run the repository's own checks if it has any. No `install.sh`.

### Task 25: Whole-branch review, then his hands

- [ ] Whole suites, build, all browser checks at 1512, 1100, 900, 390 and 360 px, every theme.
- [ ] A final review by a fresh reviewer (superpowers:requesting-code-review) against the brief, this plan and the Review focus below. Fix what it finds once; re-review the fixes.
- [ ] Write the hand-over: what is built, the speed table, the by-hand list for him (each scene of the prototype, on ORBIT-471 or another long real job), what is not built.
- [ ] **Ask for his word** to put it on `main` behind the switch (if not already there from Phase 2), then for his word to make it the default.

### Task 26: Make it the page (only on his word)

Default `sb.jobPage` to new; remove the switch after a week of his use or when he says; then delete `web/src/job/page/` and the parts only it used, moving or rewriting the tests that still guard shared parts (audit 5.1 and 5.3 list them). `NextStep`, `GateCard`, `ConversationPanel` and friends stay while the quick look, the Desk and stack parts use them; moving those screens to the new parts is the "other pages" work he said comes after the job page. The heavy `GET /api/job/:slug/stage/:stop` route is removed when nothing calls it.

---

## Review focus

Inputs no single task owns, most likely to bite first. Each has a test in the task named.

1. **A much longer job than the fixture** (200 items, a 2,000-word reply, a 5,000-line diff): the conversation still opens under 100 ms and the diff does not freeze the reader. Tasks 13, 14, 23.
2. **The job changes while he is in the middle of something** (typing, three notes collected, a note box open, a permission arrives, a new document version lands): nothing he made is lost and nothing moves. Tasks 9, 11, 13, 17.
3. **The server says no** (usage limit, the terminal holds the session, the gate went stale, Starbase restarted): every optimistic `Sent` corrects itself with the reason in plain words and his words back in the box. Tasks 9, 11, 16, 19.
4. **The website**: the same page with `hosted: true`: nothing local shows, decisions queue, nothing errors when commits, Try it and terminals are absent. Tasks 4, 8, 14, and `views/Hosted/Mirror.test.tsx`.
5. **GitHub is not there** (`gh` signed out, no network, the PR closed by hand, a force-push that removed commented lines): lines say what is known and when it was read; no button that cannot work. Tasks 20, 21.
6. **A brand-new or odd job** (no thread yet, no gate, a quick-route job with skipped steps, a bug-fix job with its own steps, a closed job): the page says one true line and shows the steps that job really has. Tasks 1, 7, 10.

---

# Part 2. Everything else left over from the Auto queue build

The full record is `.superpowers/sdd/2026-11-12-auto-queue-plan/handover.md` (status, first-start notes, 24 known gaps) and `progress.md` beside it (the ledger). The plan and rulings are `docs/plans/2026-11-12-auto-queue-plan.md` (rulings 22 to 68). The end-to-end harness is saved in `.superpowers/sdd/2026-11-12-auto-queue-plan/m3-harness/` (`run.mjs`; its commands are in the ledger; it needs a copy of the code beside it with links to `node_modules`, `web/node_modules` and `web/dist`; a database run uses only a scratch database named `sb_m3_…` that the runner creates and drops).

## Small builds (Opus; own branch each, cut from `main`)

### Task L1: `core.fsmonitor=false` on Starbase's own git calls

git runs a program named in a job folder's git settings when Starbase runs git there. The lead recommended yes; the owner did not object. Build it unless he says no.

- [ ] Find every place Starbase starts git: `dashboard/lib/locate.js`, `repos.js`, `local.js`, `git.js`, `decisions.js`, `integrate.js`, `review-round.js`, `gh-write.js`, `auto-env.js`, `close.js`, `levels.js`, `hard-lines.js`, and the runner. Put the option in one helper they all use.
- [ ] Test: a repository whose config names a program in `core.fsmonitor`; after each kind of Starbase git call the program has not run. One test walks the source and fails on a git spawn that does not go through the helper.
- [ ] Whole server suite; the harness's no-database run (21 checks) still passes.

### Task L2: CI is red on `main`; make it green (do this first)

- Locally the whole server suite is 2,105 of 2,106: `gate-server` test "I2 B" fails, on `main` before the Auto queue too.
- On GitHub the `Tests` workflow has failed on `main` since 11 Nov. For `912703e` (run `43466953613`) the macOS job failed in the step `Server tests (dashboard/)`, so its web tests were skipped; the Windows job was still running when this was written, and it is the first Windows run of this code. The logs could not be read before the run finished.
- [ ] `gh run view 43466953613 --log-failed` in `/Users/moxie/Projects/feature-workshop` (reading only). List every failing test on each system. More than "I2 B" may fail there: tests that need this laptop's tools, or that time out on a slower machine.
- [ ] For each: find the root cause with superpowers:systematic-debugging; fix the code or the test, whichever is wrong, and say which in the commit. A test that cannot run on CI is skipped there by a stated condition, not deleted.
- [ ] Green on both systems is the goal; a Windows-only failure in a part he does not use on Windows (he has no Windows laptop) may be listed for him instead of fixed, with the reason.

### Task L3: The go-ahead for a push covers only the push

On a job that is not Auto's, at a PR step, his go-ahead for a push covers the whole command line, so `git push origin feature/x; npm publish` on one line runs with it (known gap 11; on `main` for a long time). The lead recommends narrowing it; it changes an everyday behaviour (a chained command becomes a card for him), so **ask him in one line before building**. It must be in before Task 20 ships, because that task makes the push a button.

## Decisions that stay open with the owner (nothing to build until he says)

| Item | State |
|---|---|
| The crew's commands and his database under Auto | Went live as built: only what Starbase itself starts for a recording is fenced; the crew's commands are judged by the rules. Options if he asks: a fixed refusal for starting the app under Auto, or fencing the crew's whole session (large). |
| A notice when Auto refuses a secret read | Not built. Refused calls are listed in Starbase, not notified and not in PR #1's text. Default: no notice. |
| Pushing the skills repository | `main` is at `0e3ff64`, well ahead of `origin/main`, never pushed. Push on his word. |

## Things only he can do

- Look at the Auto tab once: jobs Auto finished before today show under `Ready for you to try` until he acts on each or closes it.
- Auto start is **on** (tag `Vig auto pickup`, up to 5 at once). On 13 Nov it showed paused because Starbase could not read his Claude limit (the usage read answered 429); it carries on by itself when the read works.
- Announcements follow-ups: click `This is the job's branch` on its page.
- ORBIT-463: Auto is off; its guessed branch belongs to another ticket, so it needs its own branch before Auto goes back on.

## Cleanup (each needs his word; these are deletes)

- Merged branches and their worktrees: `feature/auto-queue` (no worktree now), `feature/auto-queue-db` (`~/Projects/starbase-job-page-evidence`), `feature/auto-queue-web` (`~/Projects/starbase-job-page-screens`); skills `feature/auto-queue` (`~/Projects/claude-feature-workflow-feedback`). The older `feature/job-page*` branches hold the pre-rewrite history of the first job page.
- In the system temp folder: about 115 empty `starbase-pgsysconf-*`, a dozen `sbf-*`, a few `starbase-local-db-*`, one `sb-walk-*`.
- The old session's scratchpad (reviewers' code copies, harness run folders, pictures). What matters from it is already copied into `.superpowers/`.

## Known gaps worth a look later (not planned work)

From `handover.md`, the ones he is most likely to meet: Auto does not wait for the recording, so evidence can arrive after PR #1 (13, 14); the gate card's `N decisions made by Auto` and `What Auto decided` count different things (20); `What Auto decided` lists a card by the crew's description, not the command (19); at phone width Jobs with a fold open, Telemetry and Settings → Workflow are wider than the screen (22); nothing has run on a Windows laptop (23).

## After the job page

His words: "lets do this for job page first and then move on to other pages if we like it." The quick look on Jobs, the Desk and the stack part page still use the old bar, gate card and conversation; they are next if he likes this page.

## Going live, when he says so

1. No job mid-reply: `GET /api/features` on 4477, no job with a live reply (a paused job with old rows does not count; check the server process has no child processes).
2. In `/Users/moxie/Projects/feature-workshop`: `git merge --ff-only <branch>`, `npm run web:build`.
3. Skills, if changed: merge to `main` in `/Users/moxie/Projects/claude-feature-workflow`, then `./install.sh` there.
4. `launchctl kickstart -k gui/$(id -u)/com.moxie.starbase`; the first request after a start can take about 25 seconds; then check `/api/features`, `/api/snapshot` and `/next/`.
5. `git push origin main` (deploys the website). Check the deploy and `gh run list`.
6. Write it in the ledger and in the memory note `starbase-job-page-redesign`.
