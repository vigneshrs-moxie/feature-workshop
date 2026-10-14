# Raw research reports (2026-10-14)

## paperclip

Paperclip report (research done 2026-10-14; the current release is v2026.1012.0)

## 1. What the product is
- Paperclip is an open-source (MIT) control plane that you host yourself. It runs teams of AI agents as if they were a company. It is a Node.js server with a React UI and an embedded Postgres database, and it serves `localhost:3100`. You install it with `npx paperclipai onboard --yes`. There is also `npx paperclipai test-drive`, which starts a separate instance that already has a CEO agent.
- It describes itself this way: "If OpenClaw is an employee, Paperclip is the company." The website headline is "A team of agents for every person", with the subtitle "Manage business goals, not pull requests."
- You bring your own agents. Supported runtimes include Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Hermes, OpenClaw and Pi, plus custom processes and HTTP endpoints. It does not include an agent of its own.
- The repo has roughly 100k stars, about 5k commits and 2.7k+ merged pull requests. It moves very fast and has many features behind experimental switches.

## 2. Core concepts and data model
- **Company:** one deployment can hold several companies, each kept fully separate.
- **Org chart:** agents and humans have roles, titles, reporting lines, permissions and budgets. Work is delegated up and down the chart. The human is "the Board."
- **Goals:** a chain from Mission to Project Goal to Agent Goal to Task, so each task carries the reason it exists.
- **Projects:** each project is tied to a repo or working folder, a budget and its execution workspaces.
- **Issues / Tasks:** the UI is renaming "issue" to "task." A task has one assignee and an execution lock, so a second agent claiming it gets a 409 error. Statuses are Backlog, Todo, In Progress, In Review, Done, Blocked and Cancelled. Tasks have parents and subtasks, blocked-by links, labels, comments, versioned "keyed documents" (for example `plan`), attachments and work products.
- **Heartbeats / runs:** agents wake up when something happens. That can be an assignment, a comment, "Wake now", a handoff from another agent, or a routine firing. A timer can also wake them, but it is off by default. Each wake is a recorded run with its own transcript. Every wake follows a fixed protocol: identify, list assigned work, check out a task, read the thread and parent tasks, do the work, comment, delegate.
- **Routines:** saved jobs with cron or webhook triggers. When a trigger fires, the routine creates or reopens a task. You choose what happens if a run is still going (coalesce, skip or enqueue) and how missed runs catch up.
- **Execution policy:** per-task review and approval stages, described in section 4.
- **Approvals and Decisions:** the governance objects.
- **Budgets:** limits per company, per agent and per project.
- **Skills:** `SKILL.md` folders, versioned and installed per company.
- **Connectors:** outside services, with a permission set per action.
- **Workspaces:** git worktrees plus runtime services such as dev servers.
- **Artifacts / work products:** the outputs, including PR cards.

## 3. Standout features and UX patterns (concrete)
- **Shell:** a left sidebar with New Task, Dashboard (with a "4 live" badge), Inbox (with a count), Conference Room, then a Work group (Tasks, Routines, Goals, Artifacts, Workspaces, Projects), an Agents list and a Company group. The theme is dark and monochrome with one accent colour.
- **Worktree banner:** when the app itself runs from a git worktree, a bright pink bar across the top reads "WORKTREE • PAP-46-NUX-TWEAKS", so you never mix up which copy you are looking at.
- **Task page as a chat:** the conversation fills the centre column. On the right is a side pane you can resize or maximise, with tabs for Properties, Plan, Artifacts, Tasks and Skill. One timeline merges comments, the live run streaming in, other live runs and collapsed past runs.
  - Each agent turn streams its thinking, tool rows and diffs. When it finishes, it collapses to one summary line: "Worked 4m · 23 tools · +120/−8 · tokens". A failed run reads "Stopped" instead of "Worked."
  - A live status line shows a pulsing dot, an elapsed timer and the current activity.
  - The view follows new output only while you are at the bottom. Otherwise a "Scroll to latest" button appears.
- **Interaction cards above the composer:** questions, plan confirmations, suggested tasks and approval requests appear inline in the thread and are also pinned in a separate card above the composer. The composer stays usable while they are open.
  - If you dismiss a question, it becomes an "Unanswered question" entry in history that you can reopen.
  - Expired cards turn into a plain divider.
  - "Preparing approval…" disables Accept until the server is ready.
- **Steer vs Interrupt:** a message sent while a run is going is queued above the composer. You can let it wait, use **Steer** to inject it into the current turn, or use **Interrupt** to stop the turn and start a new one. On an empty composer, **Stop** pauses the task or the whole subtree. A paused task replaces the composer with an amber panel ("Task is paused." / Resume task / Resume subtree) and keeps your drafts.
- **Work modes, chosen per message:** Auto, Plan and Ask (read-only), shown as a chip next to "+". You cycle them with ⌘. or Shift+Tab. Assignee, model and effort can also be changed per message, with "Reset to agent default."
- **Decisions page:** one ranked queue of everything that needs a human call: approvals, agent questions, failed runs, budget alerts, blocked chains and reviews.
  - Built-in lanes are PRs, Plans and Questions.
  - You can triage with a decide-by date (today, this week, a date) and snooze for 1h, 4h, tomorrow or next week. Undo is available for 8 seconds.
  - Agent-proposed decisions offer up to 8 options, and each states its exact effect. Destructive cascades make you type the issue ID to confirm.
  - Decisions expire after 7 days. "Dismiss — no effects" is recorded as a "no."
  - A row notes when its target changed after it was proposed ("1 target changed since this was proposed") and disables options based on the old state.
- **Blocked inbox:** each stalled item shows a reason chip: Needs decision, Blocked chain stalled, Needs attention, Recovery required, External wait or Owner paused.
  - Each item also shows an unblock owner, the action needed and how long it has been stopped ("stopped 2h"), with a severity dot.
  - Every block must record who can unblock it and what they need to do.
- **Command palette (⌘K):** Pages and Actions groups, and search across projects, tasks and agents with loose matching ("mkw" finds "Marketing Website"). Other keys: `?` lists shortcuts, `/` searches, `C` creates a task, `g f` opens a file.
- **Workspace detail:** tabs for Tasks, Services, Changes (a diff plugin), Configuration, Runtime logs and Routines.
  - The diff view has Split/Unified, Working tree vs Against ref, a ref picker, a file list with +/− counts, and folding of unchanged lines ("329 unmodified lines").
  - Services have Start, Stop and Restart. Logs show excerpts of stdout and stderr.
  - "Open workspace" opens the separate app copy through a one-time login handoff.
  - Port clashes between workspaces that share a dev server config are a known problem; the fix is to override the port by hand.
- **Artifacts:** type-specific cards. A PR card shows status, checks and lines changed; there are also cards for commits, documents, images, video, link previews, CSV (preview of up to 200×50) and files.
  - You can select text in a document and comment on it, like a shared document editor. Comment highlights follow the text as agents revise it and are marked stale or orphaned when the text changes or disappears.
  - You can lock a document; if an agent later writes to it, it writes to a new derived document instead.
- **Work Timeline:** a Gantt-style chart with one lane per agent. Bars are work periods, hovering a bar draws a connector to the handoff, overlapping bars show parallel work, and there is a minimap and zoom.
- **Conference Room / Agent Chat:** one ongoing chat per agent, with an "Agent Feed" panel of live activity on the right. The chat turns goals into ordinary tasks and posts a batched "here's what finished" message when they complete. `/new` starts a fresh session and leaves a divider.
- **Status Cards:** you write one message ("keep an eye on X"), and it becomes a summary tile that keeps itself up to date.
  - Each tile shows Fresh, Stale or Updating, plus cost and tokens per card.
  - Before spending tokens, it re-runs the saved query and compares a fingerprint, so an LLM call happens only when something meaningful changed.
  - There is a daily token cap and an active-hours setting.
- **Dashboard:** four cards (Agents Enabled, Tasks In Progress, Month Spend, Pending Approvals), a red budget-incident banner, 14-day charts (Run Activity, Tasks by Status, Success Rate), Recent Activity and Recent Tasks. It updates live.
- **Feedback votes:** Helpful / Needs work on any agent comment or document revision, with an optional "What could have been better?" Each vote saves a trace bundle locally.

## 4. How humans approve and steer agents
- **Execution policies:** review, then approval stages per task, enforced at runtime. When the executor marks a task Done, the system intercepts it, moves it to `in_review` and routes it to a reviewer. The executor can never review its own work.
  - **Approve:** mark it done with a comment. Comments are mandatory.
  - **Request changes:** move it to any other status with a comment. The task goes back to the original executor.
  - **Loop cap:** after `maxReviewRounds` (default 3) agent-only rounds of changes, the task escalates to the responsible human, and only that human can move it on.
  - Every decision is stored with actor, outcome, comment and run ID.
- **Approval types:** Hire Agent, CEO Strategy (no work starts until it is approved) and Budget Override.
  - Buttons are Approve, Reject and Request revision. After you request a revision, that button becomes "Mark resubmitted."
  - Comments on the approval are visible to the agent the next time it wakes.
- **Connector permissions:** each action is classified as read, write or destructive and set to Allowed, Ask first or Off. "A connector is not a permission."
- **Other controls:** pause, resume, reassign and terminate an agent. Reassigning mid-run interrupts the run after a confirmation, and the run is labelled interrupted rather than failed.
- **Required comment:** every agent run tied to a task must post a comment. If none appears, the agent is woken once more with reason `missing_issue_comment`.

## 5. Parallel agents
- Each run can get its own git worktree. Branches are named `{{issue.identifier}}-{{slug}}`, start from `origin/main` and live under `.paperclip/worktrees`.
- Per task you choose: shared checkout, new isolated workspace, or reuse an existing one.
- Runs on a shared checkout follow a concurrency setting: Auto, Serialize or Allow.
- Single assignee plus a checkout lock prevents two agents claiming the same task.
- Agents can also run in cloud sandboxes and other environments (e2b, Daytona, Modal, Kubernetes and others).

## 6. Cost and budgets
- Every call is metered with tokens and dollars, and the dollar figure is the cache-adjusted amount actually billed. Runs are labelled API-priced or subscription-backed.
- The **Providers** view shows quota windows (5-hour, daily, weekly), how much of each is used, and when each resets.
- There is a separate finance ledger for subscriptions, refunds and invoices, with "estimated vs authoritative" entries.
- At 80% a warning is recorded; at 100% the agent is paused automatically.
- Incident cards offer "Keep paused", "Raise budget & resume" or "Dismiss warning." Agents paused only for budget resume automatically when the month rolls over.
- Usage bars are green below 70%, yellow from 70 to 90% and red above 90%.

## 7. Observability and logs
- An activity log records every change, permanently. Each row reads as a sentence and shows the raw action name in small type, an "on behalf of" chip and a **View run** link. You can filter by agent, user, category and date, and export up to 10k rows to CSV; the export itself is logged.
- Run transcripts are kept per run and can scroll off.
- A silent-run watchdog flags a running agent as "suspicious" after 5 minutes without output and "critical" after 15. It only flags; it does not cancel anything.
- **Task Watchdogs:** you assign a verifier agent to a task subtree. When every leaf has stopped, it checks whether each stop was justified and can reopen work. It reviews each distinct stall only once (it fingerprints the stopped state) and cannot approve decisions reserved for the board.
- Run-problem states include "Recovery needed" (Inspect run / Continue / Retry), "Model unavailable" and "Model at capacity" (automatic retries after 1 and then 2 more minutes, otherwise the task is blocked).
- OpenTelemetry and Sentry are available if you switch them on. Anonymous telemetry is **on by default**.

## 8. Memory and context
- Context comes mainly from the task thread, the parent tasks and the goal chain, which are re-read on every wake.
- Skills load only when their description matches the task.
- A bundled `para-memory-files` skill gives file-based memory organised with the PARA method.
- Memory connectors (Mem0, Zep, Supermemory, Cognee, Honcho) are experimental. Memory/Knowledge is still listed as "in progress."
- Documents are versioned and can be locked, which works as durable shared context.

## 9. Templates and workflows
- A whole company can be exported and imported as a package: agents, projects, skills, routines, tasks and attachments, with secrets left out.
  - Import shows a preview of what will be created, renamed or skipped, or you can use `--dry-run`.
  - Imported agents and routines start paused, and an activation list lets you wake them one by one.
- There is a Team Catalog of ready-made teams, and community templates can be imported from GitHub repos.
- Routines can take `{{variables}}`. Skill Studio offers versions and saved test runs, and there are agent evals.

## 10. Collaboration and team features
- Multiple human users, RBAC and SSO, and one org chart shared by humans and agents.
- Teammates can read your agent chats, but only you can post in yours.
- Agents can be shared while using personal accounts, with a "sharing audience" setting.
- Chat connectors for Slack, Discord, Teams and Telegram are experimental. The UI also works on mobile.

