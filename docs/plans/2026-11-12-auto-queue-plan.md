# Auto queue: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto jobs run in their own queue beside his: up to N at once, no questions until PR #1, testing one at a time on a database that belongs to Auto, too-big tickets set aside, with `Auto` tabs in Jobs and the Inbox on the laptop and the website.

**Architecture:** The Auto record in Starbase's own `sessions.json` gains how the job began, its risky count, the too-big mark and when he acted after PR #1; one pure function turns a record into the group it shows in, and one pure function builds the queue (places, ceiling, the Inbox's Auto groups) that the snapshot carries to the laptop's pages and, through the board record, to the website. Auto's pass (`dashboard/runner/auto.js`) refuses on the card where it stopped, asks the Approver a second time for the safer answer where it stopped on a judgment, runs L3, holds the Go into Test while another Auto job tests, sets too-big jobs aside, and hands the Foreman the risky calls with its go-ahead for PR #1, for the PR's description. Try it's database code (`dashboard/lib/local.js`) gains Auto's own database copy and the fast copy; the recorder (`dashboard/runner/evidence.js`) records an Auto job on it. The workflow skills change in their own repository so the Foreman carries on where Starbase now does.

**Tech Stack:** Node 24 (ES modules, `node --test`) in `dashboard/` and `hosted/`, React + TypeScript + Vite + vitest in `web/`, Postgres command-line tools (`createdb`, `dropdb`, `psql`), Markdown skills in `/Users/moxie/Projects/claude-feature-workflow`.

**Spec:** `docs/plans/2026-11-12-auto-queue-design.md` at 69d1dc5 (all of it, binding; Q15 to Q17 answered: yes, yes, and (b), risky calls in Starbase and in PR #1's description). Executors read the design's sections 1 to 10, "How it is built" and "Risks" before their task.

## Global Constraints

- Build on the branch and worktree the lead names (`feature/auto-queue`, from `main` 8c794b8, for Starbase; `feature/auto-queue` from `main` e1fb596 in the skills repository). Never push. Never read, write or list `~/.starbase`, and never open port 4477: that is the owner's running Starbase. It is rebuilt only when he asks. Never read a `.env*` file. Never run `install.sh`: installing the skills is go-live, not a task.
- **Read first.** This plan was written against `9eeea1f`. Functions are named so you can find them; line numbers are from that read and will move. Every task starts by reading the files it names as they are now. Where an earlier task already built something a task asks for, keep it and its test, say so in the task report, and add only what is missing.
- The job page is `web/src/job/page/` (`JobPage.tsx`, `JobTop.tsx`, `PhoneJob.tsx`), mounted by the router and by `web/src/views/Hosted/HostedWorkshop.tsx`. The old `JobHeader` and `ForemanPane` are mounted by no page: build nothing into them.
- **The owner's one requirement for the job page** (2026-11-11): the bar with `No go: send back`, `Reply` and `Go: …` is on every step that waits for him, on Auto jobs too, whether Auto is on, deciding, stopped, set aside or waiting for its turn to test. No task hides or disables the three calls because of `job.auto`.
- **Auto leaves a step to him once he writes** (`wroteWhileWaiting`, `YOURS_NOW` in `dashboard/lib/auto.js`; `triage` and `attend` in `dashboard/runner/auto.js`). It stays a stop. Every new message Starbase itself sends to the Foreman uses a kind added to `OWN_SENDS`, or it would read as his.
- Tests first: write the failing test, see it fail, then the code. Server tests use a temp state folder and port 0 through `dashboard/test/helpers/dashboard.js`, as `dashboard/test/auto-server.test.js` and `evidence-server.test.js` do. No test calls a real model, a real browser or a real Postgres: the Postgres tools are fakes (Task 8).
- Commands: `npm test` (dashboard), `npm run web:test` (web), `npm test -w hosted` (website), `npm run web:build` (type check and build). One file: `node --test dashboard/test/<file>.test.js`, `npx vitest run <path>` with cwd `web/`. `dashboard/test/gate-server.test.js` "I2 B" fails on `main` too: not a finding. `STARBASE_FLOW_QUIET=1` is a test-only setting; never set it outside tests.
- Say **Starbase** in every string. On the server the name comes from `PRODUCT` (`dashboard/lib/brand.js`); in `web/src` it comes from `BRAND.name` (`web/src/app/brand.ts`), never written out. Words on screen are plain, in short sentences, with no dash used as punctuation. Strings quoted in this plan are exact: the design's where it gives them, else marked "plan's words" and listed in Rulings.
- Every screen works in laptop mode and in hosted (website) mode (`api.hosted?.()`). Each web task tests both.
- A push to `main` releases the website, but the laptop is rebuilt only when the owner asks, so the website can show a record from an older Starbase. Every field this plan adds to `web/src/api/types.ts` is optional (`?`), and every reader treats a missing one as "not known": no Auto group, no count, no line.
- Colours, sizes and spacing come from `web/src/theme/tokens.css`. `cssRules.test.ts` and `scrollAreas.test.ts` stay green. New classes carry the `sb-` prefix. `web/e2e/noEmptyScroll.mjs` and `web/e2e/noJump.mjs` stay clean on the Jobs page at 1280, 1512 and 1920 px.
- Phone screens (760 px and under, `useNarrow()`) are their own simple layouts, not the laptop squeezed.
- The mirror never carries keys named `diff`, `patch`, `env`, `token` or `source`: no new field uses those names. Database addresses never leave the laptop (no field holds one).
- Nothing existing is lost: today's lanes, list and floor stay under `Yours`; Try it's three database actions stay; every stop that the design keeps stays a stop.
- Commit at the end of each task. End messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A job's app ignores the database address Starbase gives it** and connects to his `moxie_snapshot` (an app that reads its own settings file over the process's environment). Expected: the recording never starts, the Test step says why, his database is unchanged. Test in Task 9 (`the recording refuses an app that connects elsewhere`).
2. **Auto's database copy fails half way** (`createdb` fails after `dropdb` took the old `__auto` away, or a migration fails on it). Expected: nothing is recorded, his database and the saved original are never named except as a copy's source, `dbBusy` is free again, and the next turn builds `__auto` afresh. Tests in Task 8 (`a copy that fails leaves the original and his database as they were`) and Task 9 (`a migration that fails goes back to the Foreman once`).
3. **Two Auto jobs reach the brief into Test in the same pass.** Expected: exactly one Go is sent; the other job's lane says `Waiting for its turn to test` and its Go goes on the pass after the place is free. Test in Task 10.
4. **Auto switched off (or stopped, finished, set aside) while a job holds the test place.** Expected: the place is free on the next pass; a recording already under way finishes on Auto's database; the next job's copy waits for it (recordings are one at a time). Tests in Task 10 and Task 9.
5. **A job set aside as too big that he then switches back on.** Expected: it runs as one job to PR #1, is never set aside again, counts as working, and switching it on is never refused for places. Test in Task 12.

## The wire contract

Task 1 lands these names; every later task and the web track build against them.

**Auto record** (`sessions.json` → `auto`, `dashboard/lib/auto.js`). Existing: `{ on, since, by, tag, ran, stopped, step, failures, lastBrief, cards, cardsBrief, problem, spent, finished }`. Added:

| Field | Type | Meaning |
|---|---|---|
| `began` | `'tag' \| 'you'` | How the job first came into Auto. Written by the first `on`; kept by every later on and off. A record without it reads as `by === 'tag' ? 'tag' : 'you'` (`beganOf`). |
| `beganTag` | `string \| null` | The tag that started it; kept like `began`. |
| `risky` | `number` | Risky calls on this job (Task 6). Kept by on and off. |
| `tooBig` | `{ at: string, reason: string } \| null` | Set aside as too big (Task 12). Cleared by his switch on, his send, `Run as a stack instead`. |
| `asOne` | `boolean` | He switched Auto back on after a set-aside: never set aside again. |
| `acted` | `string \| null` | When he acted after PR #1 (Task 3). Cleared by `on`. |

`autoRecord(prev, { on, by, tag, now })`: on keeps `began`, `beganTag`, `risky`; sets `tooBig: null`, `asOne: prev.asOne === true || Boolean(prev.tooBig)`, `acted: null`, `finished: null`. Off keeps everything.

**Group** (`dashboard/lib/auto.js`): `type AutoGroup = 'working' | 'needs-you' | 'ready'`. `autoGroup(record, { closed = false }): AutoGroup | null`: null when closed; `working` when on and not stopped; `needs-you` when on and stopped, or off with `tooBig`; `ready` when off with `finished` and no `acted`; else null (the job is in `Yours`). `isWorking(r) = r?.on === true && !r.stopped`. `isUnfinished(r) = r?.on === true`.

**Board card `auto`** (`autoCardView(record, { level, suggestedLevel, closed, waitingToTest })`): today's `{ on, by, ran, stopped, deciding, allowed, why }` (plus `yours` from `boardCards`) and `began: 'tag' | 'you' | null`, `group: AutoGroup | null`, `waitingToTest: boolean`, `tooBig: { at, reason } | null`, `risky: number`, `finished: string | null`.

**Snapshot `autoQueue`** (`dashboard/lib/auto-queue.js`, `read.snapshot()`, the board record):

```ts
interface AutoTicket { key: string; title: string; group: 'next' | 'working' | 'too-big' | 'failed'; slug: string | null; reason: string | null }
interface AutoQueue {
  on: boolean; tag: string; max: number;          // Auto start's setting; max is N
  working: number; unfinished: number; ceiling: number; // ceiling is AUTO_CEILING, 10
  paused: 'limit' | 'limit-reading' | 'orbit' | 'memory' | null;
  testing: string | null;                           // the slug holding the test place
  tickets: AutoTicket[];                            // in Inbox order
}
```

