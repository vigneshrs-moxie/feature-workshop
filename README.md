# Feature Workshop

A local dashboard for the Claude Code **feature workflow** (spec → investigate → plan → build → test → review → PRs). It shows every job in progress, which crew member (worker agent) is busy right now, what's waiting for you, and what it all costs. From the browser you can answer the Foreman's questions, approve the next stage, click Allow or Deny when a worker wants to do something, start new jobs and pause running ones.

It runs only on your computer (`127.0.0.1`) and uses your own Claude Code login.

![The board at night: headline numbers, the Foreman's to-do list, and one card per job](docs/board-night.png)

## Quick start

You need **Node.js 22+**, **git**, and **Claude Code** installed and logged in (`claude` works in your terminal).

```sh
git clone https://github.com/vigneshrs-moxie/feature-workshop.git
cd feature-workshop
npm install
```

**Try it safely first:** `npm run demo` opens the dashboard on invented jobs with a *pretend* Foreman. Every button works and nothing real runs or costs anything.

**Use it for real:** `npm start`, then open **http://127.0.0.1:4477**. Stop it with **Ctrl+C**. Stopping the dashboard pauses any reply in progress; nothing is lost.

## How it works, in one minute

- **You talk to the Foreman** (the `/feature` conductor). It hands each stage to a crew member (the worker agents) and stops after every stage so you can check it. Nothing moves on without your go-ahead.
- **The board** groups jobs by repository. Each card is one feature or bug: the path from Spec to PR 3, the crew standing at the current stage, and one plain sentence about what's happening.
  - **Red with “!”: your turn.** Answers, a go-ahead, or a permission click.
  - **Green: working.** The characters hammer, write, scan or shake their flask; a bar runs along the bottom.
  - **Grey: resting or paused. Yellow: blocked on someone else. Gold: done.**
- **The Foreman's box** at the top lists what needs you, longest wait first. Click one to open the job.

## Using it day to day

**Start a job.** Click **+ New job**, describe it in a line, pick Feature or Bug fix, the repository and the Foreman's model (Fable 5.1 is what the workflow is designed for; Opus 5.5 is cheaper; Haiku 5.5 is only for trying things out). The Foreman writes a spec first and stops for your review. You can still start jobs with `/feature …` in a terminal; they show up here too.

**Answer and approve.** Open a red card. The job page shows the Foreman's latest brief and a **Your move** panel:
- your answers to its questions, with the recommended ones already picked,
- anything it **decided on your behalf**, to Confirm, Change or leave for Later,
- **Approve and continue**, **Ask for changes** or **Stop this job**, or send any message.

Before anything is sent you see the **exact words** the Foreman will receive, and you can edit them. They're also kept in the job's activity log.

![A permission card: the Foreman wants to run a command](docs/job-permission.png)

**Permissions.** When the Foreman or a worker wants to do something that needs your OK (change a file, run a command, …), a card appears on the job page and in a tray on every other page:
- **Allow once:** it does exactly this, one time.
- **Allow for this reply:** it won't ask again for this kind of action until the current reply is finished. Handy during building, when there are many edits. It is kept in memory only.
- **Deny:** it doesn't do this and carries on without it. You can add a note saying why.

Nothing is ever saved to your Claude Code settings. Your existing settings still apply: anything you already allow in Claude Code won't ask here either. Requests with no time limit simply wait for you.

**Pause and stop.** While the Foreman works, **Pause** stops the current reply right away; send a message later and it carries on. **Stop this job** asks the Foreman to record where things stand and stop.

**Jobs that live in a terminal.** Only one place drives a Foreman at a time. If a job's session was last used in a terminal, the job page asks you to close it there (`/exit`) and then **Take over here**. To go back to the terminal later: `claude --resume <session id>` (shown on the page).

**Details on demand** (tabs on the job page): **Briefs** (every saved brief), **Files** (spec, findings, plans, reports, each review; requirement IDs like `FR-001` are clickable and show where they're defined and mentioned), **Code** (one commit per plan step, with diffs and *Open in VS Code* links), **Approvals** (the job's approval record, superseded ones marked, plus everything sent from here), **Costs** (by stage, crew member and model) and **Crew** (who worked on the job and what they did last).

**Costs.** The **Costs** page totals every job, splits it by model and by job, and shows what the Foreman's part would have cost on another model, which makes comparing setups easy. **Download CSV** or **Download report (Markdown)** to hand on. Numbers use Claude Code's own cost figure where it recorded one; otherwise they're estimates from token counts (marked ≈). Prices are listed in `dashboard/lib/cost.js`. These are estimates, not a bill.

**Alerts.** The bell turns on browser notifications and/or a soft chime for when a job needs you. They work while the page is open in a tab.

**Look.** The sun button cycles automatic, day and night. Click the clock to switch 12/24-hour time. **Crew-dex** introduces every crew member with their model.

## What it reads and what it changes

**Reads (never changes):**
- `~/.claude/feature-work/*/` — each job's `workflow-status.md`, `status.json`, `briefs/` and artifacts
- `~/.claude/projects/` — Claude Code session logs, for live activity and cost (never sent anywhere)
- `~/.claude/agents/*.md` — each worker's model and effort, for the Crew-dex
- your repositories, read-only with git (`git log`, `git show`) for the Code tab, and the spec file each job names

**Writes:** only its own small state folder, `~/.feature-workshop/`:
- `sessions.json` — which Claude Code session drives each job, and when you took one over
- `audit.jsonl` — every message sent, permission decided, pause and take-over, with the exact words

**Everything else happens through the job's Foreman session in Claude Code, and only after your click.** The Foreman may read its own instructions (`~/.claude/skills`, `~/.claude/agents`) and the jobs' folders without asking; anything that changes files or runs commands asks you. The dashboard itself never pushes, opens PRs, changes Claude Code settings or talks to anything except your local Claude Code.

## Can and can't

| It can | It can't (by design) |
|---|---|
| Show every job, who's working and what they're doing, live | Approve anything without your click |
| Send your answers, approvals and messages to a job's Foreman | Drive a session that's open in a terminal (you take it over first) |
| Start new jobs and pause or stop running ones | Change your Claude Code settings or permission rules |
| Forward every permission request as Allow / Deny | Run when your computer's Claude Code isn't logged in |
| Export costs as CSV and Markdown | Be reached from another computer |

## Security

- Listens on `127.0.0.1` only and rejects requests addressed to any other host name.
- Anything that changes something needs a secret token that only this page can read, from this page's own address, as JSON. Other websites open in your browser can't press its buttons.
- Strict content security policy: the page loads only its own files, no outside scripts or styles.
- Markdown is rendered with raw HTML switched off and unsafe links removed.
- Git is read with fixed commands and checked arguments; files are only read from inside each job's folder or the spec path the job records.

## Settings (environment variables)

| Variable | Default | What it's for |
|---|---|---|
| `PORT` | `4477` | The port to listen on |
| `WORKSHOP_FEATURES_DIR` | `~/.claude/feature-work` | Where jobs live |
| `WORKSHOP_PROJECTS_DIR` | `~/.claude/projects` | Claude Code session logs |
| `WORKSHOP_AGENTS_DIR` / `WORKSHOP_SKILLS_DIR` | `~/.claude/agents` / `~/.claude/skills` | The workflow's agents and skills |
| `WORKSHOP_STATE_DIR` | `~/.feature-workshop` | The dashboard's own state |
| `WORKSHOP_CLAUDE_PATH` | (bundled with the SDK) | Use a specific `claude` executable |
| `WORKSHOP_EXTRA_REPOS` | (none) | Extra repositories to offer in New job, separated by `:` |

## Sharing with teammates

Each person runs their own copy: clone, `npm install`, `npm start`. It uses **their** Claude Code login and shows **their** jobs and costs; nothing is shared between people, and no credentials are stored in this repo. Before rolling it out widely, check with whoever manages your Anthropic account that driving Claude Code sessions this way is fine for your plan.

Teammates also need the feature workflow itself (the `/feature` skills and `feature-*` agents). Those currently live in one person's `~/.claude` with some personal paths. The next step is to package them as a Claude Code plugin in this repo so `claude plugin install` sets them up.

## How it's built

- Plain Node.js server (`dashboard/server.js`) and a no-build front end (`dashboard/public/`).
- Two dependencies: the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) to run Foreman sessions, and `markdown-it` to render briefs and artifacts.
- `dashboard/lib/` holds the readers (workflow files, session logs, git, costs), the driver that runs replies and parks permission requests, and the message composer.
- `npm test` runs the tests (Node's built-in runner): parsers, costs and exports, Markdown safety, git, request safety, the driver with a pretend session, and the demo Foreman.

## Known limits

- **No time limits.** A worker counts as working until its log shows it finished. If a terminal session is closed mid-task, its job keeps showing as working, with a “quiet for …” note. Jobs paused or finished from the dashboard are always shown correctly.
- **Quiet ≠ stuck.** A long command and a permission prompt waiting in a terminal look the same in the logs, so the card says “maybe” and points you to the terminal.
- **Older jobs** that don't write `status.json` and `briefs/` yet show less detail (their stage and approvals come from `workflow-status.md`).
- The session log format belongs to Claude Code and may change; unknown lines are skipped.
- Notifications need the page open in a tab, and some browsers limit them.