## 11. Things to avoid (clearly bad or risky)
- **Too many concepts and switches:** the experimental list has more than 30 flags, including legacy "Classic" UIs. Concepts overlap: Inbox, Decisions, Approvals and Blocked; Issues versus Tasks. The UI has visibly drifted, and their own DESIGN.md admits roughly 220 places with hardcoded styling.
- **Company role-play:** CEO, CMO and "hiring" are fun but add ceremony for a single developer. Reviewers say the "zero-human company" pitch is aspirational and that mistakes compound when agents feed each other's output.
- **Agents fail quietly:** they lose context mid-task and silently reset their assumptions, and they state invented figures with confidence (kunalganglani review).
- **Setup is heavy:** days of configuration, reportedly 10 for one user. A timer heartbeat costs an LLM call on every wake, which makes cost unpredictable. Their own docs now recommend leaving timers off.
- **Testing a worktree locally is weak:** services have to be started by hand, ports clash, there is no "open in editor or terminal", and log excerpts are truncated.
- **Some status wording is wrong:** in v2026.1012.0 the budget warning card uses "hard stop" wording.
- **Telemetry on by default,** and shared feedback traces go to their servers.

## 12. Ideas worth stealing for Feature Workshop
1. **Turn summary line** ("Worked 4m · 23 tools · +120/−8 · $0.42") that collapses a finished stage. It keeps the Foreman conversation readable while the full detail stays one click away.
2. **Live status line** (pulsing dot, elapsed timer, current tool). It answers "is it stuck?" without opening logs.
3. **Steer vs Interrupt for messages sent mid-run, plus Stop = pause with an amber panel that keeps drafts.** These are the exact controls a terminal lacks.
4. **Pending-input card pinned above the composer, with the composer still usable.** Allow/Deny and question cards never get lost in scrollback; a dismissed question becomes an "Unanswered question" you can reopen.
5. **Decisions queue across all jobs,** with PRs, Plans and Questions lanes, snooze and a decide-by date. One place to clear every gate when several jobs are running.
6. **Blocked reasons with an owner and an action** ("External wait · you · run the DB migration · stopped 2h"). Every paused job explains itself.
7. **Changes requested go back to the same worker; cap the reviewer/implementer loop (3 rounds) and then escalate to you.** This maps directly onto your review stage and stops endless agent ping-pong.
8. **Mandatory comment per run, with one automatic retry if missing.** It guarantees every worker leaves a readable handoff for the Foreman and for you.
9. **Plan / Ask / Auto mode chip per message (Shift+Tab to cycle) and per-message model/effort override.** Familiar from Claude Code and cheap to add.
10. **Diff tab with Split/Unified and Working tree vs Against ref.** A good reference for your preview pane's diff view.
11. **Worktree identity banner** (a coloured strip naming the job or branch whose dev server you are viewing). It prevents testing the wrong worktree when several dev servers run.
12. **Workspace Services panel (Start/Stop/Restart, status, URL, stderr in red) with automatic port assignment.** Do the port allocation they don't, and add Open in iTerm/VS Code.
13. **Provider quota-window gauge** (5-hour and weekly usage plus reset time). It fits naturally with your usage-limit pause and resume.
14. **Per-job and daily budget caps with a warning at 80% and pause at 100%, plus "Raise & resume."** It is cheap to add on top of the usage tracking you already need.
15. **Work Timeline (one Gantt lane per worker subagent, with handoff connectors).** It shows parallelism and where time went; good as a "fun but useful" view.
16. **Comments anchored to passages in spec and plan documents, which follow the text across revisions, plus "lock approved version".** This gives you precise steering of briefs and plans, and an approved spec can't be quietly rewritten.
17. **Decision cards whose options state their exact effect, with a "target changed since proposed" warning and type-to-confirm for destructive actions.** Approvals are safer and clearer.
18. **Fingerprint-before-LLM refresh for status summaries** (Status Cards). Job summaries stay fresh without burning tokens.
19. **Task watchdog: a verifier agent that wakes only when everything has stopped and checks each "done" claim against the evidence.** It catches quiet early stops; it could be a Fable-style check.
20. **⌘K palette with Pages and Actions groups, loose matching, plus `C` = new job and `?` = shortcut list.** Matches your planned palette and these conventions are proven.
21. **Activity rows that read as sentences, with a View run link and an append-only log.** Gives you a cheap audit trail for the team.
22. **Job templates exported and imported with a preview and "start paused".** Lets you share flows (quick/small/large, reviewer sets) with teammates safely.
23. **Helpful / Needs work votes on worker outputs, stored locally.** A lightweight signal for tuning prompts and stage instructions over time.
24. **A design doc rule: "Every screen answers: what is happening, does it need me, what do I do about it."** A good North Star for the futuristic-but-professional look, along with their rules "status is systematic" and "machine values in monospace."

## Sources read
- https://github.com/paperclipai/paperclip (README)
- https://paperclip.ing
- https://docs.paperclip.ing
- https://docs.paperclip.ing/guides/day-to-day/dashboard/
- https://docs.paperclip.ing/guides/day-to-day/command-palette/
- https://docs.paperclip.ing/guides/day-to-day/issues/
- https://docs.paperclip.ing/guides/day-to-day/work-modes/
- https://docs.paperclip.ing/guides/day-to-day/approvals/
- https://docs.paperclip.ing/guides/day-to-day/decisions/
- https://docs.paperclip.ing/guides/day-to-day/blocked-inbox/
- https://docs.paperclip.ing/guides/day-to-day/costs/
- https://docs.paperclip.ing/guides/day-to-day/activity-log/
- https://docs.paperclip.ing/guides/day-to-day/work-timeline/
- https://docs.paperclip.ing/guides/day-to-day/artifacts/
- https://docs.paperclip.ing/guides/day-to-day/feedback-voting/
- https://docs.paperclip.ing/guides/power/execution-policy/
- https://docs.paperclip.ing/guides/power/export-import/
- https://docs.paperclip.ing/guides/projects-workflow/projects/
- https://docs.paperclip.ing/guides/projects-workflow/workspaces/
- https://docs.paperclip.ing/guides/projects-workflow/routines/
- https://docs.paperclip.ing/guides/projects-workflow/task-watchdogs/
- https://docs.paperclip.ing/experimental/overview/
- https://docs.paperclip.ing/experimental/isolated-workspaces/
- https://docs.paperclip.ing/experimental/agent-chat/
- https://docs.paperclip.ing/experimental/task-chat/
- https://docs.paperclip.ing/experimental/status-cards/
- https://docs.paperclip.ing/reference/skills/
- https://docs.paperclip.ing/connectors/
- https://github.com/paperclipai/paperclip/blob/master/DESIGN.md (read via the gh API)
- Repo screenshots: https://github.com/paperclipai/paperclip/tree/master/screenshots (PR-8000-task-thread-flag-on.png, PR-8000-conference-room-flag-on.png, PAP-9841-workspace-diff.png)
- https://www.kunalganglani.com/blog/paperclip-ai-review-zero-human-company.md
- https://www.eesel.ai/blog/paperclip-ai-review (written by a competing vendor, so weigh its criticism accordingly)

Four screenshots were saved for reference in `/private/tmp/claude-502/-Users-moxie-Projects-moxie-portal-vrs-app/40cd4e70-d84e-482c-9b9a-aa2914fdea56/scratchpad/pc_shots/`. No project files were changed.

---

## dify

# Dify research report (for the Feature Workshop redesign)

## 1. What Dify is
Dify (langgenius/dify, about 158k stars) is an open-source platform for building LLM apps: agentic workflows, RAG pipelines and chat apps. It covers a visual canvas, model management, agents, a "Prompt IDE", LLMOps (logs, annotations, monitoring) and backend-as-a-service (every app gets an API, a web app and an MCP server endpoint). You can use Dify Cloud, self-host the Community Edition with Docker Compose (setup runs through a web installer at `/install`), or buy Enterprise (SSO, RBAC, SLAs). The license is Apache 2.0 with extra conditions.

Dify builds **AI apps for end users**. Feature Workshop orchestrates **coding agents for a developer**. Dify's run, inspection, approval and logging patterns carry over well. Its canvas-builder parts mostly do not.

## 2. Core concepts and data model
- **Workspace** contains Members (roles Owner, Admin, Editor, Normal), plugins installed workspace-wide, model providers, knowledge bases and apps.
- **App types:**
  - **Workflow:** single-turn tasks, can run in batch, starts from User Input or a **Trigger**.
  - **Chatflow:** a workflow that runs once per conversation turn. It adds memory and conversation variables.
  - Legacy types: Chatbot, Agent, Text Generator. All run on the same engine.
  - **New Agent (beta):** a sandboxed worker, either standalone or used as an Agent node inside a workflow.
- **Nodes:** Start, User Input, Trigger (Schedule / Webhook / Integration), LLM, Agent, Human Input, If-Else, Iteration (parallel mode, up to 10 at once), Loop (loop variables, termination condition, max count, Exit Loop node), Code, HTTP, Tool, Variable Assigner, Template, Answer, End.
- **Variables:**
  - Inputs, fixed when a run starts.
  - Node outputs, which cannot be changed.
  - Environment variables (secrets, shared model config).
  - Conversation variables, which persist across turns.
  - System variables (`sys.user_id`, `sys.conversation_id`, `sys.dialogue_count`, and so on).
  - You reference variables from a dropdown or by typing `/`.
- **Versions:** a Current Draft that autosaves, a Latest (published) version, and Previous Versions that can be named, given release notes, restored or deleted.
- **Dify DSL:** a YAML export/import format for moving apps between instances. Agent skills and files are not included.
- **Run / Log records:**
  - Run History: test runs, with Result, Detail and Tracing tabs, plus a per-node "Last run".
  - Logs: production conversations and runs, with Trigger By, User Rate and Op. Rate.
  - Annotations: curated question and answer pairs.
- **Agent (new):**
  - Capability: role/prompt, model, Skills (`SKILL.md` packages), Files, Tools (plugins, MCP, APIs, workflows), env vars.
  - Task: what the agent is asked to do on a given run.
  - Sandbox: 20 GB, can run commands and install CLIs.
  - `build_note.md` is read at the start of every conversation.

## 3. Standout features and UX patterns (concrete)
- **Variable Inspector:** a panel docked at the bottom of the workflow editor that shows every node's captured inputs and outputs. You can click a value to edit it, and downstream nodes then use the edited value. Each variable has a revert icon, and there is a "Reset all". The docs' example is editing an LLM-generated SQL query and re-running only the DB node.
- **Single-node run / step-by-step:** run any node on its own with test input. Upstream outputs are cached, so you don't re-run the whole chain. Every node has a "Last run" view with inputs, outputs, timing and error.
- **Run History tabs:**
  - Result: final output, or the error.
  - Detail: inputs, outputs and system metadata.
  - Tracing: which nodes ran in what order, how long each took, and how data moved, including through branches and loops.
- **"Test With Params":** re-runs a past production run in the editor with the same inputs, to reproduce a bug.
- **Logs screen:**
  - Columns: Title (from the first message), End User/Account, User Rate, Op. Rate, Trigger By.
  - Search covers message text, session ID, inputs/outputs and run ID.
  - Hovering an answer shows its token spend, latency and raw prompt or node trace.
  - Entries can be shared by URL.
- **Error handling per node:** None (stop), Default Value, or Fail Branch, which is drawn in orange. `error_type` and `error_message` are available to later nodes. Iteration has three modes: terminated, continue-on-error, remove-abnormal-output.
- **Agent Build mode:**
  - You configure the agent by chatting with it; the Configure panel is read-only while you do.
  - Changes collect in a **Build draft** that you **Apply** or **Discard**. Discard also removes files the build chat created.
  - A File system button (top right) lets you browse sandbox files, split into Persistent and Temporary.
  - The right panel switches between **Build** and **Preview**; chatting in Preview does not change the configuration.
  - Restoring a version also restores that version's sandbox files.
- **Hard run limits on agents:** 1 hour per run (the unfinished reply is discarded) and 500 model calls per run. The Classic Agent has a "Max Iterations" setting, with suggested values of 3–5 for simple tasks and 10–15 for research.
- **Triggers:**
  - "Test Run > Run all triggers" puts the app in a listening state; the first trigger to fire starts the run.
  - The Trigger card on the Access Point tab switches triggers on and off.
  - Logs show the trigger source of each run.
- **Collaboration (v1.14.1, self-hosted only for now):**
  - Live multi-editing with collaborator cursors; conflicting edits are last-write-wins.
  - Comments are pinned to the canvas: right-click for "Add Comment", or press `C` for a comment mode that places several in a row.
  - Comments carry across versions. @mentions send email.
  - Nodes can be copy-pasted across workflows and across instances.
  - A Creator Center and Template Marketplace publish a workflow in one click.
- **Plugins / Marketplace:**
  - Seven types: Model Provider, Tool, Data Source, Trigger, Agent Strategy, Custom Endpoint, Extension.
  - Install from the Marketplace, a GitHub URL or a local `.zip`.
  - Workspace settings control who may install/manage (Everyone / Admins / No one) and who may debug. Auto-update can be off, patch-only, or always latest.
- **Annotation Reply:** curated answers are matched by embedding similarity above a threshold. Hit history shows how often each fires, its similarity scores, and coverage gaps. You create one by editing an AI reply in logs or debug and saving it.

## 4. How humans approve and steer agents
- **Human Input node (v1.13.0+):**
  - Pauses the run and sends a form.
  - The form has Markdown content plus live workflow variables, such as the LLM draft or upstream files. For reasoning models, enabling "Enable Reasoning Tag Separation" hides the thinking.
  - Fields: Paragraph (optional, can be pre-filled with the draft so the reviewer edits in place), Select (static options or from an array variable), Single File, and File List (up to 10 files).
  - **Decision buttons:** each has a title, an action ID and a style (primary or secondary), and each routes to its own branch. Buttons stay disabled until required fields are filled.
  - Delivery is through the web app or by email. Email recipients can be workspace members, external addresses or the whole workspace, and don't need an account. The **first response wins**.
  - Timeout defaults to 3 days and has its own timeout branch. With no timeout branch connected, the run ends.
  - Outputs: `__action_id`, `__action_value`, `__rendered_content`, plus one variable per field.
