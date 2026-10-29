# Ground Control: plan for the next phase of Feature Workshop

Written 2026-10-27 by the planning lead (Claude) with Vignesh. Status: **approved by Vignesh on 2026-10-28. The build has not started; Vignesh starts it.** Decisions are in `2026-10-27-ground-control-decisions.md`. Notes and the question rounds are in `2026-10-27-feature-workshop-next-phase-notes.md`.

Words used in this plan. **Ground Control** is the product (today's Feature Workshop). A **job** is one piece of work on one ticket. A **stack** is a parent job whose work is split into **sections**, each a job of its own, built side by side and merged in order. The **Foreman** is the Claude Code session that drives a job. The **runner** is the small program on a developer's laptop that starts Foremen and reads job folders. The **site** is the hosted web half that people sign in to (v2). **Orbit** is the portal; **Portal Feedback** is its ticket tracker; **ORBIT-479** is the read-only API and MCP for those tickets.

## 1. Vision, and what "done" means

**The one-sentence vision.** Every Orbit bug and feature request becomes a ticket in Portal Feedback, and Ground Control is the one place a developer takes that ticket from "assigned" to "in staging", with Claude doing the work and the developer deciding at each gate.

**What that looks like for a developer, end to end.**

1. A ticket shows up in the Ground Control inbox, read from Orbit. The developer opens it and clicks Start. The job is created with the ticket key, the branch name is derived from it, and the worktree is made.
2. Claude works through the stages the team already uses: clarify, spec, plan, build, test, review, then the three pull requests. At each gate the developer reads a short brief and answers with one click or one key. Permission requests are cards, not terminal prompts.
3. Tests include real browser evidence: screenshots and short videos per acceptance criterion, taken on the developer's own machine against a local database copy.
4. The branch, the PRs and the commits appear on the Orbit ticket on their own, because Orbit's GitHub sync links them by key. The developer pastes a short summary and the evidence link on the ticket. Ground Control never writes to the ticket.
5. The decisions made during the job are written to one plain file that rides the PR into Orbit's tracked `docs/decisions/` folder.
6. Big work is a stack: the developer approves a plan of sections, Ground Control builds them in parallel on one laptop, up to a cap, and merges them in order with a gate before each push.
7. In v2, all of this is also visible on a Moxie-hosted site, from any device, for the developer who owns the job. A lounge screen shows the team, per person: online or not, every ticket and job currently running on that person's laptop with its stage, and last active. Nothing more.

**Why this phase, and why now.** Vignesh runs this process today by hand: terminal tabs, two servers, pasting between chats. The pieces exist (the skill, the dashboard, the Orbit API). This phase joins them so the process is one tool, works on Windows for the next developer, and can be shown to a manager as a product rather than a habit.

**Done for this phase means all of these are true.**

| # | Done when |
|---|---|
| D1 | A job can be started from an Orbit ticket inside Ground Control, and the job, its branch and the ticket share the same key. |
| D2 | The ticket inbox and ticket pages inside Ground Control read live from ORBIT-479 with a person's own read-only token. No write path to Orbit exists in the code, and a test proves it. |
| D3 | The runner runs natively on Windows, Mac and Linux, installs with one command, updates itself, and runs offline on `127.0.0.1`. |
| D4 | A stack of up to N sections (N set by the developer, capped globally) builds on one laptop, integrates in order, and stops for a person before every push. |
| D5 | Playwright evidence is produced for L2 and L3 jobs and shown on the gate card. |
| D6 | Each job writes a simple decision file; Ground Control's own decisions live in the repo. |
| D7 | The UI is redesigned: one primary action per screen, keys on buttons, status never by colour alone, works on every theme. |
| D8 | Usage is shown with warnings at 80 %, 90 % and full. |
| D9 | (v2) The site is hosted on a Moxie subdomain with Google sign-in, a paired runner per laptop, the job record mirrored, approvals queued when the laptop is off, and the lounge screen listing each person's running jobs. |
| D10 | A manager version of the roadmap exists, with ordered phases, stop lines and sizes, no dates. |
| D11 | The Foreman's `status.json` is checked against a schema on every write; errors go back to the same session to fix, with a retry limit. (Carried from the Sandcastle review.) |
| D12 | Each job has a lock (pid, branch, time) so a terminal and the runner never drive one job at once; a stale lock from a dead process is taken over. (Sandcastle.) |
| D13 | Review lenses get the diff, spec and recent commits pasted into their prompt instead of fetching them; every job keeps a "not doing" list next to its decisions. (Sandcastle.) |
| D14 | A usage page ("Telemetry") records every Foreman turn's tokens, cost and plan meter, and shows a few graphs that answer "where does our Claude usage go and when do we hit the limit". |

**Not in this phase.** Writing to Orbit tickets (G3, G4). Automatic pickup of tickets (G7). Hand-over of a job between computers (G12). Stacks across more than one laptop (G14). Budgets that stop work (G20). Team-wide usage insights (v2); per-person usage is in this phase (D14). ClickUp (G25). Repo workflow profiles for anything but Orbit (G10).

**Carried from the Sandcastle review (agreed earlier, kept here so they are not lost).** Strict `status.json` with schema and same-session retry (D11); one lock per job (D12); facts up front in review prompts and the "not doing" list (D13); session resume and fork so a Foreman can be continued after a restart or forked for a second try; prompt templates that can pull in command output when the brief is built; the planner, parallel implementers, reviewer, merge shape, which is what a stack is; decision files in the ADR style. Sandcastle itself is not adopted as a library: it is unattended, Ground Control is human-gated.

**Dependencies outside this plan.** ORBIT-479 must be merged and its token flag turned on before D2 can be tested against real Orbit; until then Ground Control uses the local Orbit checkout. Orbit's `.gitignore` must track `docs/decisions/` (Vignesh adds it to his current Portal Feedback changes) before D6's per-ticket files can be committed.

## 1a. What other harnesses do, and what Ground Control borrows

Read on 2026-10-27. Each line says what the tool is, what is worth taking, and where it lands in this plan. None of them is adopted as a dependency: they are either unattended, Mac-only, closed, or tied to another tracker. OpenAI Symphony was reviewed and left out on purpose: its ticket-status-as-control and hand-off-to-human-review shape adds review steps that work against automation. "Harbour" was not found under that spelling; the closest match is Harbor, a Go runtime for pausable agents, covered below.

| Tool | What it is | What we borrow | Where it lands |
|---|---|---|---|
| **Conductor** (Melty Labs, Mac app, closed) | One workspace per task: worktree, branch, chat, terminal, diff, checks and PR in one window. Setup scripts, "files to copy" for `.env.local`, a `CONDUCTOR_PORT` variable per workspace. | The per-workspace port variable and the files-to-copy rule as repo settings rather than code; the one-window shape for a job. | §4 runner repo registry; §7 design. |
| **Vibe Kanban** (BloopAI, open source, community-run since Apr 2026) | Issues and workspaces on a kanban board; a workspace makes worktrees, starts the agent with model and effort settings; several workspaces per issue for parallel tries; setup and cleanup scripts; a planning ticket can spawn child cards. | Model and effort per workspace (our per-section picker); parent and child cards (our stack and sections); cleanup scripts. | §6 stacks. |
| **Agent Orchestrator / Orchestrator.inc** (Untrivial, open source) | One agent, branch and worktree per task; lanes "Working, Needs you, In review, Ready to merge"; failed CI, review comments and merge conflicts are routed back to the session that owns the branch; phone app for approvals; optional reviewer agent before a human. | The four lanes as the only job-list grouping; routing CI and review feedback back to the owning Foreman by session resume; approvals from a phone. | §7 design; §3 (PR feedback); v2 site. |
| **Bernstein** (open source) | An LLM decomposes a goal once, then a deterministic scheduler with no model calls runs parallel worktree tasks and a verifier gate before merge. | Scheduling and merge order as plain code, never a model decision; a verifier step that is just the gates. | §6 stacks. |
| **Emdash** (open source, desktop) | Many CLI agents side by side, ticket intake from several trackers, worktrees locally or over SSH, `$EMDASH_PORT` per task. | Confirms the port-per-worktree rule; nothing else. | §4. |
| **Baton** (open source CLI) | Polls GitHub Issues, one worktree per issue, all config in one `WORKFLOW.md` with front matter and prompt templates. | One config file per repo. | §4. |
| **Claude Squad** (open source TUI) | Keyboard-driven management of several agent sessions in worktrees and tmux; human reviews everything before push. | Keys on every action. | §7 design. |
| **Harbor** (Go runtime, open source) | Agents as durable runs: pause for human approval, redirect, resume after a process restart, every action a typed event, trajectory rebuilt by replaying events. | The idea that a job survives a runner restart because its state is an event log plus a resumable session, not memory. We already have `audit.jsonl` and SDK resume; the runner is designed so that restart = replay + resume. | §2 architecture; §4 runner. |
| **Claude Code agent teams / Managed Agents** (Anthropic, 2026) | A lead session with a shared task list (pending, in progress, completed, blocked), teammates that message each other, file locking, hooks on task completion; Managed Agents run the same in the cloud with a console trace. | The shared task list with blocked-unblocks-automatically for sections inside a stack; a read-only reviewer per three or four builders; hooks that run checks when a section finishes. Not the cloud runners: Try it and the database are local. | §6 stacks. |
| **Beads** (Yegge, open source) | Git-backed, dependency-aware issue graph that agents file and read as memory. | Only the habit: a job's decisions and not-doing list are files in git, readable by the next agent. Orbit's tracker stays the tracker. | §8 decision records. |
| **Ralph loop** (Huntley, Carson) | Pick a task, implement, validate, commit if green, reset context, repeat; hard iteration caps and a reflection prompt before each retry. | The cap and the reflection: a section that fails its checks three times stops and asks instead of looping. | §6 stacks. |
| **Addy Osmani, "Code Agent Orchestra"** (write-up) | Field rules: one file one owner, plan approval before code, three to five agents at once, kill criteria for stuck agents, token caps with a pause at 85 percent, a reviewer that is read-only. | The WIP limit as the global cap default, kill criteria, "one file one owner" as the section rule, pause at 80 and 90 percent (G20). | §6, G15, G20. |
| **Sandcastle** (Pocock) | Reviewed earlier; see the carried items in §1. | Structured output with retry, locks, resume and fork, ADR and out-of-scope files. | D11 to D13. |

**What this settles about how Ground Control works.**

1. **One config file per repo** (`ground-control.md` at the repo root, or in the registry if the repo must not carry it) holds the workflow profile: branch naming, PR route, Try-it command, port range, files to copy, setup and cleanup commands, risk floors. Reloaded without a restart. Orbit's is the first.
2. **Ground Control remembers who is on which ticket** (local in v1, on the site in v2), so two people do not start the same ticket by accident and the lounge can show it. Orbit's ticket status is not changed by this.
3. **Scheduling is plain code.** Which section runs next, the cap, merge order and retries are never asked of a model.
4. **Every job survives a restart.** Runner state is the job folder plus the audit log plus a resumable Claude session. "Resume" is one command.
5. **Feedback goes back to the owner.** A failed check or a review comment on a PR is routed to the Foreman that owns the branch, by session resume, and shows as a "Needs you" card.
6. **Four lanes, everywhere.** Working, Needs you, In review, Ready to merge. Nothing else groups the job list.
7. **Hard caps.** Three sections at once by default, raised in Settings; a section stuck three times stops and asks.

Sources: [Conductor worktrees guide](https://www.conductor.build/docs/guides/git-worktrees/run-claude-code-with-git-worktrees) · [Vibe Kanban getting started](https://vibekanban.com/docs/getting-started) · [Agent Orchestrator](https://github.com/Untrivial-ai/agent-orchestrator) · [Augment's orchestrator roundup](https://www.augmentcode.com/tools/open-source-agent-orchestrators) · [Harbor (Go)](https://github.com/hurtener/Harbor) · [Harbor framework (benchmarks, not this)](https://vercel.com/docs/ai-gateway/coding-agents/harbor) · [Code w/ Claude SF 2026 recap](https://claude.com/blog/code-w-claude-sf-2026-sf) · [Beads](https://github.com/steveyegge/beads) · [Addy Osmani, Code Agent Orchestra](https://addyosmani.com/blog/code-agent-orchestra/) · [Tembo orchestration tools](https://www.tembo.io/blog/ai-agent-orchestration-tools)

## 2. Architecture

**One codebase, two shapes.** Today's dashboard is split into a **runner** (the machine half) and a **site** (the web half) that talk over one protocol. In **local mode** both run in one process on `127.0.0.1:4477`, which is today's dashboard and the offline mode. In **hosted mode** (v2) the site runs on Railway and each laptop's runner connects out to it. The React UI is one app served by whichever half is in front.

### 2.1 Components

| Component | Runs where | Owns | Talks to |
|---|---|---|---|
| **Runner** (`ground-control` service) | each developer's laptop, as a background service (Task Scheduler, launchd, systemd) | the Foreman driver (Agent SDK `query()`), job folders, locks, git and worktrees, Try it and ports, local DB switch, Playwright evidence, process list, notifications, usage reading, the repo registry, the Orbit read token | the site (one outbound WebSocket) or the local UI; Claude Code; GitHub through the developer's `gh`; Orbit read API and MCP |
| **Site** (`ground-control-site`) | Railway (v2); inside the runner process in local mode | users and roles, Google sign-in, runner pairing, the ticket inbox poller, the claim set, mirrored job records, queued approvals, audit, costs, the lounge | Orbit read API (with each person's stored token); runners; browsers |
| **UI** (`web/`) | the browser | every screen | the site's HTTP and event stream (local or hosted) |
| **Foreman** | a Claude Code session started by the runner | one job: stages, briefs, `status.json`, decisions, the Orbit MCP for reading the ticket | the runner (permission cards, hooks); the repo; Orbit MCP |
| **Skill** (`/feature`, `claude-feature-workflow`) | installed on each laptop | the stage rules, worker agents, lens prompts, `status.json` contract | the Foreman |
| **Orbit / Portal Feedback** | Vercel | tickets, GitHub sync, token page | read by the site and the Foreman; never written |

### 2.2 What runs where, by mode

| Thing | Local mode (v1, offline) | Hosted mode (v2) |
|---|---|---|
| Starting a Foreman | runner on the laptop | runner on the laptop, told by the site |
| Ticket inbox | runner polls Orbit with the laptop's token | site polls Orbit with the stored token, also while the laptop is off |
| Job record | job folder only | job folder, mirrored to the site |
| Gate decisions | local UI | local UI or the site; queued if the runner is offline, executed when it returns |
| Code, diffs, `.env`, DB, credentials | laptop | laptop, never uploaded; diffs fetched live through the runner while online |
| Audit log | `~/.ground-control/audit.jsonl` | the same file, plus a copy on the site for the owner |
| Lounge | not present | site |

### 2.3 Data flow for one ticket

1. **Inbox.** The site (or the runner in local mode) calls `GET /api/feedback/v1/tickets` for the person's assigned and following tickets every few minutes with that person's `orbfb_` token. Tickets another person is already working on say so.
2. **Start.** The developer clicks Start on ORBIT-479. The site records that this person's runner is on the ticket and sends `start` to the runner with the key, the repo and the options. In local mode it is one process.
3. **Prepare.** The runner takes the job lock, creates the job folder with the ticket key in `status.json`, creates the worktree from the repo profile, copies `.env.local` per the files-to-copy rule, assigns a port from the profile's range, and starts the Foreman with the brief. The Foreman reads the full ticket through the Orbit MCP with the laptop's token.
4. **Work.** The Foreman writes briefs and `status.json`; the runner validates each write against the schema (D11) and sends errors back to the same session. Permission requests become cards. Each status change is an audit event, and the runner streams events up.
5. **Gates.** The developer approves, replies or sends back from the UI or the site. The runner applies it to the session. If the runner is offline, the site holds the decision and the card shows "waiting for your laptop".
6. **Evidence.** At test, the tester starts Try it on the assigned port, runs Playwright with the bypass user against the local DB copy, writes screenshots and videos to the job folder; the runner mirrors them.
7. **Ship.** The Foreman pushes to the fork and opens PR #1 only after the PR-stage yes. Orbit's GitHub sync attaches the branch, PR and commits to the ticket by key. The developer pastes the summary and the evidence link on the ticket. The decision file is committed on the branch into `docs/decisions/`.
8. **Feedback.** A failed check or a review comment on the PR is fetched by the runner through `gh`, routed to the owning Foreman by session resume, and shows as a "Needs you" card.
9. **Done.** The finish-line setting closes the job; the worktree is cleaned when the job is closed, not before.

### 2.4 What crosses the network

| Path | Carries | Never carries |
|---|---|---|
| Runner → site | status, briefs, Foreman documents, gate and permission cards, evidence files, costs and timing, branch and PR names, lock state, heartbeat | source, diffs (except live view on request), `.env`, DB contents, any token |
| Site → runner | start, reply, approve, send back, stop, allow or deny a permission, pause, take over, fetch-diff (live view) | shell commands, file paths to read, pushes, anything not on the list |
| Site → Orbit | `GET` tickets, ticket detail, references, views, with the person's token | any write |
| Foreman → Orbit | MCP `feedback_get_ticket` and friends with the laptop's token | any write; the tests pin it |
| Runner → GitHub | push to the fork, PR create or merge after a yes, `gh pr list`, checks and comments read | push to the org, force push |

### 2.5 Diagram

```
                     ┌──────────────────────────────┐        ┌──────────────────────────┐
                     │  Orbit · Portal Feedback      │ read   │  Ground Control site      │
                     │  tickets · GitHub sync by key │◄───────│  (Railway, v2)            │
                     │  token page (ORBIT-479)       │ only   │  sign-in · inbox poller   │
                     └──────────▲────────────────────┘        │  claims · job records     │
                                │ branch / PR / commits        │  queued approvals · audit │
                                │ by orbit-<n>                 │  costs · lounge           │
                     ┌──────────┴──────────┐                   └───────▲──────────────────┘
                     │  GitHub (fork, org) │                           │ one outbound WebSocket per laptop
                     └──────────▲──────────┘                           │ up: record, cards, evidence
                                │ gh (developer's login)               │ down: fixed command set
  ┌─────────────────────────────┴─────────────────────────────────────┴─────────────────────┐
  │  Developer laptop (Windows · Mac · Linux)                                                 │
  │   runner ─ locks · repo registry · ports · .env copy · DB switch · evidence · usage       │
  │     ├─► Foreman (Claude Code, developer's login) ──► worktree ../orbit-<slug> ──► Try it  │
  │     │       └─ Orbit MCP (laptop token, read only)                                        │
  │     └─► local UI http://127.0.0.1:4477  (local mode = runner + site in one process)       │
  │   job folders ~/.claude/feature-work/<slug>/ · audit ~/.ground-control/audit.jsonl        │
  └───────────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Integration contract with Portal Feedback

Everything here is read-only. The contract is ORBIT-479 as it exists in the release stack today; nothing in v1 or v1.5 needs Orbit to change. Where a change to Orbit would help, it is marked **proposal** and is a separate decision for Vignesh in Orbit, never assumed.

### 3.1 What Ground Control reads, and when

| Need | Call | Who calls it | How often |
|---|---|---|---|
| Ticket inbox | `GET /api/feedback/v1/tickets?` with the tracker's query string (assignee = me, following = me, open states), page size 50 | runner in local mode; site in hosted mode | every 3 minutes while a browser has the inbox open, every 15 minutes otherwise; `datefield=updated&from=<day>` to fetch only recent changes, then filtered client-side to the minute |
| Ticket page inside Ground Control | `GET /api/feedback/v1/tickets/{ref}` (detail, timeline) | runner or site | on open, then every 60 seconds while open |
| Branches, PRs, previews already on the ticket | `GET /api/feedback/v1/tickets/{ref}/references` | runner or site | on open; after each push (to confirm GitHub sync picked it up) |
| Saved views for inbox tabs | `GET /api/feedback/v1/views` | runner or site | daily and on sign-in |
| The Foreman reading the ticket | MCP `feedback_get_ticket`, `feedback_list_references`, `feedback_list_tickets` (for related tickets), `feedback_list_views` | the Claude Code session, through `POST /api/mcp/feedback` | at clarify and spec; again at test to compare acceptance criteria |

Auth is `Authorization: Bearer orbfb_…` on every call. Scopes used: `tickets:read`, `views:read`. Nothing else exists, and the tests in the API repo pin that no v1 or MCP file imports the write operations.

### 3.2 Tokens

- Each person mints their own token on Orbit's `/feedback/api-tokens` page (feedback-team members only, 7, 30 or 90 days, five active at most). The token acts as that person, so Ground Control sees exactly what they can see (D9: "agents see what the token owner can see").
- **Local mode:** the token is pasted once into Ground Control settings. The runner stores it in the OS credential store and writes the Claude Code MCP config entry for the Foreman (`{"type":"http","url":"https://<orbit>/api/mcp/feedback","headers":{"Authorization":"Bearer ${ORBIT_FEEDBACK_TOKEN}"}}`), so one paste serves both the UI and the agent.
- **Hosted mode (G11):** the same token is also stored on the site, encrypted with a site key, used only by the inbox poller for that person. The site never passes it to anyone else and never to a runner. Expiry shows as a banner on the inbox: "Your Orbit token expired, paste a new one".
- A token is never written to a job folder, a brief, the audit log or a mirrored record. A test greps every outbound record for the `orbfb_` prefix.

### 3.3 Ticket, job and branch mapping

| Thing | Rule |
|---|---|
| Ticket key | `ORBIT-<n>`; Ground Control accepts the lenient forms Orbit does (`orbit-479`, `#479`, `479`) and stores the canonical key |
| Job folder | `~/.claude/feature-work/<slug>/`, slug = `orbit-<n>-<short-title>`; `status.json` gains a `ticket` block: `{ "key": "ORBIT-479", "title": "...", "url": "...", "level": "L2" }` (schema version 2) |
| Branch | `<kind>/orbit-<n>-<slug>`, same name in fork and org, never `-vN` (unchanged) |
| Stack | the parent job holds the ticket; each section's branch is `<kind>/orbit-<n>-<section-slug>`, merged into the parent's branch in order |
| One ticket, one job | starting a second job on a ticket is allowed only as a section of a stack, or after the first job is closed; the inbox shows "you are already on this" |
| Links on the ticket | arrive through Orbit's GitHub sync by whole-token `orbit-<n>` in branch names, PR titles and commits (hourly cron); Ground Control shows "linked on the ticket" once `/references` returns the branch |
| Summary and evidence | a person pastes them; Ground Control has a "Copy for the ticket" button that produces the five-line summary |

### 3.4 Events

Orbit has no outbox, webhooks or event feed, and this plan does not ask for one. Ground Control polls as in 3.1. Everything Ground Control itself emits (stage changes, gates, permissions, evidence, costs) goes to its own audit log and event stream, never to Orbit.

### 3.5 Proposals for Orbit, each a separate decision, none needed for v1 or v1.5

| Id | Proposal | Why | Changes |
|---|---|---|---|
| P1 | `from=` on the tickets list accepts a full timestamp, not just a day | polling fetches less | one parser change in the list route; no scope change |
| P2 | a `ground_control` view kind, or just a saved view "Mine, open, by priority" | inbox tabs without a query string in Ground Control's code | a saved view, no code |
| P3 (later, reopens D9) | scopes `references:write` and `comments:write-internal` on the token page, behind a second flag; actor = the token's owner, marked "via Ground Control"; never status, never email | removes the two pastes per job | token page gains two checkboxes; two routes; tests pinning that status and email code paths are unreachable from them |

Nothing else. In particular no service account, no agent tokens, no status changes.

## 4. The runner

The runner is today's `dashboard/server.js` machine half, pulled out into a service with a small command line. In v1 it is still one process with the web half; the split is v1.5. The commands and the install story are designed now so v1 code is written in the right place.

### 4.1 Commands

| Command | Does | Needs a yes? |
|---|---|---|
| `ground-control start` | starts the service (local mode: UI on `127.0.0.1:4477`, screens on 4478) | no |
| `ground-control stop` | stops the service; running Foremen are paused, not killed, and resume on the next start | no |
| `ground-control status` | one screen: service up, runners paired, repos registered, jobs by lane, locks held, usage | no |
| `ground-control doctor` | checks Node, git, `gh auth status`, Claude Code login, Playwright browsers, Postgres, the Orbit token, ports free, OS service installed; prints fixes | no |
| `ground-control login <code>` | (v2) pairs this laptop with the site using a one-time code from the site | no |
| `ground-control repo add <path>` | registers a repo: reads `ground-control.md` from the repo root or asks the five questions (GitHub name, worktree folder, Try-it command, port range, files to copy) | no |
| `ground-control token set` | pastes the Orbit token into the OS credential store and writes the Claude Code MCP entry | no |
| `ground-control resume <job>` | reopens a job after a crash or restart: replays the audit log, takes the lock, resumes the Claude session | no |
| `ground-control update` | pulls the release tag the site (or GitHub) names, verifies the checksum, restarts; runs on every start unless `--no-update` | no |
| `ground-control open <job>` | opens the job's worktree in the configured editor and terminal (VS Code, iTerm, Windows Terminal, GNOME Terminal) | no |

The terminal workflow stays: a job started with `/feature` in a terminal still appears, because the runner reads the same job folders. The lock (D12) is what stops both driving one job at once; the terminal session takes it with the same file format.

### 4.2 Auth on the laptop

| Credential | Where it lives | Who uses it |
|---|---|---|
| Claude Code login | Claude Code's own store (Keychain on Mac, `.credentials.json` elsewhere) | the Foreman; the usage reader reads it the way `plan-usage.js` does today, with a Windows Credential Manager path added |
| GitHub | `gh auth` | the Foreman's pushes and PRs; the runner's `gh pr list` and checks |
| Orbit token | OS credential store (`keytar`-style: Keychain, Credential Manager, libsecret) | the inbox in local mode; the Foreman through the MCP entry |
| Runner token (v2) | OS credential store | the one outbound connection |
| Local Postgres | `.env.local` copied per the repo profile; the `<name>__original` switch unchanged | Try it and Playwright |

The site never holds Claude, GitHub or Postgres credentials in any version (G11).

### 4.3 Install and update

| OS | Prerequisites (checked by `doctor`) | Install | Service | Update |
|---|---|---|---|---|
| Windows 10/11 | Node 22, Git for Windows, GitHub CLI, Claude Code, Postgres (installer), Chrome or Edge | `winget install` for the prerequisites, then `npm i -g @moxie/ground-control && ground-control install` | Task Scheduler task "Ground Control", at logon, as the user | `ground-control update` on start; a release tag on the GitHub repo, checksum file beside it |
| Mac | Node 22, git, gh, Claude Code, Postgres.app or Homebrew Postgres, Chrome | `brew install` for prerequisites, same npm line | launchd agent `com.moxie.ground-control` | same |
| Linux | same, distro packages | same | systemd user unit | same |

Offline: the runner starts in local mode on `127.0.0.1` if the site is unreachable at start or the connection drops; jobs, gates and Try it keep working; the inbox shows the last fetched list with its time; everything is replayed to the site on reconnect.

### 4.4 Cross-platform audit (what changes, and the replacement)

| Today (Mac or Unix only) | File | Replacement |
|---|---|---|
| Keychain `security find-generic-password` for the Claude login | `dashboard/lib/plan-usage.js` | one credential module: Keychain on Mac, Credential Manager on Windows (via `cmdkey`-free native binding or Claude's `.credentials.json` fallback), libsecret on Linux |
| `terminal-notifier` / `osascript` notifications | `dashboard/lib/notify.js` | `node-notifier` or the OS toast API; same three events |
| `open -a iTerm`, `open -a "Visual Studio Code"`, Finder | `dashboard/lib/local.js` | editor and terminal chosen in Settings; `code` CLI, `wt.exe`, `gnome-terminal`, `xdg-open`, `explorer.exe` |
| Homebrew and Postgres.app binary paths | `dashboard/lib/local.js` | `pg_ctl` and `psql` found on PATH or set in Settings |
| `$SHELL || /bin/zsh -c` for Try it | `dashboard/lib/local.js` | `cross-spawn` with the profile's command; PowerShell on Windows |
| `ps -axo`, `lsof` for the process and port list | `dashboard/lib/live.js` | `/proc` on Linux (already first), `tasklist` and `netstat -ano` on Windows, `ps` and `lsof` on Mac |
| process-group kill | `dashboard/lib/local.js` | `tree-kill`; Windows `taskkill /T` |
| `/tmp` hard-coded | `dashboard/lib/policy.js`, `history.js` | `os.tmpdir()` |
| hook `record.mjs` relies on the shebang | hooks | invoked as `node record.mjs` in the hook config |
| `~` in paths, `python3`, Chrome paths Mac and Linux only, POSIX `install.sh`, `open()` without encoding, `/briefs/` separator bug | skill repo | `os.homedir()` and `path.join` everywhere; `python` or `python3` detection; Chrome and Edge paths on Windows; `install.ps1` beside `install.sh`; `encoding="utf-8"`; `os.sep` |

Acceptance: `npm test` and the skill's checks pass on a Windows runner in CI (GitHub Actions `windows-latest`) and on Mac; a real job runs end to end on Vignesh's manager's laptop, through the three PRs, as the v1.5 proof.

## 5. Security

### 5.1 Threats and the answer to each

| # | Threat | Answer |
|---|---|---|
| T1 | Someone takes over the hosted site (v2) | The runner accepts only the fixed command list (§2.4). The worst a site attacker can do is start a job on a registered repo, approve a gate, or stop a job. Every one of those still runs inside the Foreman's permission rules and hard lines: no push to the org, no force push, no `rm -rf`, no database scripts without a card on the laptop. They cannot read files, run commands, or get any credential, because none are on the site. |
| T2 | A stolen Orbit token | Read-only by construction, seven to ninety days, revocable on Orbit's token page, scoped to what that person could see anyway. The site stores it encrypted with a key held outside the database. |
| T3 | A stolen runner token (v2) | Lets an attacker pretend to be that laptop: they could send fake status, not run anything. Revoked from the site; one per laptop; rotated on `login`. |
| T4 | A malicious ticket (prompt injection in a ticket body the Foreman reads) | The Foreman cannot write to Orbit at all; pushes and PRs need a yes; hard lines stay. The brief shows the ticket text in a quoted block so the developer sees what the Foreman saw. |
| T5 | A section in a stack edits another section's files | "One file, one owner": each section's owned paths are in its brief and enforced by the `PreToolUse` hook, which refuses edits outside them. |
| T6 | Two drivers on one job (terminal and runner) | The job lock (D12). |
| T7 | Secrets leaking into briefs, evidence or the mirrored record | `.env.local` is never read by the Foreman's tools (hard line); a scrub pass on every outbound record for `orbfb_`, `ghp_`, `sk-ant` prefixes and the `.env` keys; a test for the scrubber. |
| T8 | The runner's local HTTP API abused by another local process or a web page | Unchanged from today: binds `127.0.0.1`, Host check, write token, same-origin, JSON only. |
| T9 | The Foreman pushes something wrong | Pushes go to the fork only; org branches are create-only; PR #2 and #3 are human. |
| T10 | Runaway cost | Usage shown with warnings at 80, 90 and full (G20); the global cap on sections; a stuck section stops after three failed tries. |

### 5.2 Audit log

`~/.ground-control/audit.jsonl` on the laptop (today's `~/.feature-workshop/audit.jsonl`), one line per event: time, job, actor (person, Foreman, runner, site), action, detail, and for gates the brief hash and the commit the decision was made on. The site keeps the owner's copy in v2. Decisions are generated from it (D13, §8). Nothing is ever deleted; closing a job writes a closing event.

### 5.3 Approvals from Moxie

| What | Who | When |
|---|---|---|
| A Railway account and a Moxie subdomain | Vignesh's manager, Moxie IT | before v2 starts |
| Google sign-in restricted to the Moxie domain (an OAuth client) | Moxie IT (Google Workspace admin) | before v2 starts |
| The Orbit `.gitignore` change for `docs/decisions/` | normal PR in the Portal Feedback stack | v1 |
| The later write scopes | Vignesh, as a decision in Orbit (reopens D9) | not this phase |

## 6. Stacks

A stack is the product version of the coordinator-and-packets recipe Vignesh runs by hand today.

### 6.1 Shape

- A **stack** is a parent job on one ticket. It has a plan (`stack.md` in the job folder): sections, each with a name, a one-paragraph brief, owned paths, dependencies on other sections, and the integration order.
- A **section** is a child job: its own worktree `../orbit-<n>-<section>`, branch, port from the repo profile's range, job folder and Foreman. It runs the normal stages, but clarify and spec are skipped when the stack plan already holds a spec, so a section starts at plan or implement.
- The **coordinator** is the parent's Foreman. It writes the plan, waits, integrates each finished section into the parent's branch in the stated order, runs the gates on the integrated branch, and stops for a yes before every push. With "integrate automatically" on (G15), merges into the parent's branch happen on their own once a section's gates pass; pushes still wait.

### 6.2 Controls

| Control | Where | Default |
|---|---|---|
| Sections at once, per stack | the stack page | 3 |
| Sections at once, global | Settings → Workflow | 3; the inbox shows "queued, waiting for a slot" |
| Model and effort per stack, overridable per section | the stack page; `stack.md` | the Settings default (Opus, high); the coordinator one notch higher |
| Integrate automatically when all gates pass | the stack page | off |
| Stuck rule | fixed | a section whose checks fail three times stops with a "Needs you" card |

### 6.3 Scheduling, as plain code

The runner holds a queue. A section is runnable when every section it depends on has integrated and a slot is free. The order inside the runnable set is the plan's order. The coordinator never decides who runs next; it is told when a section is done. The shared task list (pending, running, blocked, integrated, failed) is `stack.json`, written by the runner, read by the coordinator and the UI.

### 6.4 Pages

- **Stack page:** the plan as a list, each section with its lane, its owned paths, its branch and port, and the integration log underneath (what merged when, which gates ran). One primary action: approve the plan; later, approve the push.
- **Section page:** a normal job page with a "part of stack X" line.
- **Jobs list:** a stack is one row that expands.

### 6.5 Acceptance

A stack of three sections on a test repo runs with cap 2, shows one section queued, integrates in order, refuses to push without a yes, and the decision file holds a heading per section. The same stack with "integrate automatically" merges on its own and still waits for the push. A section edit outside its owned paths is refused by the hook. `npm test` covers the scheduler with a fake query.

## 7. Design

A full redesign of `web/` (G16). It takes the Kingdom Orchestrator ideas already listed in `light-2026-10-21.md` and the four-lane model from §1a. Rules carried over: one primary action per screen with a key; facts in one quiet line; detail on demand; one setting, one meaning; status never by colour alone; keys never while typing or with a dialog open; theme tokens only; every theme checked.

| Screen | What it is for | Primary action |
|---|---|---|
| **Inbox** | Orbit tickets assigned to you or followed, as a list with severity, age and whether anyone is on it (Orbit has no priority any more: review 1, 2026-10-28); tabs from saved views | Start (`s`) |
| **Desk** | one thing at a time, the queue in a drawer (the three-column layout, queue, item and decided today, is a choice in Settings → Look); the item is a gate, a permission or a question with consequences under each option | Approve (`a`), Send back (`r`), Reply (`c`) |
| **Jobs** | the four lanes: Working, Needs you, In review, Ready to merge (one list grouped by lane is a choice in Settings → Look); a stack is one expandable row; each stop dot names its stop on hover; the lounge's data starts here | Open (`o`) |
| **Job** | the track as a map of stops, like the Stack page (review 1 picked it over pills); every stop opens its Stage; a permission alert with Allow once / Deny; tabs Brief, Spec, Plan, Code (live diff while the laptop is on), Tests (with evidence inline), Review, Decisions, Ship | depends on the stage |
| **Stage** | one stop of a job: who is working it, what each is doing, Open in terminal for each (the Foreman continues its session; a crew member's log is followed read-only), the stop's folded conversation | the stop's own |
| **Stack** | §6.4 | Approve plan |
| **Settings** | repos (the registry), workflow (caps, finish line, automatic level), look (themes, text size), notifications, token | Save |
| **Telemetry** | the meters, warnings at 80, 90, full, up to ten insight graphs that fold and hide (§7a.2, packet P) | Read now |
| **Lounge** (v2) | per person: online, their running tickets and jobs with lane, last active | none |

**The Ground Control play theme.** With Play set to full, the UI carries simple mission-control pieces: a status board strip at the top (job count by lane as "boards", a clock in local and UTC, the gauge), each running job shown as a "console" tile with a small live readout (stage, elapsed, last event) and a soft blinking indicator while the Foreman works, gates framed as a "go / no go" call with Approve and Send back as the two big calls, the lounge as a row of consoles with who is seated at each. Play off removes all of it; subtle keeps the console tiles and the go / no go wording but drops the strip, the clock and any animation. It is a look, not a layout: every element exists in all three modes, only the dressing changes, so the "themes change looks only" rule still holds. Reference for the feeling, not the design: a post by 0xRafy showing an isometric "office" where each agent has a desk, a team list on the right says who is coding, thinking or idle, and a "Needs you" bubble with Approve and Decline sits on the agent that is waiting. We take the idea of seeing at a glance who is working and who needs you, and the one-click approve on the waiting agent; we do not take the isometric room.

**The quality bar.** Nothing chunky, nothing hard to click, nothing that needs explaining. Every clickable thing is at least 40 px tall with a visible hover and focus state. Every screen has one obvious next step. Transitions are under 200 ms. No element moves under the pointer. The design packet is not accepted until Vignesh has clicked through every screen in all three play modes and every theme without finding one thing that feels off.

The Play page itself and the existing themes stay. In Play full the crew is on the screens too: a small face on each stop of the Job map and full size on the Stage screen; subtle and off show initials and role words. The crew's names and looks are generic and come from one crew pack, and the product name from one place, because the name "Ground Control" is a working name and not settled (review 1).

Wireframes for Inbox, Desk, Jobs, Job, Stage, Settings → Look, Stack and Telemetry are drawn with the wireframe skill before code, with two options wherever there is a real choice, reviewed by Vignesh, and the chosen options become the brief for the design packet.

## 7a. Telemetry: the usage page

Vignesh asked for a usage dashboard with only very useful insights, so the team can plan around the Claude limits. It is called **Telemetry**: the word means measurements sent back from a craft to the ground station, which is exactly what each laptop's Foremen send to Ground Control. The meters in the top bar stay the "gauge".

### 7a.1 What is recorded

Today the driver already receives, per Foreman turn, the model, the token counts by kind (input, output, cache read, cache write) and Claude Code's own cost figure; `cost.js` prices them; `plan-usage.js` reads the plan's two meters (five-hour and seven-day percent used, and when each resets). Telemetry keeps all of that instead of showing only the latest: one line per turn in `~/.ground-control/usage.jsonl` with time, **Ground Control user** (the person, since Vignesh and Sohum share one Claude account, so the Claude account id alone cannot tell them apart), Claude account id, job, ticket, stage, section, worker (Foreman, implementer, lens, tester), model, tokens by kind, cost estimate, and a snapshot of both meters. Storage is cheap, so everything is kept. Nothing is sent anywhere in v1. In v2 the lines are mirrored to the site for that person, and the site combines the lines of everyone on the same Claude account to draw the shared gauge and its forecast, because one person's laptop alone cannot see how fast the other is draining it.

### 7a.2 The graphs

**Changed in review 1 (2026-10-28):** Vignesh asked for deeper insights that help decide on the product, its use and the plan, up to ten graphs, each able to fold or hide. The ten are listed in `packets/M-screens-review-1.md` and built by packet P on a cleaned record. The five below stay among them (gauge, model share, people; cost by stage becomes "where the spend goes"; usage by day by job folds into cost per ticket). The original five, for reference:

| Graph | Answers | Shape |
|---|---|---|
| **Gauge over time** | when do we hit the limit, and how fast does the week fill | line of the seven-day percent with reset marks; the five-hour as a thin second line; a dotted forecast "at this pace, full on Thursday 14:00" |
| **Usage by day, by job** | which jobs eat the plan | stacked bars per day, one colour per job, with a pattern as well as colour; click a bar to open the job |
| **Cost per ticket and per stage** | what a ticket costs, and which stage is expensive (review lenses, build, tests) | two small bar charts, ticket on the left, stage on the right, last 30 days, in plan percent and in dollars |
| **Share by model** | is Opus doing work Sonnet could | one bar, split by model, per week |
| **People on the account** | who is using the shared Claude account, and how much | one bar per Ground Control user for the window; names only, no job names for other people |

**Who sees what.** Graphs that carry a person's own work (usage by day by job, cost per ticket and per stage) are private to that person. Graphs about the shared account (gauge over time with the forecast, share by model, people on the account) are common: stored for everybody and shown to everybody, including the manager, with no job names. Each person therefore sees five graphs; the team page in v2 shows the three common ones.

Rules from the dataviz guidance: never colour alone, every graph has a one-line sentence under it stating the main fact in words, tooltips carry the numbers, a table view for each graph for screen readers and copying.

### 7a.3 Where it lives

The Usage screen (§7) becomes Telemetry: the meters at the top, the five graphs below, a window picker (this five hours, this week, 30 days), and "Read now". Warnings at 80, 90 and full (G20) stay on the top bar everywhere.

### 7a.4 Acceptance

Every turn of a sample job produces one usage line; the five graphs render from a fixture of 30 days; the forecast matches a hand calculation on the fixture; the page passes the theme and colour checks; no model calls in tests.

## 8. Decision records

Two levels, one shape (G21, G27).

**Job level.** `decisions.md` in the job folder, generated by the runner from the audit log after every gate, plus the Foreman's own entries. Format:

```
# ORBIT-479 · Feedback API and MCP

| id | question | options | choice | who | when | why |
|---|---|---|---|---|---|---|
| ORBIT-479.D1 | Write-back from agents? | none · narrow scope · server pull | none | Vignesh | 2026-10-27 | agents must not write; people paste links |

## Section: work-order-v2
| ORBIT-479.D7 | ... |

## Not doing
- Automatic ticket pickup (needs an event feed Orbit does not have)
```

The file is committed on the feature branch as `docs/decisions/ORBIT-0479-feedback-api.md` at the ship stage, so it rides PR #1. The runner rebuilds `docs/decisions/README.md` (ticket, title, decisions, last updated) in the same commit. A "Copy for the ticket" button gives the table as plain text.

**Product level.** Ground Control's own decisions in its repo at `docs/decisions/`, same shape, files `NNNN-<slug>.md` for decisions that are not about one ticket, starting with this plan's register copied in as `0001-next-phase-register.md`. Decisions spanning Orbit tickets go in Orbit's `docs/decisions/general/`.

## 9. Phased roadmap

No dates. Each phase has a stop line: when the acceptance holds, the phase is done and the next one is a fresh decision. Sizes are developer-days of Vignesh plus Claude at today's pace; packets in §11 map to these.

| Phase | Contents | Stop line (acceptance) | Size |
|---|---|---|---|
| **v1 · Ticket in, local** | fast-forward `redesign/orbit-ready` into `main`; Orbit read client and inbox; Start from a ticket; `status.json` v2 with the ticket block and schema validation with retry (D11); job lock (D12); usage warnings (G20); `decisions.md` and the not-doing list, copy-for-ticket; facts-up-front review prompts (D13); Telemetry (D14) | D1, D2, D6 (job level), D8, D11, D12, D13, D14 hold; `npm test` and `web` tests green; one real Orbit ticket run end to end from the inbox to PR #1 | 9 to 11 days |
| **v1.5 · Team-ready, still local** | runner and site split inside one process (the protocol, the command list, replay-on-restart); repo registry and `ground-control.md`; cross-platform audit (§4.4) and installers; stacks (§6); Playwright evidence (G17); the redesign (§7); PR feedback routing; decision files committed to Orbit | D3, D4, D5, D7 hold; a real job on the manager's Windows laptop through the three PRs; a stack of three sections on Orbit | 18 to 24 days |
| **v2 · Hosted** | the site on Railway: Google sign-in, pairing, the inbox poller with the encrypted token store, mirrored records, queued approvals, the lounge, phone-friendly Desk, team Telemetry | D9 holds; two people each run a job from their own laptop and see only their own; the lounge shows both; a gate approved from a phone while the laptop is closed executes when it wakes | 10 to 14 days |
| **Later, each its own decision** | automatic ticket pickup; write-back scopes (G4); hand-over between computers; stacks across laptops; a second repo profile; the manager version of this plan as a page (G19) | — | — |

The manager version (one page: vision, the three phases, stop lines, sizes, what is not included) is written after v1 ships, per G19.

## 10. Decision register

The register is `2026-10-27-ground-control-decisions.md` (G1 to G29), kept beside this plan and copied into the Ground Control repo as `docs/decisions/0001-next-phase-register.md` in v1. The question rounds that produced it, with options and consequences, are in `2026-10-27-feature-workshop-next-phase-notes.md` §6 (W1 to W27). Everything in the register is decided.

## 11. Packets for implementers

Rules for every packet: a fresh worktree from the base, one branch, one dashboard port, owned files only, tests green before hand-back, no push and no PR without Vignesh's request, never touch 4477 or 4479, no model calls in tests. The number of packets running at once is a setting on the integration board, not a fixed rule: it starts at three and Vignesh changes it whenever he likes. Each packet is a self-contained brief in its own file under `docs/plans/packets/<id>-<name>.md`, so a tab is started by pasting one path and nothing is ever passed from one window to another.

**Integration is a screen, not a chat.** Vignesh does not want to carry prompts between terminals. So the very first packet, **Z, the integration board**, is a small page in today's dashboard: it lists the packet worktrees it finds (branch, base, ahead and behind, last commit, tests green or not, owned files touched or not), and has one button, "Merge next", which merges the next packet in the stated order into the base checkout, runs `npm test` and the web tests, and shows the result; a conflict shows the files and a "Open in editor" button, nothing more. It also holds the "packets at once" number, changeable at any time, which the board shows as "N of M slots in use" and which the stack scheduler inherits in v1.5. It is the seed of the stack page (§6.4, packet K), which replaces it in v1.5. Until Z exists, the first three packets (Z itself, C and D) are merged by hand once.

**Base.** `main` after the fast-forward of `redesign/orbit-ready` (33 commits ahead, nothing behind). Until that fast-forward is requested, base is `redesign/orbit-ready`. Worktrees `../ground-control-<packet>` from the main checkout at `~/Projects/feature-workshop`. Dashboard ports 4481, 4483, 4485 (screens server on the next number). Skill packets use a worktree of `~/Projects/claude-feature-workflow`.

### v1 packets

| Id | Packet | Owns | Depends on | Acceptance | Verify |
|---|---|---|---|---|---|
| **Z** Integration board | `dashboard/lib/integrate.js` (new: find worktrees, ahead/behind, run tests, merge next), `server.js` route `/api/integrate/*`, `web/src/pages/Integrate.*` (new) | none | lists the packet worktrees with their state; "Merge next" merges in order, runs both test suites, shows the result; a conflict lists files and stops; never pushes; a changeable "packets at once" number with slots in use | `npm test`, web tests |
| **A** Orbit client and inbox | `dashboard/lib/orbit.js` (new: token store, list, detail, references, views, polling, lenient key parse), `dashboard/lib/server.js` routes `/api/orbit/*`, `web/src/pages/Inbox.*` (new), settings token field | none | inbox lists the person's tickets with priority, severity, age; detail opens; token in the OS store; a fake Orbit server in tests; `orbfb_` never appears in any record (test) | `npm test`, `cd web && npx vitest run` |
| **B** Start from a ticket, `status.json` v2, schema and retry | `dashboard/lib/status-json.js`, `dashboard/lib/driver.js` (validate on write, send errors back, retry limit 3), `skills/feature/status-json.md` in the skill repo (ticket block, version 2), `dashboard/lib/stages.js` (nothing new, read only) | A (the ticket block's source) | Start creates the job with the ticket key; the branch is derived; an invalid `status.json` write produces a corrective message in the same session and an audit event; version 1 files still parse | same, plus the skill's checks |
| **C** Job lock | `dashboard/lib/lock.js` (new), `driver.js`, `skills/feature/SKILL.md` (the terminal takes the same lock) | none | `~/.claude/feature-work/<slug>/lock.json` with pid, branch, time; second driver refuses with a clear card; dead pid taken over; released on close | `npm test` |
| **D** Usage warnings | `dashboard/lib/plan-usage.js`, `web/src/…/Usage*` | none | warnings at 80, 90 and full, each once per reset window, as a banner and a notification; status never by colour alone | `npm test`, web tests |
| **E** Decisions file and not-doing | `dashboard/lib/decisions.js`, `dashboard/lib/history.js`, `web/src/…/Decisions*`, skill `SKILL.md` (Foreman writes `## Not doing`) | none | `decisions.md` generated after every gate in the §8 format; copy-for-ticket gives plain text; the Decisions tab reads the file | `npm test`, web tests |
| **F** Facts up front in review | skill repo: `skills/feature/review-lens-rules.md`, `agents/feature-review-*.md`, the Foreman's review stage | none | every lens prompt carries the diff, spec and last commits; lenses no longer run `git diff`; a review on a sample job finishes in fewer turns | the skill's checks |
| **T** Telemetry | `dashboard/lib/usage-log.js` (new: one line per turn), `driver.js` (emit the line), `plan-usage.js` (snapshot into the line), `dashboard/lib/telemetry.js` (aggregations, forecast), `web/src/pages/Telemetry.*` (new, five graphs) | D | §7a.4 | `npm test`, web tests |

Integration order: Z first, then C, D, E, F (independent), then A and T, then B. With three slots: Z+C+D, then E+F+A, then T+B; more slots pull the next independent packet forward.

### v1.5 packets

| Id | Packet | Owns | Depends on | Acceptance |
|---|---|---|---|---|
| **G** The split and the protocol | `dashboard/runner/*` (new), `dashboard/site/*` (new), `dashboard/lib/protocol.js` (the command list and the event types), `server.js` becomes the local-mode host; replay-on-restart; `ground-control resume` | v1 | local mode behaves exactly as before (all tests green unchanged); a job survives a service restart; the command list is a closed enum with a test that rejects anything else |
| **H** Cross-platform audit | the files in §4.4 | G | `npm test` green on `windows-latest` and `macos-latest` in CI |
| **I** Installer, service, update | `bin/ground-control` CLI, `install.ps1`, `install.sh`, service files, update with checksum | G, H | fresh Windows VM: prerequisites via `doctor`, install, service at logon, update to the next tag |
| **J** Repo registry and profile | `dashboard/lib/repos.js`, `ground-control.md` loader, Orbit's profile file (in the registry, since Orbit's root is not ours to change yet) | G | Try it, ports, files to copy and branch rules all come from the profile; no repo guessing left in code |
| **K** Stacks | `dashboard/lib/stack.js` (scheduler, queue, caps), `stack.json`, `stack.md`, driver for parent and child, skill: coordinator stage and section briefs, hook rule for owned paths | B, C, J | §6.5 |
| **L** Playwright evidence | skill: tester agent and test-plan rules; runner: Playwright runner, evidence folder, `evidence.json`; web: evidence on the gate card | J | an L2 job produces screenshots and a video per acceptance criterion against the bypass user and the local DB copy; an L0 job produces none |
| **M** The redesign | `web/src/**` (new screens per §7), wireframes first | A, E, K (for the Stack page) | §7's screens exist with keys, every theme checked, status never by colour alone, no horizontal scroll at phone width |
| **N** PR feedback routing | `dashboard/lib/git.js`, `driver.js` (resume with the comment or the failed check as the message) | G | a failed check or a review comment creates a "Needs you" card and, on Approve, resumes the owning Foreman with it |
| **O** Decision files into Orbit | skill ship stage; `decisions.js` (write to `docs/decisions/ORBIT-NNNN-slug.md`, rebuild the index) | E, the Orbit `.gitignore` change | the file rides PR #1 on a real ticket |

Integration order: G, then H+J+N, then I+K+L, then M, then O.

### v2 packets

| Id | Packet | Owns | Depends on | Acceptance |
|---|---|---|---|---|
| **P** The site service | `site/` as a deployable (Railway), Postgres schema (users, runners, jobs, records, approvals, audit copies, tokens), Google sign-in, pairing, the WebSocket end | G | two laptops paired; each sees only its own jobs |
| **Q** Mirror and queued approvals | runner upload of the record and evidence, site storage, approval queue and execution on reconnect | P | D9's phone scenario |
| **R** Inbox poller and token store | encrypted token store, poller per person, expiry banner | P, A | the inbox fills with the laptop off |
| **S** Lounge | one page | P, Q | per person: online, running tickets and jobs with lane, last active; nothing else |
| **U** Team Telemetry | usage lines mirrored per person; the shared gauge and forecast combined across everyone on one Claude account; a team page with the three common graphs | P, T | the team page shows the shared gauge, share by model and people on the account; a person's private graphs are unchanged |

Integration order: P, then Q+R, then S+U.

## 12. Risks and open questions

| # | Risk or question | Effect | What we do |
|---|---|---|---|
| R1 | ORBIT-479 is not deployed yet | v1's inbox cannot be tested against real Orbit | packet A ships with a fake server; the real test waits for the stack to merge and the flag |
| R2 | The split (packet G) is the biggest refactor and blocks all of v1.5 | schedule risk | it is first, alone, with "all existing tests unchanged" as the bar |
| R3 | Windows surprises: Playwright browsers, long paths, Postgres service, Claude Code on Windows | days lost | packet H runs in CI from day one; the manager's laptop is the proof, not the first test |
| R4 | The Agent SDK changes (0.3.x) | driver breakage | pin the version; the fake-query tests catch it |
| R5 | Railway and Google OAuth need Moxie approvals | v2 start slips | asked for during v1.5 (§5.3) |
| R6 | A stack's coordinator model merges wrongly | bad integrations | scheduling and merging are code; the model only writes the plan and the briefs |
| R7 | The redesign is a taste decision | rework | wireframes with options before code; Vignesh picks |
| Q1 | When does `redesign/orbit-ready` (the Ground Control repo's own working branch, where the last 33 commits live; nothing to do with Orbit) fast-forward into `main`? | packet base | Vignesh runs the fast-forward when ready; until then the base is the branch. Orbit work always bases on the org repo's `main`, as the Moxie rules say |
| Q2 | Is the Orbit profile file allowed in Orbit's root later, or does it stay in the registry? | packet J | registry for now |
| Q3 | Does the manager's laptop have admin rights for the service install? | packet I | `doctor` reports it; a no-service mode (`start` by hand) exists |
| Q4 | Which name for the npm package and the subdomain? | packet I, P | decided: `@moxie/ground-control`, CLI `ground-control`, state folder `~/.ground-control/` with a one-time move; subdomain at v2 |

*End of plan. Nothing is built until Vignesh approves it.*