**Setting**: `workflow.autoStart = { on: boolean, tag: string, max: number }`, `max` an integer 1 to 10, 5 when missing. `AUTO_MAX = Object.freeze({ min: 1, max: 10, default: 5 })` and `AUTO_CEILING = 10` in `dashboard/lib/auto-start.js` (`AUTO_START_MAX_JOBS` goes).

**What Auto decided entry** (`dashboard/lib/auto-log.js`, `AutoDecision`): `kind` gains `'refuse'`; `risky?: true` and `first?: string` (what the Approver first said) on a risky call.

**Auto's risky audit line** (Task 6, read by Task 14): `{ action: 'auto', what: 'gate' | 'question' | 'permission', stage, asked, chose, why, risky: true, first }`.

**`web/src/api/types.ts`**: `export type AutoGroup`; `JobAuto` gains `began?`, `group?`, `waitingToTest?`, `tooBig?`, `risky?`, `finished?`; `AutoStartSetting` gains `max?: number`; `export interface AutoTicket`, `export interface AutoQueue`; `Snapshot.autoQueue?: AutoQueue | null`; `AutoDecision.kind` gains `'refuse'`, plus `risky?: boolean`, `first?: string | null`. All optional.

## Order, tracks and merge points

- **Server track** (worktree 1, `feature/auto-queue`), strictly in order: 1, 2, 3, 4, 5, 6, then the database track is merged in, then 10, 11, 12, 13, 14, 18. `dashboard/runner/auto.js` is touched by Tasks 4, 5, 6, 10, 12, 13 and 14, `dashboard/runner/index.js` by 2, 3, 9, 10, 12, 13, `dashboard/lib/auto.js` by 1, 4, 5, and `dashboard/lib/auto-log.js` by 5, 6, 14: none of these may run side by side. Task 11 must follow Tasks 8 to 10: until Starbase applies migrations on Auto's database, dropping the migrations stop has nothing behind it.
- **Database track** (worktree 3, `feature/auto-queue-db`, branched after Task 1 is committed; the lead's change to save time): Tasks 8 then 9. Its files are `dashboard/lib/local.js`, `dashboard/runner/evidence.js` and the fixtures. It makes two small edits in files the server track also touches (`OWN_SENDS` in `dashboard/lib/auto.js`, the `onAutoDbProblem` wiring in `dashboard/runner/index.js`): change only the lines needed, so the merge before Task 10 is clean.
- **Skills track** (the skills repository, its own branch): Task 7, any time after Task 1. It touches no Starbase file. Its `Decisions Auto made` heading must match Task 14's `DECISIONS_HEADING` word for word.
- **Web track** (worktree 2, `feature/auto-queue-web`, branched after Task 1 is committed): Tasks 15, 16, 17, 19 in order (they touch `web/src/api/types.ts` readers and shared Auto components). They build against the wire contract and test with hand-made snapshots.
- **Merge point M1:** Task 1 committed on the server track; the web track branches from it.
- **Merge point M2:** after Task 14 and Task 19, merge the web track into `feature/auto-queue`; run all four commands. Task 18 (the website) runs after M2, since it carries what both tracks made.
- **Merge point M3:** after Task 18, the whole-branch checks below. The skills branch merges into the skills repository's `main` at go-live, with the Starbase merge.

## Safety of Part B

Auto's fixed rules were deep-reviewed on 2026-11-11. The pure rules (`fixedStop`, `autoVerdict`, `judgeCard`, `hardLine`) keep every answer they give today but two: `jobStop` no longer stops for L3 (Task 4) or for the `migrations` trigger (Task 11). What changes is what Auto's pass does with a stop. Tests that pin the pure rules stay as they are: `auto-rules.test.js` (but its lines for `level` and `migrations` in `gate and job rules`), `auto-safety-core.test.js`, `auto-walk.test.js`, `auto-mode.test.js`.

| Today a stop | Now | Pinned today by (`auto-server.test.js` unless named) | Still refused or still a stop |
|---|---|---|---|
| A database command on a card | Refused with the database note (Task 5) | `a database card stops Auto before the Approver is asked`; `an Always allow rule for Bash(psql:*) does not let a database command through in an Auto job`; J3 `an Always allow rule saved later …` | The command never runs; the Approver is never asked; no saved rule lets it through |
| An edit or write outside the job's folders | Refused (Task 5) | `an Edit outside the job's folders stops Auto` | Never runs |
| A push other than the job's branch to its fork | Refused (Task 5) | `a push to a third remote stops Auto although the stage is a PR stage` | Never runs; a force push and an org push stay hard-line refusals with no Auto line (`a force push is still refused by the hard line, and Auto records nothing`, unchanged) |
| A merge, a tool Auto can't judge, any other hard line that is not the plain push (`gh pr create` before the PR stage, `rm -rf` outside the job) | Refused with the hard line's own reason (Task 5) | `a card with a hard line that no fixed stop matches is never answered …`; J6 `a gh pr create card …`, J6 `a push with a gh call …` | Never runs. At a PR stage `gh pr create` into the job's own branch is let through by the go-ahead cover (`goAheadCovers`), as today: unchanged |
| The Approver says stop, or calls its own go or allow high risk | A second ask for the safer answer, sent and listed as a risky call (Task 6) | `an Approver stop stops with its reason`; `an Approver that answers stop on a card …`; both `high risk:` tests | The second answer's shape has no stop; what it allows still passes every fixed rule first |
| The job is L3 or the Foreman proposes L3 | Runs to PR #1 (Task 4) | `a job raised to L3 by the options editor leaves Auto …`; `turning Auto on again at L3 is refused`; `a job with no level whose Foreman suggests L3 leaves Auto`; `an L2 job whose Foreman proposes …`; M3, M4, m2, N4; `auto.test.js` lines for `autoAllowed`; `options.test.js` L3 lines | **Newly allowed** (the design's first exception) |
| The job's changed paths hold a migration | Runs (Task 11) | `a job whose own files say L1 but whose worktree holds a new migration stops Auto …`; `auto-rules.test.js` `job({ triggers: ['migrations'] })` | The crew still can't run it: refused on the card; Starbase applies it only on `__auto` |
| A plan with a migration needs his own words | The Approver approves it like any plan (Task 7, skills only) | none in Starbase | **Newly allowed** (the design's second exception) |

Unchanged stops, whose tests stay as they are: a gate past PR #1 (merge rule), the status card, the 41st card in one reply, the Approver failing twice, a step too long for the Approver (N14), the same step three times (M7), the Foreman blocked, a reply cut off, ten idle minutes (I3, K5), he wrote while a step waited (K4/I5, I5 runner, H2).

---

### Task 1: The wire contract and the record (Part A)

**Files:**
- Modify: `dashboard/lib/auto.js` (`autoRecord`, `autoCardView`, the record comment), `dashboard/runner/index.js` (`boardCard`: pass `closed`), `web/src/api/types.ts`
- Test: `dashboard/test/auto.test.js`

**Interfaces:**
- Produces: everything in "The wire contract" for the record, the group and the card; `beganOf(record): 'tag' | 'you' | null`, `autoGroup`, `isWorking`, `isUnfinished`; the web types (all of them, `AutoQueue` and `AutoTicket` included, though Task 3 fills them).

- [ ] **Step 1: Failing tests** in `auto.test.js`:
  - `autoRecord: a tag start keeps began tag through off and on`: `autoRecord(autoRecord(autoRecord(null, { on: true, by: 'tag', tag: 'auto' }), { on: false }), { on: true, by: 'you' })` has `began: 'tag'`, `beganTag: 'auto'`, `by: 'you'`.
  - `autoRecord: on keeps risky, clears tooBig, acted and finished, and remembers asOne`: from `{ on: false, risky: 2, tooBig: { at: 't', reason: 'r' }, finished: 'f', acted: null }` → `{ risky: 2, tooBig: null, asOne: true, finished: null, acted: null }`.
  - `autoGroup: working, needs you, ready, or Yours`: on → `working`; on and stopped → `needs-you`; off with `tooBig` → `needs-you`; off, `finished`, no `acted` → `ready`; off, `finished`, `acted` → null; off → null; anything with `closed: true` → null.
  - `beganOf reads a record from before`: `{ by: 'tag', ran: true }` → `'tag'`; `{ by: 'you', ran: true }` → `'you'`; null → null.
  - `autoCardView carries began, group, waitingToTest, tooBig, risky and finished`; extend `L5: the card carries who started Auto …` with `began`.
- [ ] **Step 2:** `node --test dashboard/test/auto.test.js`: the new tests fail.
- [ ] **Step 3:** Implement in `dashboard/lib/auto.js`; `boardCard` passes `closed: Boolean(f.closed)` and `waitingToTest: false` (Task 10 fills it); add the types to `web/src/api/types.ts`.
- [ ] **Step 4:** `npm test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(auto-queue): the Auto record keeps how the job began, and its group`.

### Task 2: Places count every working Auto job; N is a setting; the ceiling (Part A)

**Files:**
- Modify: `dashboard/lib/auto-start.js` (`normalizeAutoStart`, `pickNext`, `isBusy` goes, `AutoStarter` `jobs()` contract), `dashboard/lib/state.js` (`workflowSettings`), `dashboard/lib/protocol.js` (`'auto-start'`), `dashboard/runner/index.js` (the starter's `jobs`, the `settings` route's `autoStart` check, the `'auto-start'` handler)
- Test: `dashboard/test/auto-start.test.js`, `dashboard/test/auto-start-server.test.js`, `dashboard/test/options.test.js`, `dashboard/test/protocol.test.js`

**Interfaces:**
- Consumes: `isWorking`, `isUnfinished` (Task 1).
- Produces:
  - `normalizeAutoStart(raw): { on, tag, max }`: `max` an integer 1 to 10 kept, anything else 5.
  - `countAuto(records: (AutoRecord | null)[]): { working: number, unfinished: number }`, open jobs only (the caller passes the records of jobs not closed).
  - `pickNext({ items, setting, memory, ticketsWithJobs, working = 0, unfinished = 0, paused, tagsShown })`: `{ wait: 'busy' }` when `working >= setting.max`; `{ wait: 'ceiling' }` when `unfinished >= AUTO_CEILING`; the rest as today.
  - `AutoStarter`'s `jobs(memory)` resolves `{ ticketsWithJobs, working, unfinished }`, counted over every open job's record (tag or hand), not only the started entries.
  - The `settings` route takes `autoStart.max` (an integer 1 to 10, or absent); otherwise 400 `Auto start: on or off, a tag of at most 60 characters, and 1 to 10 jobs at a time.` (plan's words). The `'auto-start'` command and `protocol.js` carry an optional `max`.

- [ ] **Step 1: Failing tests**
  - `auto-start.test.js`: `places: every working Auto job counts, started by the tag or by hand; a stopped, finished or set-aside one does not`: `countAuto([{ on: true, began: 'you' }, { on: true, began: 'tag' }, { on: true, stopped: { reason: 'x' } }, { on: false, finished: 't' }, { on: false, tooBig: { at: 't', reason: 'r' } }])` → `{ working: 2, unfinished: 3 }`. `N is the setting: with max 2, two working start nothing more` (`{ wait: 'busy' }`). `the ceiling: ten unfinished start nothing, whatever N` (`max: 10, working: 3, unfinished: 10` → `{ wait: 'ceiling' }`). `the setting keeps max between 1 and 10, else 5`: `max` 0, 11, 2.5, '3', missing → 5; 1 and 10 kept. Change `four jobs holding a place leave room for one more, five do not` to use `working` and `max: 5`. Replace `A1: busy while …` with `A1: a job he switched off is not working, even with a reply running` (the design's definition).
  - `auto-start-server.test.js`: `a job he switches to Auto by hand counts as a place, and the switch is never refused for places`: setting `{ on: true, tag: 'auto', max: 1 }`, one job switched on by hand → POST `/api/job/:slug/auto { on: true }` on a second job answers 200, and a tagged ticket in the Inbox is not started. `removing the tag holds back only a ticket not started` (Q10): a started tagged job stays on after the ticket's tags are emptied; a second ticket whose tag was removed is not started.
  - `options.test.js`: `workflowSettings` defaults carry `autoStart: { on: false, tag: '', max: 5 }`.
  - `protocol.test.js`: `the auto-start command takes an optional max of 1 to 10`.
- [ ] **Step 2:** Run the four files; the new tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`, `npm test -w hosted`.
- [ ] **Step 5:** Commit `feat(auto-queue): places count every working Auto job, N is a setting, ten at most`.

### Task 3: The queue on the snapshot, and Ready until he acts (Part A)

**Files:**
- Create: `dashboard/lib/auto-queue.js`
- Modify: `dashboard/runner/index.js` (`read.snapshot`, the `reply` and `nudge` handlers), `dashboard/lib/auto-start.js` (`AutoStarter.failedList()`)
- Test: create `dashboard/test/auto-queue.test.js`; `dashboard/test/auto-server.test.js`

**Interfaces:**
- Consumes: `autoGroup`, `countAuto`, `normalizeAutoStart`, `pausedFor`, `tagMatches`.
- Produces:
  - `autoQueueView({ setting, paused, cards, items, failed, testing = null }): AutoQueue`. `cards`: board cards (`slug`, `title`, `auto`); `items`: the laptop's Inbox items with `job` (`withJobs`); `failed`: `[{ key, reason }]`. A ticket is `working` when its job's `auto.group` is `working` or `needs-you` without `tooBig`; `too-big` when its job has `auto.tooBig` (reason: the job's `tooBig.reason`, slug set); `failed` when its key is in `failed` and it has no job (reason: the failure's); `next` when it would start by itself (assigned, open, no job, the tag on it, not tried: the rule of `pickNext`'s filter, moved into one exported `startsByItself(item, setting, memory)` that both use). Jobs in `ready` are not listed. Order: the Inbox's.
  - `AutoStarter.failedList(): { key, reason }[]` (empty until the memory is read).
  - `read.snapshot()` returns `autoQueue: autoQueueView(...)` with `paused` as `autoStartView()` gives it and `testing` from `auto.testHolder()` (Task 10; null until then).
  - `acted`: his `reply` (any kind, by him) or `nudge` on a job whose record has `finished` and no `acted` writes `acted: <now>` under the Auto lock. `try-it` never does.

- [ ] **Step 1: Failing tests**
  - `auto-queue.test.js`: `the Inbox's Auto groups: next up, working, too big, couldn't start`: four items and three cards → groups `['next', 'working', 'too-big', 'failed']` in Inbox order, slugs and reasons as given. `a stopped job is still under working; a ready one is not listed`. `places: working and unfinished counted from the cards, max from the setting, ceiling 10`. `a job whose ticket lost its tag is still listed by its job`.
  - `auto-server.test.js`: `after PR #1 the job stays Ready until he writes to it; trying it does not move it`: finish a job (PR #1 open) → card `auto.group === 'ready'`; POST `try-it` start → still `ready`; POST a reply → `group === null`.
  - `auto-server.test.js`: `the snapshot carries autoQueue`.
- [ ] **Step 2:** Run the two files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`, `npm test -w hosted`.
- [ ] **Step 5:** Commit `feat(auto-queue): the queue and its Inbox groups on the snapshot`.

### Task 4: Auto runs L3 to PR #1 (Part B)

**Files:**
- Modify: `dashboard/lib/auto.js` (`AUTO_MAX_LEVEL = 3`; `AUTO_L3` goes), `dashboard/lib/auto-rules.js` (`jobStop`: the `level` line goes), `dashboard/runner/auto.js` (`triage`: the L3 leave goes, `raiseLevel` for a suggested 1, 2 or 3; `attend`: the `leave:` option goes), `dashboard/lib/options.js` (the Auto line in `describeOptions` at every level)
- Test: `dashboard/test/auto.test.js`, `dashboard/test/auto-rules.test.js`, `dashboard/test/auto-server.test.js`, `dashboard/test/options.test.js`, `dashboard/test/gate-server.test.js`

**Interfaces:**
- Produces: `autoAllowed(...)` answers `{ ok: true, why: null }` for every level 0 to 3 and any suggestion (kept so `autoMaySend` and the routes need no change). `AUTO_STOP_REASONS.level` and `'level'` in `AUTO_RULES` stay (old audit lines name them).

- [ ] **Step 1: Change the pinning tests first, so they fail on today's code**
  - `auto.test.js`: `autoAllowed: every level and a suggested L3 are allowed`; `AUTO_MAX_LEVEL` is 3.
  - `auto-rules.test.js` `gate and job rules`: `job({ level: 3 })` and `job({ suggestedLevel: 3 })` are null.
  - `auto-server.test.js`: `a job raised to L3 by the options editor stays in Auto and its next gate is answered`; `turning Auto on at L3 is allowed`; `a job whose Foreman suggests L3 has its level raised to L3 and carries on` (the record not stopped, `options.json` level 3, the Approver asked); `an L2 job whose Foreman proposes L3 is raised and carries on`; rewrite M3, M4 and m2 as `… stays in Auto`; N4 `the person sets the job to L3 at the driver's door: the answer still goes`. `leaving Auto for L3 keeps the tag …` becomes `switching Auto off and on keeps began tag` (Task 1 covers the rule; this one is the route).
  - `options.test.js`: the L3 lines (`normalize({ level: 3, auto: true })` keeps `auto: true`; `describeOptions` has the Auto line at L3).
  - `gate-server.test.js`: the `L3` sentence test asserts the switch answers 200 at L3.
- [ ] **Step 2:** Run the five files; the changed tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`.
- [ ] **Step 5:** Commit `feat(auto): Auto runs L3 jobs to PR #1`.

### Task 5: Refuse on the card and carry on (Part B)

**Files:**
- Modify: `dashboard/runner/auto.js` (`attendCard`, a new `refuseCard`), `dashboard/lib/auto.js` (`REFUSED_RULES`, `refuseNote`), `dashboard/lib/auto-log.js` (`KIND.refuse`, `DECISIONS`), `dashboard/lib/options.js` (the Auto line)
- Test: `dashboard/test/auto-server.test.js`, `dashboard/test/auto-log.test.js`, `dashboard/test/options.test.js`

**Interfaces:**
- Produces:
  - `REFUSED_RULES = Object.freeze(['merge', 'database', 'push', 'outside', 'tool'])`.
  - `refuseNote(rule: string, reason: string): string`: for `database`, `Auto refused this: Starbase applies this job's migrations to Auto's own copy of the database when the job's turn to test comes. Don't run database commands. Carry on without it.`; else `Auto refused this: ${reason} Find another way inside the job's folders, or leave it for after PR #1.` (plan's words).
  - In `attendCard`: a card whose `hit` (fixed stop, the hook's kept stop, or the `tool` stop when `cardCtx` fails) has a rule in `REFUSED_RULES`, or that is a hard line other than the plain push, is answered `decide.permission(id, { decision: 'deny', note }, { by: 'auto' })` and never asks the Approver. One audit line `{ action: 'auto', what: 'refuse', rule, asked: <headline>, chose: 'Refused: <headline>', why: <reason> }`; the card counts toward `AUTO_CARDS_PER_REPLY`; `failures` untouched; no notification. A refused decision that fails leaves the card as `answerCard` does.
  - Stays `stopOnCard`: the status card, the 41st card, a card cut for the Approver.
  - `auto-log.js`: `what: 'refuse'` lines are entries of `kind: 'refuse'` and count as decisions.
  - `describeOptions`'s Auto line ends: ` The crew runs no database command: ${PRODUCT} applies the job's migrations to its own copy of the database when the job's turn to test comes.`

- [ ] **Step 1: Change the pinning tests first** (Safety of Part B, rows 1 to 4): each asserts the card's outcome is `deny` with the note, `(await w.record()).stopped === null`, `w.asks.length === 0`, one `refuse` line whose `chose` starts `Refused: `, and no notification. The force-push test stays as it is. Add `refused cards count toward the 40 in one reply: the 41st is still a stop`. Add `a gh pr create at the pr1 stage into the job's own branch is let through by the go-ahead cover, as before` if no test pins it today.
  - `auto-log.test.js`: `a refusal is an entry of kind refuse, its chose Refused: and the headline`.
  - `options.test.js`: the Auto line's new sentence.
- [ ] **Step 2:** Run the three files; the changed tests fail, the unchanged stops pass.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`.
- [ ] **Step 5:** Commit `feat(auto): a call Auto may not make is refused on the card, and the job carries on`.

### Task 6: The safer second ask and the risky count (Part B)

**Files:**
- Modify: `dashboard/lib/approver.js` (`answerSchema`, `APPROVER_SAFER`, `approverOptions`, `approverPrompt`, `checkAnswer`, `askApprover`), `dashboard/runner/index.js` (`askForAuto` passes `safer`), `dashboard/runner/auto.js` (`attend`, `attendCard`, `send`, `answerCard`), `dashboard/lib/auto-log.js` (entries' `risky`, `first`)
- Test: `dashboard/test/approver.test.js`, `dashboard/test/auto-server.test.js`, `dashboard/test/auto-log.test.js`

**Interfaces:**
- Produces:
  - `task.safer?: { decision: 'stop' | 'go' | 'allow', why: string, risk: 'low' | 'medium' | 'high' }`: the first answer.
  - `answerSchema(kind, { safer = false } = {})`: with `safer`, a gate's `decision` enum is `['go']`, a permission's `['allow', 'deny']`. `checkAnswer` refuses `stop` on a safer task with `the decision must be go` (or `allow or deny`).
  - `APPROVER_SAFER` (plan's words), appended to `APPROVER_SYSTEM` by `approverOptions({ …, safer: true })`: `This is a second look. Your first answer would have stopped the job, or called its own go high risk. Starbase does not stop before PR #1, and PR #1 is never merged without the person. Choose the answer that changes least and can be undone: on a gate say go, and for each question pick the option that changes least; on a permission card allow only what is plainly safe, else deny. In why, say what you chose instead and why it is the safer one.` `approverPrompt` shows the first answer inside the material block as `Your first answer: <decision>, <risk> risk: <why>`.
  - `firstWords(answer): string` in `runner/auto.js`: `Stop: <why>`, `Go, high risk: <why>`, `Allow, high risk: <why>`.
  - In `attend` and `attendCard`: where today `answer.decision === 'stop'` or `tooRisky(answer)` stops, Auto asks once more with `{ ...task, safer: first }` (the same `look`, `youSpokeSince` and cost rules as the first ask), and sends the second answer through `send` or `answerCard`, whatever its risk. A failed second ask counts as an Approver failure (two running are the existing dead end). The audit line gets `risky: true, first: firstWords(first)`; the record `risky + 1` in the same update that writes `lastBrief` or the card count.
  - `auto-log.js`: an entry with `risky: true` and `first`.

- [ ] **Step 1: Failing tests**
  - `approver.test.js`: `the safer ask's shape has no stop`; `checkAnswer refuses stop on a safer ask, accepts go`; `APPROVER_SAFER is in the system text only for a safer ask`; `the prompt shows the first answer inside the material block`.
  - `auto-server.test.js`: change `an Approver stop stops with its reason` to `an Approver stop on a gate: Auto asks once more for the safer answer, sends it, and counts a risky call` (two asks, the second's `task.safer.decision === 'stop'`; one `gate` line `risky: true`, `first: 'Stop: …'`; record `risky === 1`, `stopped === null`; no notification). Change both `high risk:` tests the same way (a deny with risk high is still sent at once, unchanged). Change `an Approver that answers stop on a card …` to `… the safer answer is sent and the card does not wait`. Add `the safer ask failing twice stops Auto with the approver rule`. Add `he writes while the second ask thinks: nothing is sent and the step is his` (I5 holds).
  - `auto-log.test.js`: `a risky call's entry carries risky and what the Approver first said`.
- [ ] **Step 2:** Run the three files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`.
- [ ] **Step 5:** Commit `feat(auto): unsure or risky, Auto takes the safer answer and writes it down`.

### Task 7: The workflow skills (Parts B and D, skills repository)

**Files** (in `/Users/moxie/Projects/claude-feature-workflow`, branch `feature/auto-queue` from `main` e1fb596):
- Modify: `feature/skills/feature/job-options.md` ("Auto"), `feature/skills/feature-spec/workflow-gates.md` ("The human's options", "Still asked separately"), `feature/skills/feature/SKILL.md` (Test, Manual testing, PRs step 1), `bugfix/skills/bugfix/levels.md` (Levels table's L3 row note, "The gates"), `bugfix/skills/bugfix/SKILL.md` ("PRs"), `tools/skills/ship/pr-body.md` (the PR #1 skeleton), `common/skills/workflow-common/checklists/db.md`, `common/agents/feature-tester.md`

**What each says** (the implementer writes the sentences in the files' own style; these are the decisions):
- `job-options.md` "Auto": "Three rules change" becomes six. Rule 6 (Part D, Q17): when a gate reply ending with the mark carries a block headed `Decisions Auto made` (that line, then lines starting `- `), put that block, as written, at the end of PR #1's description, before the attribution line; the latest such block wins; no block, no section; never write, add to or reword one yourself. Rule 2: no hand test whatever `manual_test` says or the level is. Rule 4: under Auto the crew runs no database client, migration, seed or data script; Starbase refuses them and applies the job's migrations to Auto's own copy of the database when the job's turn to test comes; a migration that fails there comes back as a message from Starbase with the error, to fix like a failed check. Rule 5: a tool call Starbase answers with "Auto refused this: …" is not a stop: find another way inside the job's folders, or name it in the brief as left for after PR #1, and carry on. In "What Auto never does": the L3 bullet goes, and so does the Floors bullet's last sentence ("When that level is L3, …"); under "The human's own yeses", a plan, quick plan or diagnosis that contains a migration is approved by a reply ending with the mark like any other; running a database write or migration, merging, pushing elsewhere and changing outside the job's folders stay as they are.
- `workflow-gates.md`: "Still asked separately" gains one sentence: in an Auto job the database and server ones are never asked, because Starbase runs them on its own copy (job-options.md, Auto), and the rest wait for after PR #1.
- `SKILL.md`: Test: in an Auto job, checks that write data, migrate or start servers are not run and not asked for; Starbase records the evidence on Auto's database. Manual testing: drop "below L3, with no L3 proposed". PRs step 1 (PR #1's body): in an Auto job, add the `Decisions Auto made` block (job-options.md, Auto, rule 6) at the end.
- `levels.md`: "The gates" says the same of a bug job; nothing at L3 excludes Auto. `bugfix/SKILL.md` "PRs": the same PR #1 sentence as the feature's.
- `pr-body.md`: the PR #1 skeleton shows the optional `Decisions Auto made` block last, before the attribution line, "only in an Auto job, only when the go-ahead carried it".
- `db.md`: after "Applying a migration anywhere … needs a separate yes": in an Auto job nobody on the crew applies one; Starbase applies the job's migrations to Auto's own copy when its turn to test comes.
- `feature-tester.md` step 2: in an Auto job, list such checks under "checks proposed but not run" with "Auto: Starbase records the evidence on Auto's database", and never ask.

- [ ] **Step 1: The checks that fail now** (the repository has no tests for its text; these greps are the test). From the skills repository:
  - `grep -n "L3: when the level is 3" feature/skills/feature/job-options.md` prints a line (it must print nothing after).
  - `grep -c "Auto refused this" feature/skills/feature/job-options.md` prints `0` (must be at least `1` after).
  - `grep -n "below L3, with no L3 proposed" feature/skills/feature/SKILL.md` prints a line (nothing after).
  - `grep -n -i "auto" common/skills/workflow-common/checklists/db.md common/agents/feature-tester.md` prints nothing (a line in each after).
  - `grep -c "Decisions Auto made" feature/skills/feature/job-options.md feature/skills/feature/SKILL.md bugfix/skills/bugfix/SKILL.md tools/skills/ship/pr-body.md` prints `0` for each (at least `1` for each after).
- [ ] **Step 2:** Edit the eight files.
- [ ] **Step 3:** Run the five greps; each gives its "after" answer. Read the "Auto" section whole once more: the six rules, "What Auto never does" and "Never skippable" do not contradict each other.
- [ ] **Step 4:** In Starbase, `node --test dashboard/test/auto-walk.test.js dashboard/test/compose.test.js dashboard/test/skill-check.test.js` still passes (they read skill file names, not these sentences).
- [ ] **Step 5:** Commit in the skills repository `Auto: L3 runs, migrations are Starbase's on its own copy, a refused call is not a stop, its risky calls go in PR #1`.

### Task 8: Auto's database and the fast copy (Part C)

**Files:**
- Modify: `dashboard/lib/local.js` (`LocalRunner` constructor, `#database`, `database`, new `autoDatabase`, `autoConnections`)
- Create: `dashboard/test/fixtures/fake-pg/` (`psql`, `createdb`, `dropdb`: node scripts that append their arguments to `$FAKE_PG_LOG` and answer from the JSON state file `$FAKE_PG_STATE`; `createdb` fails when `$FAKE_PG_FAIL` names its target)
- Test: create `dashboard/test/local-db.test.js`

**Interfaces:**
- Produces:
  - `new LocalRunner({ state, demo, registry, pgTool = pgTool })`: the Postgres tools come from the given function (tests point it at the fakes).
  - `createdbArgs(from: string, to: string, { fileCopy: boolean }): string[]` (exported): `['-T', from, ...(fileCopy ? ['--strategy=file_copy'] : []), to]`. `fileCopy` when `show server_version_num` is 150000 or more (read once per runner).
  - `#database(w)` also returns `auto: '<name>__auto'` and `autoUrl` (the address with that name; it never leaves the server).
  - Try it's `database(f, action)` makes every copy with `createdbArgs` (`swapIn` and the first save).
  - `autoDatabase(f): Promise<{ url: string, name: string, added: string[] }>`, under `dbBusy` (it waits up to 2 minutes for a switch in progress, then fails `busy`): if the saved original is missing, it saves one only while his database has no connections and no Try it server runs, else fails `no-original` and stops nothing; then `dropdb --if-exists --force <name>__auto`, `createdb` from the original, then `npm run db:migrate -- <name>` for each migration on disk not in `__auto`'s ledger, with the app's database key (`w.tryIt.dbUrlKey`, else `DATABASE_URL`) set to `autoUrl`. It never runs a command whose target is his database or the original.
  - `AutoDbError` (exported) with `code: 'no-original' | 'busy' | 'copy' | 'migration'`, `migration: string | null`, `tail: string | null` (the migration's last 20 lines).
  - `autoConnections(f): Promise<number>`: connections on `<name>__auto`, not counting its own.

- [ ] **Step 1: Failing tests** in `local-db.test.js` (a temp worktree with an app folder, `prisma/migrations/0001_a` and `0002_b`, a profile naming the settings file and its `DATABASE_URL`, the fakes):
  - `createdbArgs uses the file copy only when asked`.
  - `Try it's switch copies with the file copy on Postgres 15 or later, and without it before`.
  - `autoDatabase makes __auto afresh from the original and adds this branch's migrations with Auto's address`: the log shows `dropdb --if-exists --force app__auto`, `createdb -T app__original --strategy=file_copy app__auto`, and `db:migrate` for `0002_b` only, with `DATABASE_URL` naming `app__auto`.
  - `no command ever targets his database or the original`: over every test in the file, no logged `dropdb`, `createdb` target or migrate address names `app` or `app__original` (Review Focus 2).
  - `a copy that fails leaves the original and his database as they were, frees the switch, and the next turn builds it again` (Review Focus 2): `FAKE_PG_FAIL=app__auto` → `AutoDbError` `copy`, `dbBusy === false`; unset → the next call succeeds.
  - `a migration that fails says which, with its last lines` → `code: 'migration'`, `migration: '0002_b'`.
  - `with no saved original and his app connected, Auto waits and stops nothing` → `no-original`, no `stopServer` call, no `createdb`.
  - `with no saved original and nothing connected, Auto saves the original first`.
  - `while Try it switches, Auto waits; while Auto copies, Try it's switch says it is busy`.
- [ ] **Step 2:** `node --test dashboard/test/local-db.test.js`; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`.
- [ ] **Step 5:** Commit `feat(auto-queue): Auto's own database copy, and the fast copy for Try it`.

### Task 9: An Auto job records on Auto's database (Part C)

**Files:**
- Modify: `dashboard/lib/local.js` (`startServer(f, { databaseUrl })`), `dashboard/runner/evidence.js` (`serverFor`, `recordNow`, `lookForReady`; a new `onAutoDbProblem` option), `dashboard/runner/index.js` (wires `onAutoDbProblem` to a send), `dashboard/lib/auto.js` (`OWN_SENDS` gains `'auto-migration'`)
- Create: `dashboard/test/fixtures/auto-db-app/` (`package.json` with `dev` and `db:migrate`; `dev.mjs` loads `.env.local` the way Next.js does, a value already in the process winning, and answers `GET /` with the database address it uses; `migrate.mjs` writes the address it got to `migrated.txt`)
- Test: `dashboard/test/evidence-server.test.js`, `dashboard/test/local-db.test.js`

**Interfaces:**
- Consumes: `autoDatabase`, `autoConnections`, `AutoDbError` (Task 8).
- Produces:
  - `startServer(f, { databaseUrl = null } = {})`: with an address, the dev server's environment has the app's database key set to it, and the server view says `db: 'auto'`. A job whose Try it server already runs without it refuses: `Try it is running for this job, so Auto can't record it on its own database. Stop Try it, then press Record.` (plan's words). His Try it servers are never stopped.
  - For a job whose Auto record has `on: true`, the recording, inside the one-at-a-time queue: `autoDatabase(f)`, then the app with `databaseUrl`, then one `GET` of the app's address, then `autoConnections(f)` polled every 500 ms for up to 30 s; none: `EvidenceError(409, AUTO_DB_NOT_USED)` with `AUTO_DB_NOT_USED = "The app didn't connect to Auto's database, so nothing was recorded."` (plan's words); then Playwright; the app is stopped in the `finally` as today. Any other job records as today.
  - `AutoDbError` `no-original` or `busy`: the recording is not a problem shown as failed; its `tried` entry is removed so the next change looks again, and a 60 s timer looks again. The Test step's problem line: `Waiting for a copy of your database. Starbase makes it when nothing is connected to it.` (plan's words) for `no-original`.
  - `AutoDbError` `migration`: `onAutoDbProblem(f, err)` sends the Foreman, once per commit, a message of kind `'auto-migration'` through the path Starbase's own `status-fix` send takes: `Starbase couldn't apply ${migration} to Auto's copy of the database:\n${tail}\nFix it, then raise the brief into Test again.` (plan's words).

- [ ] **Step 1: Failing tests** (Part C proof)
  - `local-db.test.js`: `the job's app uses the address Starbase gives it over the one in its settings file`: the fixture's `.env.local` names `postgres://localhost/app`; `startServer(f, { databaseUrl: 'postgres://localhost/app__auto' })` → `GET /` answers `app__auto`. `the migrate script uses the address Starbase gives it`: `migrated.txt` holds `app__auto`. `without an address the app uses its settings file` (today's Try it).
  - `evidence-server.test.js`: `an Auto job's recording makes Auto's database, starts the app on it and records`. `the recording refuses an app that connects elsewhere` (Review Focus 1): fake `autoConnections` stays 0 → no Playwright run, `problem.message === AUTO_DB_NOT_USED`, the fake pg log names nothing but `app__auto` and the original as a source. `a migration that fails goes back to the Foreman once` (Review Focus 2): one `send` of kind `auto-migration`, none on a second look at the same commit, and the job's Auto record is not stopped. `with no saved original the recording waits and tries again`. `a job not in Auto records as today` (no `autoDatabase` call). `Auto switched off during a recording: it finishes on Auto's database, and the next job's copy starts after it` (Review Focus 4).
  - `auto-server.test.js` (`wroteWhileWaiting` side): `Starbase's migration message is not his: the step is still Auto's`.
- [ ] **Step 2:** Run the three files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`.
- [ ] **Step 5:** Commit `feat(auto-queue): an Auto job records on Auto's database, never his`.

### Task 10: One Auto job in Test at a time (Part C)

**Files:**
- Modify: `dashboard/runner/auto.js` (`createAuto`: the test place; `run`; `triage`), `dashboard/runner/index.js` (`boardCard`'s `waitingToTest`; `read.snapshot`'s `testing`), `dashboard/lib/snapshot.js` (`laneFor`)
- Test: `dashboard/test/auto-server.test.js`, `dashboard/test/lanes.test.js`

**Interfaces:**
- Produces:
  - In `createAuto`: `testPlace: { dir, slug } | null`. At the start of each `run`, the place is let go when its job is not among `read()`'s jobs (off, finished, set aside, closed), is stopped, or its stage is past `test` (`STAGE_IDS`). With no holder, the first working job read whose stage is `test` takes it (after a restart).
  - In `triage`, after the route check and before `youWroteWhileWaiting`: a gate with `nextStage === 'test'` takes the place when it is free or already this job's; otherwise the job is added to `waitingTest` and `triage` returns null (no stuck time is counted: the gate is there). Taken in the first loop, so two jobs in one pass can't both take it.
  - `auto.waitingToTest(dir): boolean`, `auto.testHolder(): string | null` (a slug), returned by `createAuto`.
  - `laneFor`: an Auto card on, not stopped, with `auto.waitingToTest` is `{ lane: 'working', laneReason: 'Waiting for its turn to test' }`, before the "Auto is deciding" rule.

- [ ] **Step 1: Failing tests**
  - `auto-server.test.js`: `two Auto jobs at the brief into Test in one pass: one Go is sent, the other waits for its turn` (Review Focus 3): both jobs' gates with `nextStage: 'test'`; after the pass exactly one `send` with `gateBrief`, the other card's `auto.waitingToTest === true`, its lane reason `Waiting for its turn to test`; when the first job's stage moves to `review`, the next pass sends the second's Go. `Auto switched off on the job that holds the place: the next pass gives it to the waiting job` (Review Focus 4); the same for stopped and for finished. `a job at L0 or in the quick flow never waits for the place` (no brief into Test). `a hand-switched job takes the place like a tag-started one`. `the waiting job is not stopped after ten minutes`.
  - `lanes.test.js`: `an Auto job waiting for its turn to test is working, with that reason`.
- [ ] **Step 2:** Run the two files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`.
- [ ] **Step 5:** Commit `feat(auto-queue): one Auto job in Test at a time`.

### Task 11: A ticket with migrations runs (Part B, after Part C)

**Files:**
- Modify: `dashboard/lib/auto-rules.js` (`jobStop`: the `migrations` line goes), `dashboard/runner/index.js` (`autoJobs` no longer reads `triggers`, so `autoChangedPaths` is not called for it)
- Test: `dashboard/test/auto-rules.test.js`, `dashboard/test/auto-server.test.js`

- [ ] **Step 1: Change the pinning tests first:** `auto-rules.test.js` `gate and job rules`: `job({ triggers: ['migrations'] })` is null. `auto-server.test.js`: `a job whose worktree holds a new migration stops Auto …` becomes `… is answered like any job, and a psql card on it is still refused`.
- [ ] **Step 2:** Run both; the changed tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`.
- [ ] **Step 5:** Commit `feat(auto): a ticket with migrations runs; Starbase applies them on Auto's copy`.

### Task 12: Too big for Auto (Part D)

**Files:**
- Modify: `dashboard/runner/index.js` (`autoJobs` passes `stackSuggested`; the `auto` route; the reply path), `dashboard/runner/auto.js` (`triage`, a new `setAside`)
- Test: `dashboard/test/auto-server.test.js`

**Interfaces:**
- Consumes: `tooBig`, `asOne` (Task 1), `freed`.
- Produces:
  - `autoJobs` gives each job `stackSuggested: string | null` (`f.stackSuggested`).
  - In `triage`, before the Approver is asked: a job with a gate, `stackSuggested` set, `rec.lastBrief === null` and not `rec.asOne` is set aside: under the Auto lock `{ ...prev, on: false, tooBig: { at, reason: stackSuggested } }`; one audit line `{ what: 'set-aside', why: stackSuggested }`; `changed()`; `freed()`; the notice is Task 13's. No Approver call, no gate answered.
  - The `auto` route: switching on a record with `tooBig` gives `asOne: true` (Task 1's `autoRecord`).
  - His send (any kind, by him, not Starbase's own) on a job with `tooBig` clears it. `Run as a stack instead` is such a send.

- [ ] **Step 1: Failing tests**
  - `a ticket whose first brief suggests a stack is set aside: Auto off, too big, no Approver call, no place taken` (card `auto.group === 'needs-you'`, `auto.tooBig.reason` the suggestion; the snapshot's `autoQueue.working` does not count it and its ticket is `too-big`).
  - `switched back on, it runs as one job and is never set aside again` (Review Focus 5): the gate is answered, `asOne === true`, a later brief with `stack_suggested` changes nothing, it counts as working, and the switch answered 200 with all places taken.
  - `his answer to the brief, or Run as a stack instead, clears the mark and the job moves to Yours`.
  - `a suggestion on a later brief, after Auto answered one, does not set it aside`.
- [ ] **Step 2:** `node --test dashboard/test/auto-server.test.js`; the new tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`.
- [ ] **Step 5:** Commit `feat(auto-queue): a ticket big enough for a stack is set aside as too big for Auto`.

### Task 13: The three notifications (Part D)

**Files:**
- Modify: `dashboard/runner/auto.js` (`finish`, `writeStop`, `setAside`), `dashboard/lib/auto-start.js` (`AutoStarter`: both `notify` calls go, and the `notify` option), `dashboard/runner/index.js` (`tellPermission` is not called for a card on an Auto job)
- Test: `dashboard/test/auto-server.test.js`, `dashboard/test/auto-start.test.js`, `dashboard/test/auto-start-server.test.js`

**Interfaces:**
- Produces (exact, from the design's section 8):
  - PR #1 opens: `{ level: 'done', title: 'Ready for you to try: <title>', body, key: 'auto-finish:<slug>' }`, `body = finishBody({ level, risky })`: `PR #1 is open.`, then ` L3.` when the level is 3, then ` 1 risky call.` or ` <n> risky calls.` when there are any.
  - A dead end: `{ level: 'needs', title: 'Needs you: <title>', body: 'Auto stopped: <reason>' }` with the reason's own full stop, key as today.
  - Set aside: `{ level: 'needs', title: 'Too big for Auto: <title>', body: 'The Foreman thinks this ticket is big enough for a stack.', key: 'auto-too-big:<slug>' }`.
  - Gone: `Started by Auto: …`, `Auto start could not start …`, and `Permission: …` / `A question for you.` for a card on a job whose Auto is on (the card's `leftWaiting` tells nothing). Kept: the usage limit, a reply that ended with an error, the four-hour reminder, and every notice for a job not in Auto.

- [ ] **Step 1: Failing tests**
  - `auto-server.test.js`: `PR #1 open: Ready for you to try, with L3 and the risky count when there are any` (L2 with none: body `PR #1 is open.`; L3 with 2: `PR #1 is open. L3. 2 risky calls.`). Change `L4: a stop tells the person what to do …` to `a stop is told as Needs you, with Auto stopped: and the reason's own full stop`. `a set-aside job is told once as Too big for Auto`. Change J2 to `a card left waiting on an Auto job tells nothing; on a job not in Auto it is told once`.
  - `auto-start.test.js`: `a notification is sent once per started job` becomes `a started job tells nothing`; m4 becomes `a failed start tells nothing; its reason is kept for the Inbox`.
  - `auto-start-server.test.js`: the failed start's notification assertion becomes `no notification, and the snapshot's autoQueue lists it as failed with its reason`.
- [ ] **Step 2:** Run the three files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`.
- [ ] **Step 5:** Commit `feat(auto-queue): Auto tells you three things only`.

### Task 14: `Decisions Auto made` with the go-ahead for PR #1 (Part D)

The go-ahead that leads to pushing and opening PR #1 is, in every flow, the gate whose `nextStage` is `pr1` (`gate.nextStage`, which `triage` already reads): the review brief for a feature job at L2 or L3 and for the quick flow (L1), the diff brief after the one build at L0 (no plan, test or review gate before it), and the review brief for a bug-fix job. A brief raised at the `pr1` stage itself (the push, then the PR) carries the block again. Auto is off once PR #1 is open, so nothing later carries it.

**Files:**
- Modify: `dashboard/lib/auto-log.js` (new `prDecisions`), `dashboard/runner/auto.js` (`noteFor`, `send`)
- Test: `dashboard/test/auto-log.test.js`, `dashboard/test/auto-server.test.js`

**Interfaces:**
- Consumes: Auto's risky audit lines (Task 6), `AUTO_MARK`, the reply as `gateDecision` builds it (`dashboard/runner/index.js`: each line of Auto's note flattened onto one line, empty lines and lines equal to the mark dropped, the mark appended last).
- Produces:
  - `DECISIONS_HEADING = 'Decisions Auto made'` (exported from `auto-log.js`; Task 7's skills text uses the same words).
  - `prDecisions(lines, { extra = null } = {}): string[]`: `[]` when there is no risky line; else the heading, then one line per audit line with `risky: true` in the audit's order (oldest first), then `extra` (the risky call being sent now, not yet written) last. Each line: `- ${step}: ${asked}. In doubt: ${first}. Auto chose: ${why}` (plan's words; `step` the step's label from `stopOf(stage)`, else the stage's label), flattened to one line, every copy of `AUTO_MARK` taken out, cut to 300 characters with `…`. At most 30 lines; more gives a last line `- And ${n} more, listed in ${PRODUCT}.` Refusals (`what: 'refuse'`) are never listed.
  - `noteFor(task, answer, { decisions = [] })`: the `Why:` and reason lines, then the `decisions` lines, then `AUTO_MARK`. `send` passes `prDecisions(await state.auditFor(job.dir, Infinity), { extra })` when `gate.nextStage === 'pr1'` or `job.stage === 'pr1'`, else nothing.

- [ ] **Step 1: Failing tests**
  - `auto-log.test.js`: `prDecisions lists the risky calls in the audit's order under the heading`; `no risky call, no block`; `refusals are not listed`; `a line is one line, at most 300 characters, and never holds the mark` (an `asked` with a newline, `## Heading`, a `level L1 (was L3)` line and two copies of `AUTO_MARK` → one `- ` line with none of them able to start a line, no mark, length 300 or less); `more than 30 calls end with the And n more line`.
  - `auto-server.test.js`: `the go-ahead into PR #1 carries Decisions Auto made before the mark, and the mark is still last` (a job with two risky lines at `review`, a gate with `nextStage: 'pr1'` → the sent text has the heading line, two `- ` lines in order, and ends with `AUTO_MARK`); `the risky call on that very gate is the last line of the block`; `a go-ahead into any other stage carries no block`; `with no risky calls the go-ahead into PR #1 carries no block`; `an L0 job's diff brief into PR #1 carries it`.
- [ ] **Step 2:** Run both files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`.
- [ ] **Step 5:** Commit `feat(auto): the risky calls go to the Foreman with the go-ahead for PR #1`.

### Task 15: Jobs: `Yours` and `Auto` (Part E, web track)

**Files:**
- Create: `web/src/home/AutoJobs.tsx`, `web/src/home/AutoJobs.test.tsx`, `web/src/home/autoTab.ts`, `web/src/home/autoTab.test.ts`
- Modify: `web/src/home/JobsPage.tsx`, `web/src/home/JobsPage.test.tsx`, the Jobs stylesheet

**Interfaces:**
- Consumes: `Job.auto.group`, `waitingToTest`, `risky`, `tooBig`, `level`; `Snapshot.autoQueue` (wire contract).
- Produces:
  - `type JobsTab = 'yours' | 'auto'`; `JOBS_TAB_KEY = 'gc.jobs.tab'`; `useJobsTab(): [JobsTab, (t: JobsTab) => void]` (remembered with `useStored`, `yours` by default).
  - `inAuto(job: Job): boolean` (`job.auto?.group` set); `autoGroups(jobs): Record<AutoGroup, Job[]>`.
  - `riskyWords(n: number): string`: `No risky calls` (plan's words), `1 risky call`, `<n> risky calls`.
  - `workingHeading(working: number, max: number | null): string`: `Working · 3 of 5`; without a max, `Working · 3`.
  - `AUTO_PAUSED_LINE = 'Auto is paused: the usage limit is near'` for `limit` and `limit-reading`; `orbit` and `memory` use the Inbox's `AUTO_PAUSED` sentences.
- The page: a `role="tablist"` with `Yours` and `Auto`, each with its count, above the layout switch, in the Inbox's `seg` pattern. `Yours` is today's page without the jobs `inAuto` takes. `Auto` hides the layout switch and shows three groups (laptop: three columns; phone: one after another): `Working · n of N` (cards; a waiting one shows its lane reason `Waiting for its turn to test`), `Needs you` (stopped jobs with their reason; set-aside ones with `Too big for Auto`), `Ready for you to try` (each row: its level chip and `riskyWords(risky)`). Empty groups: `No Auto job is working.`, `Nothing here needs you.`, `Nothing is ready yet.` (plan's words). The paused line sits at the top of the tab.

- [ ] **Step 1: Failing tests**
  - `autoTab.test.ts`: `inAuto and autoGroups follow the server's group`; `riskyWords`; `workingHeading with and without a max`; `a job from an older laptop with no group is Yours`.
  - `AutoJobs.test.tsx`: `three groups with the places in the heading`; `a job waiting to test says so`; `Ready rows show the level and the risky calls`; `the paused line at the top`; `empty groups say so`; the same render with `api.hosted` set.
  - `JobsPage.test.tsx`: `two tabs with counts; Yours leaves out Auto's jobs`; `the chosen tab is remembered`; `the layout switch shows under Yours only`; `the bar's three calls are not hidden for an Auto job` (owner's requirement).
- [ ] **Step 2:** `npx vitest run src/home` (cwd `web/`); fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run web:test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(jobs): Yours and Auto tabs`.

### Task 16: Inbox `Mine` and `Auto`, the Desk's mark, and N in Settings (Part E, web track)

**Files:**
- Modify: `web/src/views/Inbox.tsx`, `web/src/views/Inbox.test.tsx`, `web/src/home/homeModel.ts` (`DeskItem`, `deskQueue`), `web/src/home/homeModel.test.ts`, `web/src/home/DeskView.tsx` (`QueueItems`), `web/src/home/DeskView.test.tsx`, `web/src/views/Settings/AutoStartGroup.tsx` and its test

**Interfaces:**
- Consumes: `Snapshot.autoQueue`, `AutoTicket`, `AutoStartSetting.max`.
- Produces:
  - The Inbox's tabs: `Mine`, `Auto`, then the saved views. `Auto` shows the queue's tickets in four groups with these headings, each only when it has rows: `Next up`, `Auto is working on these` (each links to its job), `Too big for Auto` (its reason and a link to the job), `Couldn’t start` (its reason). Its count is `tickets.length`. The paused line as on Jobs.
  - `Mine` marks a ticket `Starts by itself` (today's) or `AUTO_WORKING = 'Auto is working on this'` (its ticket is `working` in the queue).
  - `autoStartLine(tag, max)`: `Auto start is on: tickets tagged "${tag}" start by themselves, up to ${max} at a time.` (`max` 5 when unknown).
  - `DeskItem` gate items gain `auto: boolean` (the job is in Auto's tab); a Needs you row with it shows an `Auto` chip.
  - `AutoStartGroup`: a number box between `Up to` and `jobs at a time` (1 to 10), saved as `max`; `AUTO_START_WORDS.hint` becomes `Only tickets assigned to you, in Inbox order. Nothing starts while the Claude limit warning shows.` (plan's words).

- [ ] **Step 1: Failing tests**
  - `Inbox.test.tsx`: `the Auto tab lists next up, working, too big and couldn't start, from the queue`; `an empty group has no heading`; `Mine marks a ticket Auto is working on`; `the Auto start line says N`; each on the laptop and with `hosted` (the site's Inbox reads the same queue from the snapshot).
  - `homeModel.test.ts`: `a stopped Auto job's Needs you row is marked Auto`.
  - `DeskView.test.tsx`: `the Auto chip on the row`.
  - `AutoStartGroup` test: `Up to N jobs at a time saves max; outside 1 to 10 is not saved`.
- [ ] **Step 2:** Run the four files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run web:test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(inbox): Mine and Auto tabs; the Desk's Auto mark; N in Settings`.

### Task 17: The job page's lines and What Auto decided (Part E, web track)

**Files:**
- Modify: `web/src/job/page/JobTop.tsx` (`jobFacts`), `web/src/job/page/PhoneJob.tsx`, `web/src/job/WhatAutoDecided.tsx`, `web/src/job/AutoSwitch.tsx` (the L3 block goes), `web/src/views/JobSheets/NewJobSheet.tsx` (the L3 untick goes), their tests and `web/src/views/Hosted/Mirror.test.tsx`

**Interfaces:**
- Consumes: `riskyWords` (Task 15, `web/src/home/autoTab.ts`).
- Produces:
  - `jobFacts`: `Started by Auto` reads `job.auto.began === 'tag'` (else `by`, for older records).
  - Header and phone: a `Too big for Auto` chip (title: the reason) while `auto.tooBig`; `riskyWords(risky)` beside What Auto decided once `risky > 0`; the level chip already says L3.
  - What Auto decided: an entry with `risky` gets a `Risky call` chip and the line `The Approver first said: <first>` (plan's words) above `Chose:`; an entry of kind `refuse` shows its `chose` (`Refused: …`) as the chip, quiet tone.
  - `AUTO_L3` and the switch's L3 block go: the switch is on or off at every level.

- [ ] **Step 1: Failing tests**
  - `JobTop.test.tsx`: `Started by Auto after the switch was turned off and on`; `Too big for Auto with its reason`; `the risky count beside What Auto decided`.
  - `WhatAutoDecided` test: `a risky call shows its mark and what the Approver first said`; `a refusal shows Refused:`.
  - `AutoSwitch.test.tsx`: `the switch works at L3`. `Mirror.test.tsx`: its L3 sentence assertion goes.
  - `PhoneJob.test.tsx`: the same lines on the phone, and with `hosted`.
- [ ] **Step 2:** Run the files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run web:test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(job page): risky calls, refusals, too big and L3 for Auto`.

### Task 18: The new facts on the website (Part F, after M2)

**Files:**
- Modify: `dashboard/runner/mirror.js` (`boardRecord`), `hosted/site/routes-mirror.js` (`snapshot`), `hosted/lib/records.js` (`cleanAutoLog`, `AUTO_KINDS`), `hosted/site/routes-orbit.js` (`/api/orbit/auto-start` passes `max`)
- Test: `dashboard/test/mirror-shape.test.js`, `hosted/test/full-mirror.test.js`, `hosted/test/orbit-inbox.test.js`

**Interfaces:**
- Produces: `boardRecord(snap)` carries `autoQueue`; the site's `snapshot` returns `autoQueue: fresh.autoQueue ?? undefined`; `cleanAutoLog` keeps `kind: 'refuse'`, `risky: true` and `first` (cut to `AUTO_TEXT`); the site's auto-start command carries `max` when given. The job cards' new `auto` fields already ride in `jobs`. No website database change: the board is stored as one JSON value per laptop (`records.all(person.id, 'board')`), confirmed by `hosted/migrations` needing no new file.

- [ ] **Step 1: Failing tests**
  - `mirror-shape.test.js`: `the board carries autoQueue, and no database address`: a snapshot whose `autoQueue` is set → `boardRecord` has it; the JSON holds no `postgres://`.
  - `full-mirror.test.js`: `the site's snapshot gives the laptop's autoQueue and the cards' new Auto fields`; `What Auto decided on the site keeps refusals and risky calls`.
  - `orbit-inbox.test.js`: `Settings on the site queues Auto start with N`.
- [ ] **Step 2:** Run the three files; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test`, `npm test -w hosted`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(site): the Auto queue on the website`.

### Task 19: The website's Jobs and Inbox tabs (Part F, web track, after Task 17)

Added by the lead on 2026-11-12 after Task 15's review found that the website's Jobs page is its own page (`HostedJobsPage`), not the laptop's `JobsPage`, so the design's section 10 ("the same tabs show on the website") was met by no task. No `hosted/` change and no database change: the website already serves everything needed once Task 18 lands.

**Facts (read at 9685958 and 7e62ced; find the code by name, lines move):**
- `web/src/views/Hosted/HostedApp.tsx` mounts `HostedJobsPage` for the `jobs` route and `HostedInboxPage` for `inbox`. The mirror store (`useHostedWorkshop` in `HostedWorkshop.tsx`: live sync over `GET /api/snapshot` and `/api/events`) starts only once a mirror page (a job, the Desk, a stack) has been opened.
- `HostedJobsPage` fetches `GET /api/jobs` itself every 15 s. Its rows are `MirroredJob {id, laptopId, slug, title, ticket, stage, state, stateWords, now, updatedAt}` (`views/Hosted/types.ts`), grouped by laptop. They have no `auto`.
- `GET /api/snapshot` carries the laptop's job cards whole, so each `jobs[].auto` has `group`, `waitingToTest`, `tooBig`, `risky`, `finished`, and each job its `level`. It carries `autoQueue` once Task 18 lands (an optional field: an older laptop sends none).
- `HostedInboxPage` wraps the laptop's `InboxView` (`views/Inbox.tsx`). Since Task 16 it keeps `autoQueue` from the `/api/snapshot` it already reads and passes it to the Inbox as `hosted.autoQueue`, read on open and after Start or Cancel only. Tickets come from `GET /api/orbit/inbox`.
- Task 15 landed `web/src/home/autoTab.ts` (`inAuto`, `autoGroups`, `useJobsTab`, `JOBS_TAB_KEY`) and `web/src/home/AutoJobs.tsx`. Task 16 landed the Inbox's `Auto` tab.

**Files:**
- Modify: `web/src/views/Hosted/HostedApp.tsx`, `web/src/views/Hosted/HostedJobsPage.tsx`, `web/src/views/Hosted/HostedInboxPage.tsx`
- Test: `web/src/views/Hosted/Hosted.test.tsx`, `web/src/views/Hosted/HostedInbox.test.tsx`

**Interfaces:**
- Consumes: `inAuto`, `autoGroups`, `useJobsTab`, `AutoJobs` (Task 15); the Inbox's Auto tab and its `Auto is working on this` mark (Task 16); the snapshot's `jobs[].auto` and `autoQueue` (wire contract).
- Produces:
  - **The store on the Jobs route.** The mirror store also starts for the `jobs` route, and `HostedJobsPage` renders inside the same `WorkshopContext` the mirror pages use, so it can read the store's `jobs` and `autoQueue`.
  - **`HostedJobsPage` tabs.** When the store's snapshot has an `autoQueue` (the laptop is on this build), the page shows the `Yours` and `Auto` tabs, each with its count, in the same `role="tablist"` pattern and with the same remembered choice as the laptop (`useJobsTab`). `Yours` is today's rows, grouped by laptop, without the rows whose slug is `inAuto` in the store's jobs. `Auto` is `AutoJobs` with the store's jobs and `autoQueue`. Rows are joined by slug; when two laptops share a slug the first wins (rare; accepted).
  - **Not known.** With no snapshot yet, a snapshot that failed to load, or a snapshot with no `autoQueue` (an older laptop), the page is exactly today's list, with no tabs. Nothing crashes and no job disappears.
  - **`HostedInboxPage`.** The queue it passes to the Inbox is read again on each refresh of its ticket list, so the `Auto` tab and the `Auto is working on this` mark are never staler than the list itself. With no `autoQueue` in the snapshot there is no `Auto` tab. The `Auto` tab on the site shows the paused line from the queue (`autoQueue.paused`).
  - **Phone.** This is the page he opens on his phone. At 760 px and under the tabs are full width and the groups come one after another; no three columns, no sideways scroll.

- [ ] **Step 1: Failing tests**
  - `Hosted.test.tsx` (the file's own fake `fetch`, answering `/api/jobs` and `/api/snapshot`):
    - `the site's Jobs page shows Yours and Auto from the snapshot`: three jobs in `/api/jobs`; the snapshot's jobs give one `auto.group: 'working'`, one `'ready'`, and carry an `autoQueue` → `Yours` has the third only and its count is 1; `Auto` has count 2 and shows `Working · 1 of 5` and `Ready for you to try`.
    - `a job that needs you under Auto says why`: a stopped job shows its reason; a set-aside one shows `Too big for Auto`.
    - `no queue in the snapshot: today's list, no tabs` (an older laptop), and `the snapshot fails to load: today's list, no tabs`.
    - `the chosen tab is remembered` (the same key as the laptop).
    - `an Auto job's row opens its job page on the site`.
    - `at phone width the groups come one after another`.
  - `HostedInbox.test.tsx`:
    - `the site's Inbox shows the Auto tab from the snapshot's queue` (the four groups, each only when it has rows).
    - `no queue in the snapshot: no Auto tab`.
    - `Mine marks a ticket Auto is working on`.
    - `the Auto tab shows the paused line on the site`.
    - `the queue is read again when the ticket list refreshes`.
- [ ] **Step 2:** `npx vitest run src/views/Hosted` (cwd `web/`); the new tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run web:test`, `npm run web:build`.
- [ ] **Step 5:** Commit `feat(site): Yours and Auto on the website's Jobs page, and the Inbox's Auto tab`.

---

## After the last task (M3)

- [ ] All four commands pass (but "I2 B").
- [ ] The design's end-to-end run, by the lead, on a second Starbase with its own state folder and port (never `~/.starbase`, never 4477) and a scratch Postgres database standing for his: three tagged tickets, one with a migration, one whose first brief suggests a stack. Expected: two at `Ready for you to try` with no click, one under `Too big for Auto`, the scratch "his" database's ledger and row counts unchanged, `__auto` made from the original.
- [ ] The real-browser pass used for the job page, on the two new tabs (Jobs and Inbox) at 1280, 1512 and 1920 px and at phone width, laptop and website; `noEmptyScroll` and `noJump` clean on Jobs.
- [ ] Go-live is the owner's, in this order: merge both branches, install the skills, rebuild, restart Starbase when no job is mid-reply, push.

## Spec coverage

| Design | Tasks |
|---|---|
| 1 Which jobs are Auto jobs | 1, 3 |
| 2 Jobs tabs, 4 How many at once | 2, 3, 15 |
| 3 Inbox tabs | 3, 16 |
| 5 No questions before PR #1 | 4, 5, 6, 7, 11 |
| 6 Testing and the database | 8, 9, 10 |
| 7 Too big for Auto | 12, 13, 15, 17 |
| 8 Notifications | 13 |
| 9 What Auto decided, and PR #1's description | 5, 6, 7, 14, 17 |
| 10 The website | 18, 19 |

## Rulings for the owner to see

1. **A suggested L3 is applied.** The design says a job the Foreman proposes as L3 runs to PR #1. Auto raises the level to 3 (the higher wins, as for L1 and L2 today), so the row and the finish notice can say L3. It never lowers one.
2. **The safer ask cannot say stop.** Its answer shape allows only go on a gate, allow or deny on a card, so "only dead ends stop a job" holds. A second ask that fails is an Approver failure, and two running are the existing stop.
3. **What is refused.** Every card stop of the merge, database, push, outside and tool rules, and every hard line other than the plain push, is refused with a note. Refusals count toward the 40 cards in one reply, so a crew that keeps trying ends in the existing loop stop. Opening PR #1 is unchanged: at a PR stage the go-ahead cover lets `gh pr create` into the job's own branch through, as today; before the PR stage it is refused.
4. **"Working" follows the design, not today's `isBusy`.** A tag-started job he switched off while a reply ran held a place until now; it no longer does (review fix F5's test changes).
5. **The Inbox's Auto tab lists by job, not by tag**, so a job whose tag was removed stays under `Auto is working on these`. A stopped job is listed there too. A job at `Ready for you to try` is not listed in the Inbox (it is in Jobs).
6. **How the recording knows the app's database is Auto's:** within 30 s of one request to the app's address, Auto's database has a connection. Only Starbase makes `__auto`, so any connection is the app's. An app whose first page touches no database would be refused; Orbit's does.
7. **Auto's copy shares Try it's one-switch-at-a-time lock.** For the about 11 seconds Auto copies, his Try it switch says today's `The database is already being switched. Wait for it to finish.` His database and servers are never touched.
8. **Which recordings use Auto's database:** jobs whose Auto record is on (working or stopped). A job he moved to `Yours` records as today. If his Try it server is running on an Auto job, Auto's recording is refused with a line and his server is left running.
9. **The fast copy needs Postgres 15 or later** (`createdb --strategy`); before that the copy is made as today (measured: 99 s).
10. **A stop's notice drops "Open the job to answer."** to match the design's `Auto stopped: <reason>`.
11. **Notice punctuation:** `PR #1 is open. L3. 2 risky calls.`; one is `1 risky call.`
12. **The paused line:** the design gives `Auto is paused: the usage limit is near` for the limit; Orbit unreachable and an unreadable memory file use the Inbox's existing sentences.
13. **Too big** means `stack_suggested` while Auto has answered no gate on the job; a suggestion on a later brief does nothing.
14. **Records from before** read `began` from `by`.
15. **No check that the skills were installed.** Go-live installs them before the restart; an L3 Auto job on old skills would end in the existing three-times stop, never worse.
16. **Auto's tab layout:** three groups (columns on a laptop, one after another on a phone); the lanes, list and floor switch belongs to `Yours`.
17. **The gate reply carries `Decisions Auto made`, as the design says.** The code allows it: `gateDecision` puts each line of Auto's note on one line, drops empty lines and any line equal to the mark, and appends the mark last itself, and no length cap on the note was found. So the block is plain lines in the note, each starting `- ` (it can never be the heading, an option line or the mark), and the mark stays last by construction. The go-ahead that carries it is the gate whose next stage is PR #1 (the review brief at L1 to L3 and in a bug job, the diff brief at L0), and again any brief at the PR #1 stage itself.
18. **The block's line**: `- <step>: <what was asked>. In doubt: <what the Approver first said>. Auto chose: <the safer answer's why>`, at most 300 characters, at most 30 lines then `- And <n> more, listed in Starbase.` It goes before the PR's attribution line, which every PR body ends with.
19. **Words not in the design** (marked "plan's words" in their tasks): the two refusal notes, `APPROVER_SAFER`, `The Approver first said:`, `No risky calls`, the three empty-group lines, the migration message to the Foreman, the waiting-for-a-copy line, `AUTO_DB_NOT_USED`, the Try it refusal line, the setting's 400 message, the Auto start hint, and the block's line format and its `And n more` line. From the build (Task 15): the tabs' hover titles `The jobs you run yourself, in the layout you chose.` and `The jobs Auto runs to PR #1: working, needing you, and ready for you to try.`, and the Auto row's title `Open <name>. Space, or a click on the row, takes a quick look instead.`
20. **The website's Jobs page is its own page** (added in the build). It lists jobs from the site's own table, with no Auto facts, so the tabs there come from Task 19: the page also reads the laptop's snapshot and joins the two by slug. An older laptop, or a snapshot that will not load, shows today's list with no tabs.
21. **One bar on both Jobs tabs** (added in the build). The bar that points at the next job needing him counts his jobs and Auto's `Needs you` together, picks his own first, and says `This one has waited longest.` only when that is true.