- **Patterns from Dify's blog:**
  - Approve / Apply Edit / Regenerate-with-feedback. The feedback goes to a Regenerate LLM, then a "Check Revision" LLM verifies the feedback was addressed.
  - Forward to a second Human Input node offering only Confirm or Decline, to force a final call.
  - On timeout, take the forward or escalation path.
- **Human Input API (v1.14.1):** external systems (Slack and similar) can list pending tasks, fetch form data and submit decisions. This works alongside the Console approval interface.
- **Resumable streams:** `GET /workflow/{run_id}/events` reconnects after a pause or a dropped connection.
  - `include_state_snapshot=true` first replays the status of nodes that already ran.
  - `continue_on_pause=true` keeps the stream open across several pauses.
  - Event types: `workflow_paused`, `human_input_form_filled`, `node_started`, `node_finished`, `reasoning_chunk`, `text_chunk`, `message`, `message_end`, `workflow_finished`, `ping`.
- **Gaps:** the agent docs I read describe no per-tool-call permission prompts and no way to step in mid-run. Steering is either built into the flow at design time (Human Input nodes) or happens at build time (Build mode Apply/Discard).

## 5. Parallel agents, cost, observability, memory, templates, team
- **Parallel:**
  - Iteration parallel mode runs up to 10 items at once.
  - A canvas can hold several independent workflows, and a workflow can have several triggers.
  - Two Agent nodes using the same agent run separately and share no files or tools.
  - There is no "fleet" view of agents running at the same time.
- **Cost/budgets:**
  - Tokens are shown per answer and per run.
  - The Monitoring dashboard has four charts: Total Messages, Active Users, Average User Interactions, Token Usage.
  - The docs pages I read show no dollar cost; a third-party client models price fields, but I did not find them in Dify's own docs.
  - Budgets are hard caps (1 hour or 500 model calls per run, Max Iterations), plus plan quotas on trigger runs.
- **Observability:** built-in Run History and Logs, plus external tracing set up under Monitoring > "Tracing app performance". Supported: Langfuse, LangSmith, Opik, Weave, Arize, Phoenix, Aliyun. Runs map to traces, nodes and tools to child spans, and usage is recorded as tokens.
- **Memory/context:**
  - Chatflow: memory window plus conversation variables.
  - Agent: memory per conversation only; a new conversation starts empty.
  - `build_note.md` gives agents memory that carries across conversations.
  - Variables passed to an agent task are cut at 2,000 characters, so long content must go as a file.
- **Templates/workflows:** DSL export and import, cross-instance node copy-paste, Creator Center and Template Marketplace, Explore.
- **Team:** four roles. Plan limits: Sandbox 1 member, Professional 3, Team 50. Invites expire after 72 hours. Ownership transfer needs an email code. Version history can be filtered to "only mine" or "only named". Live collaboration is described above.

## 6. Things to avoid (Dify's weak spots)
- **Debugging opacity in big flows:** practitioners say tracing a bad output back to the node that produced it is painful ("debugging a black box with a small window"), and teams add LangSmith or Helicone to cope.
- **Limits of visual abstraction:** dynamic loops, complex state and branching strain the canvas, so people fall back to Code nodes. Users ask for a "code mode". Reported "week-two wall" once custom logic is needed.
- **Editor instability:** forum reports of the view jumping and new nodes' parameters resetting; reported lag on large graphs.
- **Rough limits:** small variable size caps, 2,000-character truncation, and missing operators.
- **Last-write-wins collaboration** with no conflict warning.
- **Approvals only by design:** no ad-hoc "pause or ask me before X" during a run.
- **Restore overwrites the draft** without a diff or comparison view; the docs mention no version compare.
- **Token-only cost reporting:** no dollar burn or budget alerts in the docs I read.
- **Painful upgrades:** breaking changes between minor versions, and thin migration docs.
- **Paywalled basics:** version restore and running a specific published version need a paid plan.

## 7. Ideas worth stealing for Feature Workshop
1. **Typed approval cards with named decision buttons that route** (Approve / Apply my edit / Regenerate with feedback / Forward). This beats plain Allow/Deny, because each button maps to a clear next step for the Foreman.
2. **Pre-fill an editable field with the agent's draft** (a spec, plan or PR description). Approving your own edit is faster than writing feedback.
3. **A "Regenerate with feedback" loop plus an automatic "check the revision addressed the feedback" step.** It closes the loop on the reviewer's notes instead of trusting the worker.
4. **A timeout branch on gates** (for example, if not answered in N hours, ping on phone or Slack, or park the job). Jobs never sit silently blocked.
5. **A pending-approvals API and inbox across all jobs** (Dify's Human Input API). One place to clear every gate, and later Slack or phone responses.
6. **Reconnect with a state snapshot** (`include_state_snapshot`, `continue_on_pause`). When the UI reloads, the job's stage history replays instantly, so the view is never empty after a refresh.
7. **A Variable-Inspector-style "stage outputs" drawer** (spec, findings, plan, test results), editable, with revert per item and "Reset all". You can fix one stage's output and re-run only the stages after it.
8. **Re-run a single stage with cached upstream outputs** (Dify's single-node run). Retry review or tests without redoing implementation.
9. **A "Last run" view per stage**, showing inputs, outputs, duration, tokens and error. Each pipeline step can be debugged on its own.
10. **A Result / Detail / Tracing tab trio on each job**, with a stage timeline showing durations and where it slowed or failed. Answers "what happened and where it stalled" at a glance.
11. **Hover an answer to see its tokens, latency and raw prompt or tool calls.** Detail on demand keeps the conversation pane clean.
12. **"Test With Params": re-run a past job or stage with the same inputs.** Reproduces flaky worker behaviour.
13. **Per-stage error policy (stop / default / fail branch) shown in orange**, using `error_type` (such as rate_limit) to pick a message or recovery. Makes the usage-limit pause/resume one visible recovery branch instead of a special case.
14. **Hard per-job caps: wall-clock time, model calls, and a max-iterations setting per stage.** Cheap protection against runaway sessions, alongside a dollar estimate Dify lacks.
15. **The Build-draft pattern: Apply/Discard of configuration the agent proposes, with config read-only meanwhile.** Fits letting the Foreman suggest job options or allow-rules that you accept in one batch.
16. **A persistent per-job or per-repo `build_note.md` the agent reads at session start.** Simple, inspectable memory that carries across Foreman restarts.
17. **Persistent vs temporary file lanes and a file-system browser for each job's worktree.** Makes clear what will be committed and what is scratch.
18. **Named versions with release notes for flows and templates**, plus "only mine" and "only named" filters. Useful when the quick/small/large flow presets change.
19. **Export/import of job templates (like Dify DSL) and copy-paste of stage configs** between jobs and teammates. Easy team sharing of flows and reviewer setups.
20. **Pinned comments with a `C` hotkey and @mention notifications**, attached to diff lines or stages. Lightweight team review inside the tool.
21. **"Trigger By" labels and a listening mode** (job started from a past session, a schedule, a webhook or a GitHub issue). Shows where each job came from, and opens the door to scheduled or automatic jobs.
22. **Op. Rate: thumbs up/down with a comment on worker outputs, plus annotation hit history.** Builds a record of which subagents or prompts do well, and turns corrections into reusable guidance.
23. **One-click export to Langfuse or OpenTelemetry tracing**, set up in a Monitoring panel. Gets real observability without building it.
24. **Workspace setting for who may install or approve plugins and skills** (Everyone / Admins / No one). Fits team use of shared auto-allow rules.

## Sources I read
- https://github.com/langgenius/dify
- https://docs.dify.ai/en/use-dify/getting-started/key-concepts
- https://docs.dify.ai/en/use-dify/nodes/human-input
- https://www.dify.ai/blog/the-human-input-node-bringing-human-judgment-into-automated-workflows
- https://docs.dify.ai/llms.txt and https://docs.dify.ai/_llms/en/cloud.txt
- https://docs.dify.ai/en/cloud/use-dify/monitor/logs.md
- https://docs.dify.ai/en/cloud/use-dify/monitor/analysis.md
- https://docs.dify.ai/en/cloud/use-dify/monitor/annotation-reply.md
- https://docs.dify.ai/en/cloud/use-dify/monitor/integrations/integrate-langfuse.md
- https://docs.dify.ai/en/cloud/use-dify/debug/history-and-logs.md
- https://docs.dify.ai/en/cloud/use-dify/debug/variable-inspect.md
- https://docs.dify.ai/en/cloud/use-dify/debug/step-run.md
- https://docs.dify.ai/en/cloud/use-dify/build/new-agent/overview.md
- https://docs.dify.ai/en/cloud/use-dify/build/new-agent/build.md
- https://docs.dify.ai/en/cloud/use-dify/build/version-control.md
- https://docs.dify.ai/en/cloud/use-dify/build/predefined-error-handling-logic.md
- https://docs.dify.ai/en/cloud/use-dify/workspace/team-members-management.md
- https://docs.dify.ai/en/cloud/use-dify/workspace/plugins.md
- https://docs.dify.ai/en/cloud/use-dify/nodes/trigger/overview.md
- https://docs.dify.ai/en/cloud/use-dify/nodes/iteration.md
- https://docs.dify.ai/en/cloud/use-dify/nodes/loop.md
- https://docs.dify.ai/en/cloud/use-dify/nodes/agent.md
- https://docs.dify.ai/en/self-host/use-dify/build/workflow-collaboration
- https://www.dify.ai/blog/dify-1.14.1-workflows-become-a-team-asset
- https://docs.dify.ai/en/api-reference/workflow-runs/stream-workflow-events.md
- https://enterprisedna.co/resources/blog/practitioner-dify-platform (third-party practitioner review)

Seen only in search-result summaries, not opened: G2/PeerSpot reviews (https://peerspot.com/products/dify-pros-and-cons, https://g2.com/products/dify-ai/reviews?page=2), a Dify forum bug thread (https://forum.dify.ai/t/bugreport-0-11-3-4-bug/670?tl=en), and the 1.14.0-rc1 forum post, which could not be fetched (DNS error).

---

## openorchestrators

# Research report: openorchestrators.org and coding-agent orchestrators (for the Feature Workshop redesign)

## 1. What openorchestrators.org is

- It is a directory and news site, not a product. Its tagline is "Track the projects shaping multi-agent orchestration." It is run as a sub-brand of Agent Analytics (agentanalytics.sh), a web analytics company for builders.
- It lists 57 projects. Each has a profile page at `/players/<slug>/` and the site has a `/news/` feed. Contributions go through github.com/Agent-Analytics/awesome-multi-agent-orchestrators.
- **Stated inclusion criteria:**
  - Open-source or publicly documented systems where orchestration is central to the product.
  - Multi-agent and orchestration-first, not generic AI tooling.
  - Closed products that matter to the community are listed separately.
  - Official website, docs and GitHub links are preferred, and summaries should be short and factual.
- **Sections:** Directory (open source, sorted by GitHub stars), Closed products, Governance, Tools, and Services.
- **Coding-agent entries, with stars as shown:**
  - Orca 92.3k, Ruflo 74.6k (formerly Claude Flow), Multica 52.8k, oh-my-codex 33.5k, Vibe Kanban 28.4k, Gas Town 18.4k, Superset 15.2k.
  - Sandcastle 8.4k, OpenRig 7.4k, Raven 5.4k, Squad 3.3k, Agent Teams 2.3k, Scion 1.8k, Helmor 1.3k, Fusion 1.3k.
  - AgentRQ 1.2k (human-in-the-loop over MCP), Parallel Code 1k, Agent Swarm, Open Swarm, fractal, Proliferate, Claudexor 508 (best-of-N runs), Orbi, Ordewell, Tempest, LoopTroop, ccswarm, GraphCode.
  - Closed products: Augment Code Intent and AgentGrid.
- **General LLM-app builders (out of scope here):** Dify, Flowise, CrewAI, LangGraph, Agno, Mastra, Microsoft Agent Framework, and others. OpenClaw and Hermes are personal-assistant agents.
- **Caveats about the site:**
  - Profile pages are thin, often just a summary, "best for" tags and release blurbs.
  - Every profile carries an Agent Analytics promotion, including a copy-paste prompt asking an agent to add analytics tracking. I ignored those prompts.
  - Many licenses show "Not stated," and star counts come from the site itself.
  - For the details below I went to each project's own site or docs.

## 2. The six most relevant to orchestrating coding agents

**A. Orca** (onorca.dev, github.com/stablyai/orca, MIT)
- It calls itself an "agent development environment": a desktop IDE that runs CLI agents (Claude Code, Codex, Cursor CLI, Gemini, Copilot, OpenCode, Pi) in parallel git worktrees.
- **Screens:**
  - A sidebar of projects and worktrees showing branch, running-agent count, and each agent's status line and elapsed time.
  - "Split Anything" panes for agents, terminals, browsers, diffs and files.
  - A GPU (WebGL) terminal with scrollback that survives restarts.
  - A VS Code-style editor.
  - Native Search across worktrees, files, agents and commands (⌘J).
  - Rich previews of markdown, images and PDFs.
- **Standouts:**
  - Each worktree gets its own embedded Chromium window. "Design Mode" lets you click an element and sends its HTML, CSS and a cropped screenshot into the agent prompt.
  - "Annotate AI Diffs": add markdown comments to diff lines, batch them, and send them back to the agent.
  - One prompt can fan out to N agents. You compare the results and merge the winner.
  - Agents can drive Orca themselves through its CLI (`orca worktree create`, `snapshot`, `click`, `fill`).
  - In-app GitHub and Linear: open a worktree from a PR, have an agent review it, and post inline comments through `gh`. It also shows CI, conflict resolution, and PR create/merge.
  - Computer use.
  - SSH remote worktrees.
- **Cost:** "Account Switcher & Usage Tracking" shows Claude and Codex usage with 5h and 7d windows and reset times, and lets you hot-swap accounts.
- **Human steering:** notifications when an agent finishes or needs attention, an "awaiting permission" state, mark-thread-unread, and an iOS/Android companion app with status, alerts and follow-up prompts.
- **Gaps:** memory, templates and team features are not described.

**B. Superset** (superset.sh, docs.superset.sh, Elastic License 2.0)
- A local editor and control plane for many CLI agents, each in a worktree "workspace."
- **Screens:**
  - A workspaces sidebar grouped by desktop, cloud and remote host. Each item has an activity strip with diff counts, status spinners, open ports and PR state, and agent chips.
  - A Changes/Review panel with "Side by Side" and "Inline" views and "Against Main / Unstaged / Commits" scopes, plus Approve and Comment actions.
  - A status board with "In Progress" and "Ready for Review" columns.
  - An Automations table (scheduled agents that open PRs).
  - A ports panel: kill a port, jump to its terminal, open in the in-app or external browser, with labels from `.superset/ports.json`.
  - An "Open in" menu for Finder, Cursor, VS Code, Xcode, Terminal and JetBrains.
- **Status detection:**
  - It installs lifecycle hooks into the agents' configs, which report started, finished and waiting-for-input.
  - It sends notifications, sounds and a macOS dock badge.
  - Agents can pause inline to ask questions, request tool approval or ask for plan review. The workspace is then flagged as needing attention.
  - A "Clear Status" control exists for stale running states.
- **Lifecycle scripts:** `.superset/config.json` defines `setup`, `teardown` and `run`.
  - Override layers: per-workspace, per-user, and `config.local.json` with `before`/`after`.
  - Env vars: `SUPERSET_ROOT_PATH` and `SUPERSET_WORKSPACE_PATH`.
  - An option to wait for setup before starting agents.
  - It does not allocate ports per workspace. The docs tell you to do it yourself in scripts.
- **Usage page:**
  - Quota meters per account: Claude "Session (5h)" and Weekly, with time to reset.
  - Estimated spend at API list prices, shown as "Cost to you: $0" for subscriptions, plus what caching saved.
  - Per-agent, per-day, per-model and per-workspace breakdowns, and "top sessions by cost" with a copyable `claude --resume` ID.
  - A Machine resources view (CPU, RAM, a process table per workspace, ⌘⇧U).
- **Recipes:** "race agents" (N workspaces, same prompt, keep the smallest diff that fully solves the task), "fan-out refactor," "nightly audit," "PR feedback."
- **Other:** CLI, TypeScript SDK, an MCP server so agents control Superset, and an iOS app.

**C. Vibe Kanban** (vibekanban.com/docs, github.com/BloopAI/vibe-kanban, Apache-2.0)
- **Status:** the company (Bloop) shut down on 2026-04-10 because it found no business model. The code continues as community open source and the cloud team features were lost.
- **Model:** Kanban issues, then workspaces. Each workspace has multiple repos, a branch, a terminal, a dev server and multiple sessions.
- **Four-panel layout:**
  - Workspace Sidebar, with an accordion grouped by "Needs Attention / Idle / Running," pins, a blue dev-server dot and a PR badge.
  - Conversation Panel, with a session dropdown and agent/variant picker.
  - Context Panel, which shows one of Changes, Logs (a tab per process) or Preview.
  - Details Sidebar: git ahead/behind, an xterm terminal, and auto-saving per-workspace Notes.
  - A draggable floating "Context Bar" (open in IDE, copy path, start/stop dev server).
  - Layout is saved per workspace.
- **Cmd+K command bar:**
  - Paged groups: Quick, Workspace, Git, View, Diff, Repo actions.
  - Contextual commands: Push only when there are unpushed commits, Rebase only when behind.
  - Fuzzy matching across pages (`cpr`).
- **Preview browser:**
  - It reads the dev-server URL from stdout and loads it automatically.
  - Desktop, mobile (390×844) and responsive modes.
  - Eruda devtools inside the iframe.
  - "Select element as context" click-to-component for React, Vue, Svelte and Astro, sent to the chat.
- **Repo scripts:** setup (once at start), cleanup (on close, should be idempotent), dev server.
- **Agent profiles/variants:** saved configs per agent covering plan mode, model, permission level and env vars. Shown as labels like Default, Approvals, Opus, Plan.
- **Review:** inline diff comments. These are not sent automatically; you have to send a chat message. There is no formal approve button.
- **Other:** "Tags" are reusable prompt snippets inserted with @mention. There is also an MCP server.

**D. Gas Town** (github.com/gastownhall/gastown)
- A tmux/CLI workspace manager in which Claude Code is the default runtime.
- **Data model:**
  - Town is the workspace, and Mayor is the coordinator Claude with full context.
  - Rigs are per-repo containers, and Crew are your personal clones.
  - Polecats are workers with persistent identity but short-lived sessions.
  - Hooks are worktree-backed persistent work state.
  - Beads are git-backed issues with IDs like `gt-abc12`, and Convoys bundle beads.
  - Formulas and Molecules are TOML workflow templates with step `needs`.
- **Merging:** finished work goes through `gt done`, which creates a merge-request bead. The "Refinery" is a per-rig, Bors-style bisecting merge queue with verification gates; workers never push to main.
- **Escalation:** `gt escalate` with P0, P1 and P2 severities, routed to Deacon, Mayor, Overseer.
- **Observability:**
  - `gt feed` is a 3-panel TUI: agent tree, convoys and a live event stream.
  - A Problems view classifies agents as Stalled, Zombie, Working or Idle, with key `n` to nudge and `h` to hand off.
  - `gt dashboard` is a web view with a command palette.
  - OpenTelemetry export, and a watchdog chain (daemon heartbeats, Deacon, per-rig Witness).
- **Memory:** `gt prime` restores context. `gt seance` finds predecessor sessions from `.events.jsonl` and lets you question them.
- **Capacity:** `scheduler.max_polecats` caps concurrency to avoid rate-limit exhaustion, with pause and resume.
- **Teams:** "Wasteland" is a federated work network with reputation stamps.
- **Warnings from the project itself:** 4–10 agents "can become chaotic without coordination," and the dashboard port should be treated as trusted-LAN only.

**E. Fusion** (runfusion.ai, github.com/Runfusion/Fusion)
- A "software factory" with a task board: Triage, Todo, In Progress, In Review, Done.
- **Spec first:** triage agents write a `PROMPT.md` spec with acceptance criteria before any code. "Planning mode" asks structured multiple-choice questions to draft it.
- **Gates:** each step runs plan, review, execute, review, with options to revise, approve, continue or rethink.
  - Configurable pre- and post-merge gates: docs, QA, security, performance, accessibility, UX.
  - "Auto-merge when clean."
  - "Steer agents mid-flight": nudge, pause or re-prompt without restarting.
- **Hierarchy:** Mission, Milestone, Slice, Feature, Task.
- **"Smart merge":** tracks the files each task touches and the dependencies between tasks. Dependent tasks auto-rebase in order.
- **Model lanes:** executor, planner, validator, title and workflow, each overridable globally, per project or per task.
- **Command Center:** 11 views (Autonomy, Economics, Team, Output, Vitals) with tokens and USD per model and per agent, and CSV/OTLP export.
- **Communication:**
  - Agent chat per task, with "question cards" and resumable streams.
  - Chat rooms with @mention.
  - Agent mail with Inbox, Outbox and an Approvals view.
- **Memory and learning:** "qmd" is queryable markdown memory. "Agent performance reviews" update AGENTS.md after each task.
- **Other:** multi-node mesh, mobile apps and a PWA.

**F. Paperclip** (paperclip.ing, MIT)
- A company-style control plane. Its own framing is "Manage business goals not pull requests."
- **Model:**
  - Company, Goals (mission, project goal, agent goal, task), an Org chart of agents, Heartbeats (scheduled or event wakes), and Tickets with owner, status and thread.
  - Parent and child issues, with blocker-aware wakes.
- **Budgets:** a monthly budget per agent, a soft warning at 80%, auto-pause plus blocked new tasks at 100%, and a board override. Cost is tracked per agent, task, project and goal.
- **Governance:**
  - The human is "the board." Hiring agents and executing strategy need approval.
  - Pause, resume, override, reassign or terminate any agent.
  - "Execution policies" attach review and approval stages to an issue.
  - Append-only audit log.
- **UX:**
  - Chat-style issue threads.
  - A "Blocked Inbox" with blocked-reason chips and deterministic urgency sorting.
  - Recovery actions, each with an owner, evidence, a wake policy and an outcome (restored, blocked, cancelled, false_positive).
  - Questions and approvals can be answered while a run is active. Answers are queued as immutable responses, and an explicit click either steers them into a turn or interrupts for a fresh session.
  - Heartbeat timeline.
- **Honourable mention: Multica.** Agents are teammates in the same assignee dropdown as humans. A live "progress card" shows elapsed time, tool-call count and each file read or edit. A Runtimes panel shows token usage, an activity heatmap and daily cost. It also has reusable SKILL.md skills.

## 3. Cross-cutting patterns

- **Data model:** almost everyone uses a task/issue with an isolated worktree workspace, one or more sessions, and a diff, then a PR. Hierarchy (mission, epic, task) appears in Fusion, Paperclip and Gas Town.
- **Human approval and steering:**
  - Inline approval and question cards in the chat (Superset, Fusion, Paperclip).
  - Diff-line comments batched back to the agent (Orca, VK).
  - Named gates with revise/approve/rethink (Fusion).
  - Board-level pause, override and budget override (Paperclip).
  - A Needs-Attention group in the sidebar plus OS notifications and dock badge (Superset, VK, Orca).
- **Parallel agents:**
  - Worktree per task, with live status per workspace.
  - Race / best-of-N and compare diffs (Orca, Superset, Claudexor).
  - Concurrency cap (Gas Town scheduler).
  - Dependency-aware rebase ordering (Fusion).
- **Cost and budgets:**
  - Subscription quota meters with reset countdown (Orca, Superset).
  - Estimated API-equivalent cost and caching savings (Superset).
  - Per-agent budgets with auto-pause (Paperclip).
  - Per-model USD (Fusion).
- **Observability:**
  - Per-process log tabs (VK).
  - Event-stream TUI and a stuck/zombie classifier (Gas Town).
  - OTLP export (Gas Town, Fusion).
  - Append-only audit (Paperclip).
  - Machine-resource view per workspace (Superset).
- **Memory and context:** notes per workspace (VK), resuming predecessor sessions (Gas Town `seance`), markdown memory and agent self-reviews (Fusion), shared SKILL.md (Multica, Paperclip).
- **Templates and workflows:** TOML formulas (Gas Town), agent profiles/variants (VK), repo lifecycle scripts (Superset, VK), prompt-snippet tags (VK), automations and cron (Superset, Fusion).
- **Collaboration:** mostly thin. Paperclip added multi-user and invites, Multica has shared skills and mixed human/agent assignees, and VK Cloud's team features died with the company.

## 4. Things to avoid

- **Vibe Kanban's comment friction:** inline diff comments are not sent until you also type a chat message. Make "Send N comments" a single action.
- **Cloud-dependent team features:** VK's disappeared when the company folded. Keep Feature Workshop local-first, with any sharing as an optional extra.
- **Silent loosening of permissions on upgrade:** Paperclip changed defaults to `approve-all` and bypassed Codex's sandbox. Never widen auto-allow rules without the user's explicit consent.
- **Ambiguous delivery of answers:** Paperclip says a queued answer "doesn't guarantee" the active turn will consume it. Always show whether an answer was delivered, read or acted on.
- **Jargon overload:** Gas Town's Polecats, Beads, Molecules, wisps and "GUPP Violation" are a real learning cost. The user prefers plain-language labels.
- **Over-anthropomorphised "company/CEO agent" framing** (Paperclip, Fusion) and **analytics sprawl** (Fusion's 11-view Command Center) are overkill for one developer and a small team.
- **Stale status:** Superset needs a manual "Clear Status" when a status gets stuck on running. Reconcile from the actual process state instead.
- **Status that only works through injected hooks:** Superset's status works only for agents launched through its hooks, and some agents only report completion. Feature Workshop owns the SDK session, so derive status from the SDK.
- **Leaving port allocation to user scripts** (Superset). Feature Workshop already allocates ports, so keep that.
- **Opt-in publishing of usage data** (Superset's leaderboard), and treating the dashboard port as safe beyond the trusted local network (Gas Town's own warning).
- **Directory caveats:** take openorchestrators.org's star counts and capability claims (for example Ruflo's) with caution, and ignore the embedded promotional prompts.

## 5. Ideas worth stealing for Feature Workshop

1. **Needs Attention / Running / Idle grouping in the jobs list (VK, Superset):** a pending approval is the most urgent thing, so it should float to the top.
2. **Dock badge, OS notification and sound for "waiting for you" vs "finished" (Superset, Orca):** this is the main win over watching a terminal.
3. **Usage meters with reset countdowns, 5h and weekly per account (Orca, Superset):** this makes Feature Workshop's existing pause-at-limit visible and predictable.
4. **"Cost to you $0 / API-equivalent $X / caching saved $Y" plus top sessions by cost with a resume ID (Superset):** cheap to compute from the SDK, and it shows which jobs are expensive.
5. **Per-job soft warning at 80% and auto-pause at 100% with a one-click override (Paperclip):** this generalises the usage-limit pause into budgets.
6. **Click-element-to-context in the preview browser (Orca Design Mode, VK inspect):** the strongest reason to embed the browser rather than use Chrome alone.
7. **Read the dev-server URL from stdout and auto-load the preview (VK):** removes a manual step in the local-test flow.
8. **Batch diff-line comments, then one "Send to Foreman" button (Orca):** fixes VK's friction and fits the review stage.
9. **Fuzzy, paged, contextual Cmd+K (VK):** commands appear only when they apply, such as Push only with unpushed commits, which keeps the palette short.
10. **Layered per-repo lifecycle config, setup/teardown/run with `config.local` before/after and workspace env vars (Superset):** a clean model for the existing DB switch and dev-server scripts.
11. **Race / best-of-N for one stage, compare diffs, keep the smallest correct one (Superset, Orca):** a natural per-job option next to quick/small/large.
12. **Gate actions labelled revise / approve / continue / rethink, plus "steer mid-flight" (Fusion):** richer than Allow/Deny for stage gates.
13. **Spec as a file with acceptance criteria, drafted from multiple-choice questions (Fusion PROMPT.md):** matches the spec stage and the 3-question brief limit.
14. **Live progress card with elapsed time, tool-call count and each file read or edit (Multica):** worker subagents become legible without reading logs.
15. **Stuck/zombie detection plus nudge and hand-off (Gas Town Problems view):** catches silently stalled workers.
16. **"Seance": ask a question of a past session (Gas Town):** extends "start a job from past Claude Code sessions" into querying them.
17. **Blocked Inbox with reason chips and urgency sort (Paperclip):** a single view of every gate and question across jobs.
18. **Per-job auto-saving notes and per-job saved pane layout (VK):** cheap, and makes the three-pane workspace feel personal.
19. **Agent profiles/variants such as "Plan," "Opus," "Approvals" (VK):** maps to per-job reviewer and model choices as reusable presets.
20. **Append-only audit of approvals and auto-allows (Paperclip):** builds trust in the auto-allow rules and helps team review.
21. **Ports panel: label, kill, jump to the owning terminal, open in browser (Superset):** fits the "test locally" pane.
22. **"Open in" menu (Finder, VS Code, Cursor, iTerm, Terminal) with a shortcut (Superset):** already planned; Superset's menu is a good reference.
23. **Machine-resources view per job (Superset):** several dev servers and worktrees at once can quietly eat RAM.

## Sources read

- https://openorchestrators.org/
- https://openorchestrators.org/players/orca/
- https://openorchestrators.org/players/vibe-kanban/
- https://openorchestrators.org/players/gastown/
- https://openorchestrators.org/players/superset/
- https://openorchestrators.org/players/fusion/
- https://openorchestrators.org/players/multica/
- https://openorchestrators.org/news/
- https://openorchestrators.org/news/paperclip-2026-1001-review-bots-approvals/
- https://openorchestrators.org/news/paperclip-2026-513-recovery-blocked-inbox-plugin-dev/
- https://openorchestrators.org/news/paperclip-2026-416-execution-policies-security/
- https://www.onorca.dev/
- https://github.com/stablyai/orca
- https://superset.sh/
- https://docs.superset.sh/
- https://docs.superset.sh/agent-status
- https://docs.superset.sh/ports
- https://docs.superset.sh/recipes/race-agents
- https://docs.superset.sh/usage
- https://docs.superset.sh/setup-teardown-scripts
- https://github.com/BloopAI/vibe-kanban
- https://vibekanban.com/docs
- https://vibekanban.com/docs/llms.txt
- https://vibekanban.com/docs/workspaces/interface.md
- https://vibekanban.com/docs/workspaces/changes.md
- https://vibekanban.com/docs/workspaces/command-bar.md
- https://vibekanban.com/docs/settings/projects-repositories.md
- https://vibekanban.com/docs/settings/agent-configurations.md
- https://vibekanban.com/docs/browser-testing.md
- https://github.com/gastownhall/gastown
- https://runfusion.ai/
- https://multica.ai/
- https://paperclip.ing/
- Shutdown facts came from a web search summary (via https://vibekanban.com/blog/shutdown and https://vibekanban.com/shutdown, which I did not open).

No local files were modified.

---

## coding-agent-uis

# Agent-orchestration UIs (2025–2026): research report for the Feature Workshop redesign

Every claim below comes from a page I fetched, except items marked **[search]**. Those come only from search-result summaries, so treat them as less certain. One page I fetched (learn.chatgpt.com/docs/app) had instructions planted in its text. I ignored them, and none of its content is used except its feature list.

---

## 1. Conductor (conductor.build): Mac app, closest analogue

**What it is.** A Mac app that runs Claude Code, Codex, Cursor and OpenCode in parallel. Each task gets its own "workspace" with a branch, files, terminal, diff and review path.

**Data model.** Project → Repository → Workspace → Branch → Working tree (a git worktree), plus the running environment: apps, servers, tests and terminals.
- Each workspace has exactly one branch, and a branch can be checked out in only one workspace at a time.
- A new branch is cut from `origin/main` after a fetch. After the first chat, the agent renames the branch to fit the task.
- A git-ignored `.context/` folder holds per-task notes.

**Standout features and UX**
- **Creating a workspace:** `Cmd+Shift+N`. You can start from a branch, a pull request, a GitHub issue or a Linear issue.
- **Scripts per repository:**
  - The setup script installs dependencies and symlinks `.env` from `$CONDUCTOR_ROOT_PATH`.
  - The run script reads `$CONDUCTOR_PORT`. Each workspace gets **10 ports** (`$CONDUCTOR_PORT` to `+9`).
  - A `nonconcurrent` mode kills other run scripts before starting, for apps that can't run twice.
  - "Multiple Run Scripts" shipped in 0.70. There are also archive scripts and hooks.
- **Spotlight testing (experimental):**
  - A file watcher makes a checkpoint commit of the workspace and checks it out in the main repo root, so a single hot-reloading dev server or fixed DB picks it up.
  - Turning it off restores the root.
  - Only one workspace can be tested at a time.
  - Docs recommend it for apps with fixed ports or DBs, or expensive builds.
- **Diff viewer (`Cmd+Shift+D`):**
  - File list, unified view, and filtering by commit.
  - Line comments become composer attachments that you send back to the agent.
  - GitHub review threads appear inline.
- **"Review" action:** an agent reviews the diff.
- **Checks tab, a merge-readiness dashboard:** git status, PR metadata, CI checks, deployments, GitHub review threads and todos. It discourages merging while todos or checks are open.
- **PR flow:**
  - `Cmd+Shift+P` creates the PR with a drafted description.
  - Conductor then suggests the next action as the workspace nears merge: respond to feedback, fix checks, merge.
- **Archive and restore:** archived workspaces move to a History pane that keeps the chat history.
- **Agent modes:**
  - Plan Mode: you approve the plan or give feedback.
  - Fast Mode, plus a thinking-level picker.
  - Codex `/goal`: a standing objective with a goal bar showing status and token budget, plus pause, resume, edit and clear.
  - Several agent tabs can share one workspace.
- **Changelog milestones:**
  - Checkpoints (0.19): one-click reset of files, git and chat to an earlier turn **[search]**.
  - Command Palette (0.14), "Insta-Summarize" (0.39), Big Terminal Mode (0.48).
  - Browser preview (0.62), HTML previews (0.55).
  - Stacks and Graphite stacks (0.80 / 0.32), Linear (0.15), multi-repo and fork workspaces (0.25.6).
  - Multiplayer early access and API (0.77), Cloud (0.78), Conductor MCP (0.82), iOS app (0.90, Oct 2026).

**Approvals and steering.** Plan approval, composer messages, and diff comments sent as attachments. The docs state plainly that a workspace is "not a security boundary".

**Parallelism.** Use separate workspaces for independent work. Share one workspace when work must land together, for example an implementer plus a reviewer agent.

**Memory and context.** Repository Settings, AGENTS.md / CLAUDE.md, and skills for lasting guidance. `.context/` and attachments for per-task context. The docs note that "Mode controls are temporary."

**Cost.** The docs I read say nothing about cost or usage display.

URLs:
- https://www.conductor.build/docs/
- https://www.conductor.build/docs/concepts/workflow
- https://www.conductor.build/docs/concepts/workspaces-and-branches
- https://www.conductor.build/docs/concepts/parallel-agents
- https://www.conductor.build/docs/concepts/agent-modes
- https://www.conductor.build/docs/reference/diff-viewer
- https://www.conductor.build/docs/reference/checks
- https://www.conductor.build/changelog
- **[search]** https://www.conductor.build/docs/reference/scripts
- **[search]** https://conductor.build/docs/reference/scripts/spotlight-testing

## 2. Claude Code Desktop (Anthropic), redesigned Apr 2026: the baseline to beat

**What it is.** The Code tab in the Claude desktop app, rebuilt for "many things in flight".

**Sessions and isolation**
- Sidebar filters by status, project or environment, and can group by project.
- Opt-in worktree per session, stored under `<root>/.claude/worktrees/`, with a configurable branch prefix.
- `Cmd`+click a second session to view two side by side.
- Side chats (`Cmd+;` or `/btw`) read the main thread's context but write nothing back.
- Claude can list, read, message, rename and archive your other sessions.

**Permission modes** (selector next to the send button): Manual, Accept edits, Plan, Auto (a background classifier checks actions), and Bypass.

**Diff review**
- A `+12 -1` stats chip opens the file-by-file diff.
- Click any line to comment, then `Cmd+Enter` submits all comments in one batch and Claude returns a new diff.
- `/code-review` produces a findings card you can step through in the diff view or send to Claude to fix.

**Preview pane**
- Configured in `.claude/launch.json` (configurations, `port`, `autoPort`, `env`).
- `autoVerify` makes Claude check its changes after each edit by taking screenshots, inspecting the DOM, and clicking or filling forms.

**PR monitoring**
- A CI status bar polls checks through `gh`.
- "Auto-fix CI", "Auto-merge when ready" (squash), and auto-archive when the PR merges or closes.

**Layout**
- Panes for chat, diff, browser, terminal, file, plan and tasks.
- Panes can be dragged into any grid, resized, or popped out into separate windows.
- `` Ctrl+` `` opens the terminal. Clicking a file path opens it for spot edits.

**Feedback and shortcuts**
- Verbose / Normal / Summary view modes.
- A usage ring next to the model picker shows per-session context use and shared plan use.
- An OS notification fires when a session you aren't viewing finishes.
- `Cmd+/` shows all shortcuts.

**Where sessions run.** Local, Cloud, SSH or WSL.

URLs:
- https://claude.com/resources/articles/claude-code-desktop-redesign
- https://code.claude.com/docs/en/desktop

## 3. Vibe Kanban: open source, web UI from `npx vibe-kanban`

**Data model**
- Organisation → Project → Issue (with sub-issues, priority, assignee, tags, and blocking / related / duplicate links).
- Issue → several Workspaces (worktree plus branch, can span repos) → several Sessions (conversations).
- Agent "profiles/variants" such as Default, Opus, Plan and Approvals, set per agent with options like `plan`, `dangerously_skip_permissions`, and Codex sandbox and approval levels.

**Board.** Columns are To do / In progress / In review / Done, with Backlog and Cancelled hidden. The issue description becomes the agent's prompt.

**Four-panel workspace UI**
- Workspace sidebar with status badges: Running, Idle, Needs Attention, Pinned, Dev Server, PR Status. It can be a flat list or grouped by status.
- Conversation panel.
- Context panel that switches between Changes, Logs (process tabs) and Preview.
- Details sidebar with git status (ahead/behind, uncommitted, conflicts), a collapsible terminal, and auto-saving notes.
- A draggable floating "Context Bar" with Open in IDE, Copy Path, Toggle Dev Server, Toggle Preview and Toggle Changes.
- Layout is saved per workspace.
- `Cmd+K` command bar, where every action, including view options, is a command.

**Changes panel**
- Unified or side-by-side view, ignore-whitespace, wrap.
- Inline comments that the agent picks up on your next message. Comments are not sent by themselves, which adds a step.
- GitHub PR comments can be toggled inline, with a comment count per file.

**Preview browser**
- Auto-detects the dev server URL from its logs.
- Desktop, mobile (390×844) and responsive device modes.
- **"Select element as context":** click a component and its details (React, Vue, Svelte, Astro or plain HTML) go into the chat.
- Eruda devtools inside the iframe.

**Git**
- PR dialog with an AI-written description and a draft toggle.
- "Merge" pulls the target branch into the working branch. Rebase is also available.
- A conflict dialog with continue and abort.

**Notifications.** Sounds for complete, needs-attention and error, plus browser push notifications. Branch prefix setting (e.g. `vk/1a2b-implement-auth`).

**Templates.** "Tags" are reusable prompt snippets inserted with @mentions.

**MCP server.** Exposes `create_issue`, `start_workspace`, `run_session_prompt`, `get_execution`, and others, so a planning agent can break a plan into issues and launch a worker on each. This is the same pattern as the Foreman dispatching workers.

**Team.** Cloud version with organisations, members and real-time collaboration, and it can be self-hosted.

URLs:
- https://www.vibekanban.com/docs
- https://vibekanban.com/docs/llms.txt
- https://vibekanban.com/docs/workspaces/interface.md
- https://vibekanban.com/docs/workspaces/changes.md
- https://vibekanban.com/docs/workspaces/git-operations.md
- https://vibekanban.com/docs/browser-testing.md
- https://vibekanban.com/docs/settings/general.md
- https://vibekanban.com/docs/settings/agent-configurations.md
- https://vibekanban.com/docs/issue-management.md
- https://vibekanban.com/docs/integrations/vibe-kanban-mcp-server.md

## 4. Claude Squad: terminal UI (TUI), tmux plus worktrees

**Model.** An instance is a tmux session plus a worktree and branch. Profiles map a name to a launch command, e.g. claude, codex or aider.

**UI.** Session list with **preview / diff** tabs (`tab` switches) and a menu bar at the bottom.

**Keys**
- `n` / `N` (new, or new with a prompt), `D` (kill).
- `↵` or `o` attaches, `ctrl-q` detaches.
- `c` commits and pauses ("checkout"), `r` resumes, `s` commits and pushes.
- `?` shows help.

**Autonomy.** `-y` / `--autoyes` is an experimental mode that auto-accepts everything.

**Takeaway.** Very fast and keyboard-first, but no gating beyond attaching and watching, and no preview.

URL: https://github.com/smtg-ai/claude-squad

## 5. Crystal → Nimbalyst

- **Crystal was deprecated in Feb 2026** and replaced by Nimbalyst.
- **Nimbalyst** is a desktop and iOS app.
  - A Session Kanban groups sessions by phase: backlog, planning, implementing, complete.
  - Worktrees are optional per session.
  - A "File Edits Sidebar" lists changed files and can write AI commit messages.
  - Every AI edit is a diff you can approve, reject or edit.
  - Rich editors (markdown, mockups, Excalidraw, Mermaid, data models) that agents edit in place.
  - Extensions, a Teams beta with shared plans and chat, and an iOS app.

URLs: https://github.com/stravu/crystal and https://nimbalyst.com

## 6. Sculptor (Imbue)

- Desktop app with workspace, agent and harness concepts (Claude Code, Pi, any terminal agent).
- `Cmd+K` palette, a terminal scoped to the workspace, and bundled workflow skills (e.g. `/sculptor-workflow:fix-bug`: reproduction interview → failing test → fix).
- You can add a second agent to an existing workspace.
- **Pairing Mode** (from search results only) mirrors the agent's container into your local checkout and editor, stashing your local changes first. It is disabled if you have uncommitted changes.
- The other way back is the "Merge Review UI".

URLs:
- https://github.com/imbue-ai/sculptor
- **[search]** https://docs.imbue.com/features/pairing-mode
- **[search]** https://docs.imbue.com/features/containers

## 7. Terragon: cloud background agents (shut down)

- Cloud sandboxes per task, with each task's work checkpointed and pushed as AI-written commits and PRs.
- `terry` CLI to take a task over locally, an MCP server, and automations triggered by schedule, issue or PR.
- @mention from Slack or GitHub, live web progress, and browser notifications.
- **Shut down on Jan 16, 2026**, leaving a read-only repo.

URL: https://github.com/terragon-labs/terragon-oss

## 8. Cursor 3 Agents Window (GA Apr 2, 2026)

- One sidebar lists local and cloud agents across repos. Agents started from mobile, web, Slack, GitHub or Linear appear there too.
- Agents move between cloud and local in both directions.
- `/in-cloud` hands a task to a cloud subagent, and `/autopilot` puts a PR on autopilot.
- New diffs view where you stage, commit and manage PRs. Built-in browser that agents can drive.
- Cloud agents with computer use (Feb 2026) attach video, screenshot and log artifacts to PRs.
  - Per the forum (search results), attaching these to PRs is unreliable; one user reports broken mp4 files.
- `/best-of-n sonnet, gpt, composer …` (search results) runs one task on several models, each in its own worktree. A parent agent comments on the results and can merge parts of them. Users call it a niche feature, and it was broken in the new UI at 3.0.4.

URLs:
- https://cursor.com/docs/agent/agents-window
- https://cursor.com/blog/cursor-3
- **[search]** https://forum.cursor.com/t/cursor-3-worktrees-best-of-n/156507
- **[search]** https://forum.cursor.com/t/cursor-cloud-agents-do-not-post-their-screenshots-or-videos-to-pr/152974

## 9. OpenAI Codex app

**Review pane scopes:** Unstaged (the default), Staged, Commit, **Branch**, and **Last turn** (the agent's most recent changes).
- Stage, unstage or revert per hunk, per file, or all at once.
- Inline "+" comments, followed by a message such as "Address the inline comments and keep the scope minimal."
- `/review` against the base branch or against uncommitted changes. It can run "Detached" in a separate chat.
- Review instructions are set through a gear icon.

**Other features.** Local and worktree modes, scheduled tasks, notifications, mobile approvals, and voice.

URLs:
- https://learn.chatgpt.com/docs/code-review.md?surface=app
- https://learn.chatgpt.com/docs/features.md
- https://learn.chatgpt.com/docs/app

## 10. GitHub Copilot coding agent / Agent HQ / Mission Control

- A "mission control" page to assign, steer and track tasks across repos, with session logs next to Overview and Files changed.
- **Steering is applied after the current tool call finishes.** You steer through the chat or through comments in Files changed.
- Each commit links to its session log. In 2026 a repo-level Agents tab added grouping of similar tool calls.
- **Limits:** one repo, one branch, a 59-minute cap per session, and each steering message costs a premium request.
- **Enterprise controls:** a control plane for allowed agents and models, plus a metrics dashboard.
- The blog post lists signs an agent is drifting: repeated failures, out-of-scope files or shared config edits, unrequested refactors, retrying the same failing approach. Its advice is to stop and restart rather than over-steer.
- **Its review order:** session logs, then files changed, then checks.

URLs:
- https://github.blog/news-insights/company-news/welcome-home-agents/
- https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
- https://github.blog/ai-and-ml/github-copilot/how-to-orchestrate-agents-using-mission-control/
- **[search]** https://github.blog/changelog/2025-10-28-a-mission-control-to-assign-steer-and-track-copilot-coding-agent-tasks/

## 11. Devin (Cognition)

**Session tools**
- A **Progress** tab merges shell commands, edits and browser steps into one timeline, and you can click any step.
- Shell list where clicking a command jumps to that point in the session.
- VS Code IDE, a "Computer" browser you can take over (for CAPTCHAs and MFA), and `/btw` side chats.

**Interactive Planning.** Within seconds you get the relevant files, findings and a draft plan, which you edit before autonomous work starts.

**Devin Review**
- Groups the diff by logical relation instead of alphabetical file order.
- Shows moved or copied code as a move or copy.
- A "Bug Catcher" labels findings by confidence and severity.
- Codebase-aware chat about the PR, and autofix until CI is green.
- Open it by changing `github.com` to `devinreview.com` in any PR URL.
- Cognition's own lesson: "the bottleneck shifted from writing code to reviewing it."

**Takeover.** Pause the session, edit, then tell Devin what you changed. Budgets are ACU limits per user and per org, and sessions sleep at the limit.

URLs:
- https://docs.devin.ai/work-with-devin/devin-session-tools
- https://cognition.com/blog/devin-2
- https://cognition.com/blog/how-cognition-uses-devin-to-build-devin
- **[search]** https://docs.devin.ai/de/enterprise/features/usage-policies

## 12. Factory Missions: architecturally closest to the Foreman

**Flow.** `/missions` → a clarifying conversation → a plan of features grouped into **milestones** → you approve → **Mission Control** view. The orchestrator is an agent you can pause and talk to in plain language.

**Roles**
- The orchestrator writes a `validation-contract.md` of assertions such as `VAL-AUTH-001`, each with a test tool and evidence required.
- `features.json` (each feature claims the assertions it will satisfy), `services.yaml`, AGENTS.md, and a knowledge library that grows through the mission.
- Workers each get a fresh context and one feature, and write tests first.
- **Scrutiny validators** and **user-testing validators** (black-box) report issues but don't fix them.
- Each milestone ends with a validation round. On a blocker, the orchestrator halts and hands control to the user.

**Cost data from a 16.5-hour Slack-clone run:**
- **778.5M tokens** in total, most of it cache reads.
- Time split: implementation 60%, validation 37%, orchestration 2%.
- 21 fix features against 61 implementation features.

Missions are a research preview.

URLs:
- https://docs.factory.com/cli/getting-started/overview
- https://docs.factory.com/missions/overview
- https://factory.com/news/missions-architecture

## 13. OpenHands

- GUI tabs: Chat, Changes, VS Code, Terminal (shared by you and the agent), App (the running server), and Browser (view-only).
- SDK confirmation policies, `AlwaysConfirm` and `ConfirmRisky`, use per-action risk levels from a security analyzer (search results only).

URLs:
- https://docs.openhands.dev/openhands/usage/key-features
- **[search]** https://docs.openhands.dev/sdk/api-reference/openhands.sdk.security

## 14. Warp agents

- **Three notification types:** Complete, **Request** (blocked on an approval or input) and Error.
- Corner toasts, at most 2, pause on hover and jump to the session when clicked.
- A **notification mailbox** (bell icon) with All / Unread / Errors filters, fully keyboard driven (`↑↓`, `Enter`, `Shift+Tab`, `Esc`).
- Per-tab state icons (working, blocked, completed, errored) plus an unread badge.
- OS notifications when Warp is in the background.

URL: https://docs.warp.dev/agents/capabilities/agent-notifications/

## 15. Workload and attention guidance

- **agentpatterns.ai:**
  - Cap at about 4–5 low-touch agents plus 3–5 high-touch sessions.
  - Sort each task as fully delegated, checkpoint-gated, or human-only.
  - Fully delegated output goes to a "review later" queue.
- **Superset:**
  - Merge accepted branches one at a time and rerun checks after each, since branches that pass alone can fail together.
  - Give each workspace its own ports and test data.
  - Stop the dev server before removing the worktree.
- **HN** (search results): some people top out at 2 parallel sessions, others run 5–10 small tasks and merge them serially.

URLs:
- https://agentpatterns.ai/human/attention-management-parallel-agents/
- https://superset.sh/blog/parallel-coding-agents-guide
- **[search]** https://hn.nuxt.dev/item/47573483

---

## Patterns across products

- **Worktrees:**
  - Every product uses one worktree plus one branch per task, and renames the branch automatically after the first message.
  - Per-repo setup, run and archive scripts, with injected env (root path, port range).
  - Two answers to "I can only run one dev server or DB":
    - **port ranges per worktree** (Conductor, Claude Code `autoPort`)
    - **mirroring into the root checkout** (Conductor Spotlight, Sculptor Pairing).
- **Diff review:**
  - Scope switcher (last turn / uncommitted / branch / commit).
  - Hunk-level stage and revert.
  - Line comments collected in a batch and sent to the agent as structured feedback.
  - An agent-review findings card.
  - GitHub threads inline.
  - Grouping by logic, with move detection (Devin).
- **Approvals:** permission-mode selector (manual → accept-edits → plan → auto/classifier → bypass), plan approval before code, and approval requests that also show as notifications.
- **Preview:**
  - An embedded browser that auto-detects the dev URL, device modes, and element-to-chat context.
  - The agent verifies its own work against the browser.
  - Video and screenshot artifacts.
- **Merge:** a Checks / merge-readiness tab, PR draft, CI polling, auto-fix CI, auto-merge, and auto-archive on merge.
- **Notifications:** three kinds (done, needs you, error), toasts plus a mailbox plus OS alerts, and a status icon on every list row.
- **Keyboard:** `Cmd+K` palette as the place every action lives, `Cmd+Shift+N` / `D` / `P` for new, diff and PR, and `Cmd+/` for the shortcut list.
- **Cost:** usage ring (context plus plan), goal or token budget bars, ACU caps per user and org. Real per-job cost display is rare.
- **Observability:** a single timeline of commands, edits and browser steps, commits linked to session logs, verbosity modes, and grouping of similar tool calls.
- **Memory:** AGENTS.md / CLAUDE.md and skills for lasting rules, a per-task `.context/` folder, auto-generated wikis, and mission knowledge libraries.
- **Team:** multiplayer and shared workspaces (Conductor, Vibe Kanban Cloud, Nimbalyst Teams), mobile apps everywhere, and Slack, Linear and GitHub @mentions to start work.

## Things to avoid

- **Inline comments that don't send by themselves** (Vibe Kanban, Codex). This is an extra step; Claude Code's batch-submit with `Cmd+Enter` is better.
- **Global auto-yes** (Claude Squad `-y`, bypass modes). Rules plus a risk classifier are safer.
- **Diffs as one long alphabetical wall** of files. Review is the bottleneck.
- **Promising video or screenshot proof that attaches unreliably** (Cursor forum).
- **Best-of-N as a headline feature.** Users see it as niche and it costs N times as much.
- **Hard caps that stop work midway:** Copilot's 59-minute limit, Devin sleeping on limits and leaving work unfinished.
- **Charging per steering message** (Copilot). It discourages steering early.
- **Cloud-only, sandbox-heavy architecture.** Terragon shut down; staying local fits a single developer better.
- **Unbounded validation loops.** Factory's run used 778M tokens. Validation needs budgets and visible cost.
- **Spotlight's limit of one workspace testing at a time**, unless that is clearly shown.
- **Encouraging more parallel jobs than one person can review.**

## Ideas worth stealing for Feature Workshop

1. **A three-way notification system (Done / Needs you / Error), plus toasts, a keyboard-driven mailbox and OS alerts (Warp).** Approval cards are the job's hot path, so "needs you" must be impossible to miss.
2. **A status glyph on every job row (working, blocked on approval, paused at usage limit, done, error) and grouping by status (Vibe Kanban).** You can triage all jobs at a glance.
3. **Review-pane scope switcher: This stage / Last turn / Uncommitted / Whole branch, with hunk-level stage and revert (Codex).** It matches the Foreman's stages: review what the implement stage changed, not only the full branch.
4. **Click-to-comment on diff lines, batch-sent with `Cmd+Enter` to the Foreman as structured feedback (Claude Code Desktop).** Feedback is precise, with no extra "please address comments" message.
5. **Agent review results as a findings card you step through in the diff, each with "send to fix" (Claude Code `/code-review`, Devin Bug Catcher confidence labels).** It turns the review stage into actionable items rather than prose.
6. **Diff grouped by logical change, with move detection (Devin Review).** Large PRs become reviewable, and review is the real bottleneck.
7. **A Checks / merge-readiness tab covering git status, PR, CI, review threads, open todos and unanswered Foreman questions (Conductor).** One place answers "can I ship this job?"
8. **Ten-port range plus root-path env injected per worktree, with setup, run and archive scripts per repo (Conductor).** Testing jobs side by side without port or `.env` clashes.
9. **A "Spotlight" fallback that mirrors one job's worktree into the main checkout for apps tied to one port or DB (Conductor, Sculptor Pairing).** It fits the existing DB-switch feature, as long as only one job uses it at a time and the UI says so clearly.
10. **Preview that auto-detects the dev URL, has device-size modes, an element picker that sends the component to the chat, and devtools in the iframe (Vibe Kanban).** Pointing at UI beats describing it.
11. **Agent self-check in the preview pane (`autoVerify`) with screenshots saved as job artifacts (Claude Code, Cursor).** The test stage leaves visible proof in the preview pane.
12. **A validation contract for each job: numbered acceptance checks from the spec stage, each tied to the evidence required (Factory Missions).** It gives the test and review stages a clear pass/fail list that you can see.
13. **Structured worker handoff reports (done, remaining, commands with exit codes, issues) shown as cards in the Foreman thread (Factory).** You can see what each worker did without reading logs.
14. **One timeline per job merging Foreman messages, worker dispatches, commands, edits and approvals; every step clickable; similar tool calls grouped; Normal / Summary / Verbose toggle (Devin Progress, GitHub, Claude Code).** One place to see what happened.
15. **Interactive plan editing: the plan stage shows files found and a draft plan you edit inline before approving (Devin, Conductor Plan Mode, Copilot Plan Mode).** You steer while it is cheapest.
16. **Side chats (`/btw`, `Cmd+;`) that ask the Foreman about a job without disturbing its main thread (Claude Code, Devin).** Questions without derailing the job.
17. **Steering applied after the current tool call, with a visible "queued message" chip (Copilot).** The behavior is predictable and safe while a job is running.
18. **Drift warnings: flag out-of-scope files, edits to shared config (e.g. scope helpers), and repeated identical failures (GitHub's drift signals).** Catches the expensive mistakes early. For the Moxie repo, flag edits outside the brief.
19. **Checkpoints that restore files, git and chat to any earlier turn or stage in one click (Conductor).** Retrying a stage becomes cheap and safe.
20. **A per-job usage ring plus token and cost per stage; usage-limit pause shown with a countdown to reset (Claude Code usage ring, Codex goal budget bar).** Builds on the existing pause and resume feature and makes cost visible.
21. **PR monitoring with CI status, "auto-fix CI", optional auto-merge, and auto-archive of the job when its PR merges (Claude Code Desktop).** Completes the PR stage, and "mark done" happens by itself.
22. **Archive with History that keeps the full Foreman transcript, and restores (Conductor).** Keeps the jobs list focused without losing anything.
23. **Start a job from a GitHub issue, a Linear issue, an existing branch or PR, or past Claude Code sessions (Conductor).** Generalizes the existing "from past sessions" entry point.
24. **`Cmd+K` palette where every action and view toggle is a command, plus `Cmd+/` cheat sheet and fixed chords (`Cmd+Shift+N` new job, `D` diff, `P` PR) (Conductor, Vibe Kanban, Claude Code).** Keyboard-first design that people already know.
25. **Per-job pane layout memory, pop-out panes, Cmd+click a second job for side-by-side (Vibe Kanban, Claude Code).** Lets you compare jobs or keep the preview on a second monitor.
26. **A floating context bar per job: Open in iTerm / VS Code / Finder, Copy path, Toggle dev server, Toggle preview (Vibe Kanban).** One-click exits to your own tools.
27. **A "review later" inbox for finished delegated jobs, separate from "needs approval now", plus a soft cap on active jobs (agentpatterns.ai).** Protects your attention.
28. **Serial merge helper: merge accepted jobs one at a time, re-running checks after each, and warn when two jobs touch the same files (Superset guidance).** Branches that pass alone can still fail together.
29. **An MCP or tool surface so the Foreman can create sub-jobs and read board state (Vibe Kanban MCP, Conductor MCP).** Large features split into tracked child jobs.
30. **Reusable prompt snippets inserted with @mention, plus saved job templates bundling flow size, skipped stages, reviewers and Fable checks (Vibe Kanban tags, agent variants).** Starting a job takes one keystroke.
31. **Fun touch: a branch auto-named by the agent after the first message, with a small "naming…" animation; also sounds for done, needs-you and error (Conductor, Vibe Kanban).** Light delight that doesn't add noise.
32. **Phone or remote approvals later (Conductor iOS, Codex mobile, Nimbalyst iOS, Copilot Mobile).** Approval gates shouldn't block jobs while you're away from your desk.

---

## design

# Feature Workshop redesign: design research and buildable recommendations (React/TS/Vite + CSS)

## 1. What the reference tools have in common

These are the patterns that keep coming up across the sources, with where each one comes from:

- **Content first, chrome dimmed.** Linear dimmed its sidebar "a few notches", muted inactive nav text, reduced separators and icons, and removed colored icon backgrounds. Its rules are "Don't compete for attention you haven't earned" and "Structure should be felt not seen". (linear.app/now/behind-the-latest-design-refresh)
- **Themes generated from a few inputs.** Linear replaced 98 hand-tuned variables with three: base, accent and contrast. They are generated in LCH, a color space where the same lightness number looks equally bright across hues, and a contrast knob gives high-contrast accessible themes for free. Linear also limited blue and moved toward warmer, less saturated grays, stopping short of "muddy". Headings use Inter Display and body text uses Inter. (linear.app/now/how-we-redesigned-the-linear-ui)
- **Semantic step scales.** Both Radix and Vercel Geist give every color a numbered scale where each step has a job: app background, subtle surface, component background with hover and active, three border strengths, solid fill and solid hover, then secondary and primary text. Radix guarantees APCA contrast of Lc 60 and Lc 90 for its two text steps. Geist's advice: use alpha grays only for overlays and shadows, draw each border once, keep shadows translucent. (radix-ui.com/colors/docs/palette-composition/understanding-the-scale, vercel.com/geist/colors)
- **One bottom action bar that teaches shortcuts.** Raycast moved actions into a bottom bar. The left side shows the context title and toasts. The right side shows the available actions, each with its key hint, so users learn shortcuts by seeing them. It also offers a compact mode. (raycast.com/blog/a-fresh-look-and-feel)
- **Command palette everywhere.** Linear uses Cmd+K for actions on the current selection, `/` for search, `g`-then-letter to navigate and `?` for shortcut help. That comes from linear.app/docs plus third-party pages; confirm the exact current bindings in the app.
- **Units of work as blocks.** Warp groups each command with its output into a Block you can copy, rerun, share, bookmark and jump to. (docs.warp.dev/terminal/blocks)
- **Inline permission cards with escape hatches.** In Warp:
  - Cards offer Approve, Reject, or **Other**, which sends guidance to the agent instead of answering yes or no.
  - **E** edits a command before you approve it, and Esc leaves the editor without rejecting.
  - **E** on a file-edits card expands or collapses all diffs.
  - Allowlist and denylist patterns are supported, and team denylist rules can never be bypassed.
  - Auto-approve lasts for one conversation and shows a `▶▶` marker in the status line.
  (docs.warp.dev/agents/cli/permissions-and-profiles/)
- **Review and undo built into the flow.** In Zed:
  - The agent panel shows a count of edited files and lines.
  - "Review Changes" opens all edits in one combined tab where you keep or reject each hunk or all of them.
  - A "Restore Checkpoint" button on each message rolls the code back to before that message.
  - Optional OS notifications and a sound fire when the agent finishes or is waiting.
  (zed.dev/docs/ai/agent-panel)
- **Stop at any time.** Cursor streams a live diff and lets you stop it (Cmd+Shift+Backspace) and redirect mid-run. A "Find Issues" review pass runs on demand. (cursor.com/docs/agent/review)
- **Speed is part of the feel.** Zed's "game-like" 120fps GPU rendering is reported only by secondary sources (tooliverse.ai/tools/zed, vantaige.io/ai-tool/zed-ai). The takeaway for us: no animation on frequent, keyboard-driven actions; render instantly; update optimistically.
- **Contextual spaces and a vertical sidebar.** Arc's patterns (vertical sidebar, per-context Spaces with their own themes, Cmd+T command bar) come from secondary sources only (blakecrosley.com/blog/design-study-arc, supasidebar.com/blog/what-is-arc-browser-sidebar-2026). The useful idea: give each job a subtle identity color or emoji.

## 2. Layout

- **Three resizable panes** (`react-resizable-panels`), sizes saved per user:
  - **Left, Jobs, 240–280px, dimmed.** Grouped as Needs you, Running, Paused (usage limit), Idle, Done (collapsed). Each row shows a status dot, the title, a stage chip and a relative time. Collapses to a 48px icon rail with `[`.
  - **Center, Foreman thread, flexible, max text width about 760px.**
    - Messages and worker activity appear as collapsible "blocks", Warp-style: worker name, stage, duration and result, expandable to the full log.
    - Approval cards, questions and briefs sit inline.
    - The composer is pinned at the bottom: Cmd+Enter sends, Enter adds a newline, and a slash menu lists commands.
  - **Right, Preview, 40% by default.** Tabs: App (iframe of the worktree's dev server on its port), Diff, Tests, Terminal, Logs. Its header row has the URL or port, DB switch, Restart and "Open in…" (iTerm, Terminal, VS Code, Chrome). Toggle the pane with `\`. Cmd+Shift+Enter maximizes it.
- **Top bar, 40px.** Job breadcrumb (job › stage), a stage stepper (spec → investigate → plan → implement → test → review → PR) with the current step lit, a usage meter, and a Cmd+K hint.
- **Bottom status and action bar, 32px.** Raycast pattern:
  - Left: the current context and in-window toasts.
  - Right: context actions with `<kbd>` hints, e.g. `A Allow · D Deny · E Edit · ⌘↵ Send`.
  - Show the auto-allow state as a `▶▶ Auto` badge, as Warp does.
- **Density.** 13px base UI text, 32px list rows, 4px spacing grid. Offer a Comfortable/Compact toggle.
- **iframe caveat.** Embedding the app preview will hit `X-Frame-Options` and cookie `SameSite` problems with auth flows. Keep "Open in Chrome" one keystroke away, and consider a small proxy so the dev server can be framed.

## 3. Tokens (CSS custom properties; dark first, light from the same generator)

Generate both themes from three inputs (`--base-hue`, `--accent-hue`, `--contrast`) with `oklch()` in CSS. LCH and OKLCH are the perceptually even spaces Linear moved to.

```css
:root {
  color-scheme: dark;
  /* neutrals: warm-ish, low chroma */
  --bg-1: oklch(0.16 0.006 260);   /* app */
  --bg-2: oklch(0.19 0.006 260);   /* panes / cards */
  --bg-3: oklch(0.22 0.007 260);   /* component rest */
  --bg-4: oklch(0.25 0.008 260);   /* hover */
  --bg-5: oklch(0.28 0.009 260);   /* active / selected */
  --border-1: oklch(1 0 0 / 0.06); /* separators */
  --border-2: oklch(1 0 0 / 0.10); /* interactive */
  --border-3: oklch(1 0 0 / 0.18); /* strong / focus base */
  --text-2: oklch(0.72 0.01 260);  /* secondary, aim APCA Lc>=60 */
  --text-1: oklch(0.95 0.005 260); /* primary, aim Lc>=90 */
  --accent: oklch(0.70 0.15 275);  /* one accent (indigo/violet) */
  --accent-hover: oklch(0.75 0.15 275);
  /* status (always paired with icon + label) */
  --ok: oklch(0.75 0.15 155); --warn: oklch(0.80 0.14 80);
  --err: oklch(0.68 0.19 25);  --info: oklch(0.72 0.12 235);
  --running: var(--accent); --paused: oklch(0.70 0.02 260);
  /* type */
  --font-ui: "InterVariable", system-ui, sans-serif;
  --font-display: "Inter Display", var(--font-ui);
  --font-mono: "Geist Mono", "JetBrains Mono", ui-monospace, monospace;
  --fs-11: 11px; --fs-12: 12px; --fs-13: 13px; --fs-15: 15px; --fs-20: 20px; --fs-28: 28px;
  /* space/radius/shadow */
  --sp: 4px; /* use multiples: 4 8 12 16 24 32 */
  --r-sm: 4px; --r-md: 6px; --r-lg: 10px; --r-xl: 14px; /* child radius <= parent */
  --shadow-pop: 0 1px 0 oklch(1 0 0 / .04) inset, 0 8px 24px oklch(0 0 0 / .35), 0 2px 6px oklch(0 0 0 / .25);
  /* motion */
  --ease-out: cubic-bezier(.23, 1, .32, 1);
  --ease-in-out: cubic-bezier(.77, 0, .175, 1);
  --dur-1: 120ms; --dur-2: 180ms; --dur-3: 240ms;
}
body { font: 400 var(--fs-13)/1.45 var(--font-ui); font-feature-settings: "cv11", "ss01"; }
.num, time, .meter { font-variant-numeric: tabular-nums; }
```

The Inter feature tags (`tnum`, `cv11`, `ss01`, `zero`, `case`) are listed at rsms.me/inter. The two-layer shadows, combined borders and shadows, concentric radii, `color-scheme: dark` and `theme-color` meta all follow vercel.com/design/guidelines.

Exact oklch values like these must be generated and then checked against APCA targets in a script.

## 4. Component inventory

**Building blocks**

| Need | Library |
|---|---|
| Accessible unstyled components (Dialog, Popover, DropdownMenu, Tooltip, Tabs, ToggleGroup, ScrollArea, ContextMenu) | Radix Primitives |
| Command palette | `cmdk` |
| Toasts | `sonner` |
| Resizable panes | `react-resizable-panels` |
| Terminal | `@xterm/xterm` + fit addon |
| Diffs | Monaco DiffEditor, or a lighter `react-diff-view` / `@pierre/diffs`-style renderer |
| Icons | `lucide-react` at 16px, 1.5 stroke |
| List virtualization | `@tanstack/react-virtual` |

cmdk details: parts are styled through `[cmdk-*]` data attributes, nested pages work as a page stack (Backspace on an empty query goes back), and it handles about 2–3k items without virtualization (github.com/pacocoursey/cmdk). Sonner details: promise toasts, action toasts, six positions (sonner.emilkowal.ski).

**App components**

- `AppShell`, `TopBar`, `StatusBar`/`ActionBar`, `PaneLayout`
- `JobList`, `JobRow`, `JobGroupHeader`, `StatusDot`, `StageChip`, `StageStepper`, `UsageMeter` (with a reset countdown)
- `Thread`, `MessageBubble` (Foreman/user), `WorkerBlock` (collapsible: header, streaming log, result), `ToolCallLine`
- `ApprovalCard`:
  - Variants: command, file-edit, plan, question, brief, gate.
  - Keys: A Allow, Shift+A "Always allow this pattern", D Deny, E Edit, O Other (reply with guidance), X expand diffs.
  - It shows the rule that would auto-allow it next time and a risk tag ("writes outside worktree", "network", "git push").
- `QuestionCard` (choices plus free text), `BriefCard` (summary with expand), `CheckpointMarker` (Restore)
- `Composer` (slash commands, @-mention files/jobs/sessions, attachments)
- `PreviewPane`, `AppFrame` (URL bar, reload, device-width toggle), `DiffView` (file tree + hunks, keep/reject per hunk), `TestRunPanel` (pass/fail tree, rerun failed), `TerminalTab`, `OpenInMenu`
- `CommandPalette`, `ShortcutSheet` (`?`), `NewJobDialog` (flow: quick/small/large; skip-stage toggles; reviewer picker; Fable checks; "from past session" picker)
- `EmptyState`, `Skeleton`, `Kbd`, `Badge`, `Toast`, `ConfirmPopover`, `SettingsDrawer` (auto-allow rules editor)

## 5. Status indicators

- **Job dot plus label, never color alone** (a Vercel guideline):

  | State | Look |
  |---|---|
  | Needs you | Accent, slow 2s pulse |
  | Running | Animated ring spinner, 12px |
  | Paused (usage limit) | Hollow gray dot with a countdown, "resumes 3:42pm" |
  | Blocked/error | Red, with an icon |
  | Done | Green check |
  | Idle | Gray |

- "Needs you" count in three places: on the window title (`(2) Feature Workshop`), as a favicon badge, and as an optional OS notification and soft sound when a gate opens or a job finishes. Zed does the same, with a setting to turn it off.
- Stage stepper: done steps are filled, the current step has an accent underline, skipped steps are dashed.
- Usage meter: a thin bar in the top bar. At 80% it turns amber with a tooltip. When paused, the bar shows the reset time.

## 6. Motion rules

Sources: emilkowal.ski/ui/great-animations, rauno.me/craft/interaction-design, vercel.com/design/guidelines.

1. Animate only `transform` and `opacity`. Never use `transition: all`.
2. Durations: 120ms for hover and press, 180ms for popovers, menus and toasts, 240ms for panes and dialogs. Keep everything under 300ms. Use ease-out for things entering, a shorter ease-in for exits, and ease-in-out only for on-screen movement.
3. No animation on high-frequency keyboard actions: opening the palette, j/k moving through the list, switching tabs. That speed is the "Zed feel".
4. Scale from the trigger: set `transform-origin` toward the button (Radix exposes `--radix-popover-content-transform-origin`). Popovers and menus enter from `scale(.96)`, never from 0.
5. All motion must be interruptible. Use CSS transitions rather than keyframes for state changes.
6. Spinners and skeletons wait about 150–300ms before appearing, then stay at least about 300–500ms so they don't flicker.
7. Use View Transitions (`document.startViewTransition`, `view-transition-name`) for job switching and preview maximize, with a feature check (developer.mozilla.org/en-US/docs/Web/API/View_Transition_API).
8. Under `prefers-reduced-motion: reduce`, replace movement with opacity fades and stop the pulses (the "Needs you" dot becomes a static ring).
9. Save delight motion for rare moments only: PR opened, job done, first green test run.

## 7. Keyboard map

- **Global:**
  - `⌘K` palette (jobs, actions, settings, past sessions)
  - `?` shortcut sheet, `/` focus composer or search, `⌘N` new job, `⌘1/2/3` focus pane
  - `[` collapse jobs, `\` toggle preview, `⌘⇧Enter` maximize preview
- **Navigation (g-chords, 1s window):** `g n` jump to the next job that needs you, `g r` running, `g d` done, `g s` settings.
- **Lists:** `j/k` or arrows, Enter opens, `x` select, `e` mark done (with Undo toast), `p` pause/resume.
- **Approvals:** `a` allow, `⇧a` always allow, `d` deny, `e` edit, `o` reply with guidance, `n` next pending approval anywhere.
- **Preview:** `t` terminal, `v` diff, `b` browser, `⌘R` reload app, `⌘⇧O` "Open in…".
- **Rules:**
  - Show `<kbd>` hints in tooltips, menu rows and the action bar. That is how Raycast teaches shortcuts.
  - Single-letter keys are ignored while focus is in a text field.
  - Show platform-specific symbols and support non-QWERTY layouts by matching `event.key` and falling back to `event.code`.

## 8. Toasts, approvals and destructive actions

- Use toasts only for things that already happened ("Job marked done – Undo", "Dev server ready on :3104 – Open"). Put them in the status bar or bottom-right, auto-dismiss after 5s, pause on hover, and announce them through `aria-live="polite"`.
- Anything that needs a decision is an inline card in the thread, never a toast. Mirror pending cards in a "Needs you" tray (`g n`). Carbon's guidance agrees: actionable messages persist until handled, and toast content must be findable elsewhere (carbondesignsystem.com/components/notification/usage/).
- Destructive actions (Deny-and-stop, discard worktree, force push): a confirm popover or a 5–8s Undo window.
- Every auto-allowed tool call appears as a dim one-line `ToolCallLine` ("auto-allowed by rule `npm test*`") with a link that opens the rule. That keeps auto-allow transparent.

## 9. Empty states

Every empty state offers one primary action and a shortcut hint. No illustrations heavier than a small monochrome line icon.

- **No jobs:** "Start a job" button, "or ⌘N", plus a "Resume from a past Claude Code session" link listing the 3 most recent sessions.
- **Preview with no dev server:** "Start dev server on :31xx" and a DB selector.
- **Diff empty:** "No changes yet in this worktree."
- **All caught up:** "Nothing needs you. 3 jobs running." with a quiet accent glyph.

## 10. Tasteful fun

Keep these optional, quiet and rare.

- Confetti on PR opened or job done, once per job. Use a canvas burst from the button's position that is short (under 1.2s), never takes focus, and is skipped under reduced motion. Raycast's confetti command is the model; its one complaint was that it steals focus (unsung.aresluna.org/raycasts-confetti-cannon/, raycast.com/changelog/windows).
- Animate the Foreman's avatar (a small orbit or conductor glyph) only while it is "thinking". Its rhythm can speed up as more workers run.
- Per-job identity hue or emoji, auto-assigned (Arc Spaces style), tinting the job's dot, stepper accent and terminal cursor.
- A soft accent glow (radial gradient behind the active pane header at 4–6% opacity) and a 1px top highlight on cards. That gives a futuristic feel without neon.
- Friendly copy at pause: "Claude's taking a breather – back at 3:42pm", with a countdown ring.
- A hidden `⌘K › "Celebrate"` command, and a "streak" of jobs shipped this week in the status bar tooltip.
- A palette footer tip that rotates each session ("Tip: press n to jump to the next approval").

## 11. Accessibility

Sources: vercel.com/design/guidelines, w3.org/WAI/ARIA/apg/patterns/combobox/, w3.org/WAI/WCAG22/Understanding/focus-appearance.html.

- A visible `:focus-visible` ring on everything: a 2px solid ring at 3:1 contrast against its surroundings, offset 2px. Sticky bars must never cover the focused element.
- Command palette follows the combobox/listbox pattern: the input has `role="combobox"` with `aria-expanded`, `aria-controls` and `aria-activedescendant`; options have `aria-selected`; Esc closes and returns focus. cmdk and Radix Dialog handle most of this.
- Focus traps in dialogs, and focus returns to the trigger on close. Approval cards are reachable by Tab and by the `n` jump.
- Status uses icon plus text plus color. Thread updates go through a polite live region. Debounce streaming text so screen readers aren't flooded: announce "Worker finished: implement – 3 files changed", not each token.
- Hit targets of at least 24px. Icon-only buttons get `aria-label`. Use real `<a>` for navigation so Cmd+click works.
- Contrast targets: APCA Lc 90 for body text and at least Lc 60 for secondary text. Run a high-contrast theme through the same generator with the contrast input raised.
- Honor `prefers-reduced-motion`, `prefers-contrast` and a manual Reduce Motion setting. Keep the UI usable at 200% zoom.

## 12. Do / don't summary

- **Do:**
  - One accent color, warm-neutral grays, dimmed navigation.
  - Monospace with tabular numbers for times, ports, costs and counts.
  - Shortcuts shown everywhere.
  - Inline approvals with an "Other" reply option.
  - Checkpoints and Undo, and optimistic updates.
- **Don't:**
  - Glassmorphism on content surfaces, more than one gradient, or colored icon backgrounds.
  - Animating list navigation or palette open.
  - Toasts for decisions, or color-only status.

## Sources

**Read directly:**
- https://linear.app/now/how-we-redesigned-the-linear-ui
- https://linear.app/now/behind-the-latest-design-refresh
- https://vercel.com/design/guidelines
- https://vercel.com/geist/colors
- https://www.raycast.com/blog/a-fresh-look-and-feel
- https://emilkowal.ski/ui/great-animations
- https://rauno.me/craft/interaction-design
- https://docs.warp.dev/terminal/blocks
- https://docs.warp.dev/agents/cli/permissions-and-profiles/
- https://zed.dev/docs/ai/agent-panel
- https://cursor.com/docs/agent/review
- https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
- https://github.com/pacocoursey/cmdk
- https://sonner.emilkowal.ski/
- https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- https://rsms.me/inter/
- https://carbondesignsystem.com/components/notification/usage/

**From search results only (secondary or unverified):**
- Linear shortcuts: https://linear.app/docs/search, https://linear.app/now/descript-internal-guide-for-using-linear, https://fastshortcuts.com/shortcuts/linear/
- Arc: https://blakecrosley.com/blog/design-study-arc, https://supasidebar.com/blog/what-is-arc-browser-sidebar-2026
- Zed 120fps claims: https://tooliverse.ai/tools/zed, https://vantaige.io/ai-tool/zed-ai, https://logicity.in/en/blog/why-zed-might-make-you-quit-vs-code-for-good
- Raycast confetti: https://unsung.aresluna.org/raycasts-confetti-cannon/, https://www.raycast.com/changelog/windows, https://www.stefanjudis.com/notes/a-raycast-confetti-shell-command/

No local files were modified.