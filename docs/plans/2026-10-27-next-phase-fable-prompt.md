# Prompt for Fable: Feature Workshop, the next phase

You are the planning lead for the next phase of **Feature Workshop**, the tool Vignesh (Moxie Pest Control, Phoenix; works on the Orbit portal) built to run Claude Code feature and bug jobs with human gates. Your job in this chat is to **understand, ask, then plan**. Do not write code, edit files in any repository, push, open PRs, migrate databases, or install anything. You may read anything listed below, run read-only commands (`git log`, `git show`, `grep`, `ls`, reading files) and write your own notes and the final plan to `/Users/moxie/Projects/feature-workshop-phase1/docs/plans/` (new files only).

The outcome: a plan for the phase of Feature Workshop that becomes **the way Moxie handles Orbit bugs and feature requests from here on**, built on top of the Orbit **Portal Feedback** tracker and its API/MCP. It must be good enough that Vignesh can show it to his manager and then hand it out in packets to implementers.

---

## 1. How to work

1. **Read first (sections 4a and 5),** starting with the latest part of the "Orbit portal feedback follow-ups" chat. Don't ask anything the files or chats answer.
2. **Write back your understanding** in a short note: what Feature Workshop is today, what Portal Feedback is today, and the vision in your words. Separate what Vignesh said from what you're assuming. Ask him to correct it.
3. **Ask questions in rounds**, at most 5 per round, numbered, each with your recommended answer and the consequence of each option, so he can reply "1 yes, 2 b, 3 …". Start with the questions that change the architecture. Keep going until there's nothing important left that you would otherwise have to guess. Record every answer in a decision register (same style as the Portal Feedback plan's §6: id, decision, options, recommendation, decided by/when).
4. **Then write the plan** (section 7). Present it in sections and ask for a yes on each before writing the next.
5. Plain words. Short sentences. No jargon without a one-line explanation. Vignesh reads everything; his manager will read the roadmap.

---

## 2. Feature Workshop today (verify by reading)

- **Repos**
  - Dashboard + web UI: `~/Projects/feature-workshop` (main checkout) and the worktree `~/Projects/feature-workshop-phase1` on branch `redesign/orbit-ready` (pushed to `origin` = `github.com/vigneshrs-moxie/feature-workshop`). Node server `dashboard/server.js` + `dashboard/lib/*`; React/Vite UI in `web/` served at `http://localhost:4477/next/` (the old UI at `/`). Tests: `npm test` (dashboard, node:test) and `cd web && npx vitest run`.
  - The workflow skill: `~/Projects/claude-feature-workflow` (`skills/feature/SKILL.md`, `job-options.md`, `status-json.md`, `workflow-gates.md`, `git-workflow.md`, and `agents/*` for the Foreman's subagents: spec writer, wireframer, investigator, planner, implementer, tester, review lenses, Fable check).
- **How a job runs:**
  - A **Foreman** (a Claude Code session started and driven by the dashboard through `dashboard/lib/driver.js`) runs `/feature` for one request.
  - Levels **L0–L3** decide the stages: clarify → spec → wireframes → investigate → plan → build → tester → manual test → review lenses → PR stages. There are risk-trigger floors and gate cards where Vignesh approves, sends back with a note, or stops.
  - The Foreman writes `status.json` in the job folder (`~/.claude/feature-work/<slug>/`). The dashboard reads it and shows briefs, gate cards, the plan, docs, screens and decisions.
  - Each job gets its **own git worktree and branch** next to the Orbit repo (`../orbit-<slug>`, from `moxie/main`). PRs go fork → same-named org branch → staging → main.
  - **Try it** runs the job's app on its own port (3011+) for manual testing.
- **Recently added** (see `git log` on `redesign/orbit-ready`):
  - a calmer Light / Light glass look;
  - a status summary in the top bar;
  - Claude plan usage meters with a details panel;
  - a Decisions tab per job;
  - run timing ("4m · usually 2m");
  - a proof stamp on the gate card (which commit the checks ran on);
  - **automatic level choice** (Settings → Workflow, off by default; rules + Foreman suggestion, the higher wins, never lowered, re-checked against the real diff after every build, stops before any PR).
- **Mac-only today:**
  - Keychain login reading (`dashboard/lib/plan-usage.js`);
  - `lsof`/`kill`/`nohup` restarts;
  - bash in the skill;
  - `~/Library/Logs`.
- **Standing rules Vignesh has set:**
  - Never push or merge without his explicit request.
  - Confirm anything outward-facing.
  - Port 4479 is his demo: never touch it.
  - Restart 4477 only when asked.
  - Themes change looks only.
  - Status is never shown by colour alone.
  - No model calls in tests.

---

## 3. Portal Feedback today (the Orbit tracker to integrate with)

This is the **Orbit tickets v2 tracker** ("Portal Feedback") inside the Orbit portal repo.
- **Repo:** `~/Projects/moxie-portal-vrs` (fork `vigneshrs-moxie/moxie-portal-vrs`; org `Moxie-Pest-Control-Phoenix/moxie-portal`).
- **Integration worktree:** `~/Projects/orbit-tickets-v1` (branch `feature/portal-feedback-update`, PR #144 to staging).
- **Packet worktrees:** `~/Projects/orbit-pf-*`, plus `~/Projects/orbit-feedback-api-mcp` (ORBIT-479, branch `feature/orbit-479-feedback-api-mcp`) and `~/Projects/orbit-clickup-sync`.
- **Process:** Vignesh is running it right now as a coordinator (Fable) plus parallel Opus workers, one packet each.

What exists or is in flight:
- Ticket types and statuses (8 types, 11 statuses).
- Ticket pages for the team (`/admin/feedback/[ref]`) and for participants (`/feedback/[ref]`).
- Comments, internal notes, activity, watchers, mentions.
- Participant sharing.
- Severity, including the reporter's own answer.
- A per-assignee **work order** queue in My work.
- A ticket guide.
- A **Development panel** (Branches, Pull requests, Preview environment; manual links now, GitHub auto-link on a separate branch).
- **ClickUp two-way sync** (pilot).
- **External API v1 + MCP server (ORBIT-479).** Per-user tokens, hashed, scoped and revocable; the actor is the token's owner.

**Decision D9 (2026-10-26):** the API and MCP are **read-only**. No agent may write anything: not an API token, not MCP, not Feature Workshop. Only `tickets:read` and `views:read` scopes exist, and write operations stay session-only. The decision register explicitly lists **"Feature Workshop client/runner deferred"**, and the tickets roadmap has **R5** (own subdomain, Kanban, an "internal Jira") and **R8** (developer workbench and a fix agent: capture at submit, an outbox of ticket events the agent reads, the agent writes back an internal comment, a person approves the next step, agent job status separate from ticket status, agents never change status, email submitters, push to protected branches or merge).

**D9 versus R8 and this phase is the central tension you must resolve with Vignesh.** Ask what, if anything, Feature Workshop should be allowed to write back (internal comments, job status, branch/PR links, test evidence), and how: a narrow write scope, a separate service actor, or a human clicking "post" in the workshop.

---

## 4. The vision (what Vignesh has said, in his words where possible)

1. **"I want to use my feature workshop as THE way to deal with Orbit bugs and feature requests."** Requests and bugs are filed in Portal Feedback. Feature Workshop picks them up, runs the job with its gates, and the ticket shows where it is.
2. **"Integrate into [the portal feedback screen] with its own API and MCP."** Feature Workshop reads tickets through ORBIT-479's API/MCP and links jobs to tickets (keys, branches, PRs; see decision D13, loose key matching now, a Jira-style model later).
3. **Store decision records in the portal feedback screen.** Each job's decisions and the "not doing" list should live where the team sees them. The idea came from Sandcastle's `CONTEXT.md` glossary, ADRs and `.out-of-scope/` folder. Work out with him whether they live as repo files shown in the portal, as ticket documents, or both.
4. **A domain or subdomain, hosted as a product.** It runs on the internet but connects to everything locally. Worktrees, git, the Claude CLI, Try it and tests keep running on each developer's own machine, exactly as now. Discussed so far:
   - **The recommended shape:** a hosted website (request inbox, job screens, gates) plus a **local runner** per developer. The runner connects *out* to the site (no open ports), accepts only a fixed set of commands (start, approve, send back, stop), uses that developer's own Claude and GitHub logins, and sends status, briefs, screenshots and costs back up. Code stays local.
   - **Other options to weigh:**
     - (A) a private tunnel (Tailscale / Cloudflare Tunnel + Moxie login) in front of today's dashboard, which is quick but single-user;
     - (C) fully cloud runners (cloud machines clone the repo), which conflicts with local Try it, the database and `.env` secrets;
     - (D) a desktop app.
   - **Open:** how this relates to Portal Feedback's own R5 subdomain. Should Feature Workshop be part of the portal, beside it, or its own product that the portal links to?
5. **Platform-agnostic: his manager uses a Windows laptop.** The runner must work on Windows, Mac and Linux. Plan a cross-platform audit of the Mac-only pieces in §2.
6. **A roadmap for his manager, with clear stop lines** ("so that we can tell when to stop or draw a line"). Draft so far:
   - **Now (v1, local):**
     - commit and demo what's built;
     - strict status.json (validate the Foreman's status.json against a schema and send errors back to the same session to fix, like Sandcastle's structured output with retries);
     - a lock file per job (pid, branch, time; stops the terminal and dashboard both driving one job);
     - decision records and the out-of-scope list.
   - **Next (v1.5, team-ready):**
     - facts up front in review prompts (paste the diff, spec and recent commits into each review lens prompt instead of every lens fetching them);
     - **Playwright UI evidence**;
     - warn when the main branch moved and the job needs a rebase;
     - the cross-platform audit and Windows support;
     - a private tunnel.
   - **Later (v2, the product):**
     - hosted website, Moxie sign-in, request inbox, triage and assignment;
     - local runner;
     - roles (who submits, approves, watches);
     - per-person usage and costs;
     - a shared reviewer session (start the review lenses from one session that already read the code; check first whether the lenses are separate sessions or subagents);
     - parallel batches of small jobs.
   - **Roadmap only:**
     - agent-agnostic adapters (Codex and others; driver adapters, portable status.json and prompts, Claude-only extras);
     - fully cloud runners;
     - Docker sandboxes.
   - **Not doing:**
     - Direct build;
     - L0 limited to new files only;
     - "reuse a job's worktree and fast-forward from origin" (judged not useful);
     - bundling outside workflows into the skill.
   - **Stop lines proposed:**
     - v1 is done when Now is finished and 5 real Orbit jobs ran end to end without him stepping in;
     - v1.5 is done when his manager ran a job from his Windows laptop;
     - v2 needs a company yes (hosting, sign-in, security review).

   All of this is a draft to challenge, not a decision.
7. **Playwright UI testing is "a crucial part of any step that needs UI testing in the browser".**
   - The tester writes a short Playwright script per acceptance item and runs it against the job's Try it app.
   - It records a video and a screenshot per step.
   - Results show per acceptance item (✓/✗ with evidence) on the gate card and in the preview pane.
   - Required whenever the diff touches UI files.
   - The scripts are kept with the job for repeatable reruns.
   - Hard parts: signing in to the portal as a test user, test data, flaky runs.
   - It's evidence for Vignesh, not a replacement for his manual test, unless he decides otherwise.
   - Also ask whether evidence should be attached to the Portal Feedback ticket.
8. **Background:** Matt Pocock's **Sandcastle** (`github.com/mattpocock/sandcastle`; a local clone may exist in a scratchpad, otherwise read it on GitHub) was reviewed as inspiration. Its sandboxed `run()` per agent, worktree branch strategies, planner → parallel implementers → reviewer → merge templates, `!`command`` prompt context, structured output with retry, session resume and fork, worktree locks and ADR / out-of-scope habits are all fair game to borrow from. Don't adopt the library; Feature Workshop is human-gated, Sandcastle is unattended.

---

## 4a. The latest from the "Orbit portal feedback follow-ups" chat (read it yourself)

The Portal Feedback work is coordinated in a Claude Code chat titled **"Orbit portal feedback follow-ups"**. That chat is newer than the plan files, so read it before you plan. Use the plan files for detail and the chat for what's current.

- **Live chat (newest):** `~/.claude/projects/-Users-moxie/32a8ad8c-8c39-4735-b3b9-5617c83bc3b1.jsonl` (session `32a8ad8c…`, about 8 MB, still running).
- **An earlier chat with the same title:** `~/.claude/projects/-Users-moxie/8bb6039c-8063-4163-a39c-c45556b9d649.jsonl` (read only if the live one refers back to it).
- **Worker chats, same folder, by title:**
  - "ORBIT-479 feedback API MCP schema" `0c7da87e…`
  - "ORBIT-479 participant tokens worker D2" `a252b59a…`
  - "Portal feedback follow-ups worker H" `abd7caf2…`
  - "Orbit portal development panel" `e7416a94…`
  - "Portal feedback severity work order" `232eebbd…`
  - "Orbit portal feedback ticket guide" `3b4803b3…`
  - "Orbit Portal Feedback worker coordination" `85d93076…`
  - "Orbit ticket traceability in Git workflow docs" `61e07cb4…`

  Each worker writes its report to `docs/plans/…-report-<letter>.md` in its own worktree.
- **How to read a chat:** it's JSON lines. Pull out only the human's messages and the assistant's longer text replies, for example:
  ```
  python3 - <<'EOF'
  import json
  for line in open('/Users/moxie/.claude/projects/-Users-moxie/32a8ad8c-8c39-4735-b3b9-5617c83bc3b1.jsonl'):
      d = json.loads(line)
      c = d.get('message', {}).get('content')
      if d.get('type') == 'user' and isinstance(c, str) and not c.lstrip().startswith('<'): print('USER:', c[:3000])
      if d.get('type') == 'assistant':
          for x in c or []:
              if isinstance(x, dict) and x.get('type') == 'text' and len(x['text']) > 300: print('ASSISTANT:', x['text'][:3000])
  EOF
  ```
  Read the **last part** most carefully. Don't send that chat messages and don't touch its worktrees: it's busy.
- **Secrets:** the chat contains at least one pasted credential (a ClickUp token). Never copy, quote or reuse any credential you see there.

What it says as of 2026-10-27 midday. Verify this; it moves fast:
- **Vignesh's own words on D9:** "i dont want agents to be able write anything even from feature workshop so make sure it only has read access", "for now let humans paste links, maybe we can change it later on", and "we need the agents to see what the user can see (token owner)". So any write-back you propose for Feature Workshop **reopens a decision he made on purpose**. Present it as a choice with its trade-offs, not as a plan step.
- **His feedback round (2026-10-27):**
  - simpler row dropdowns;
  - subtasks under Story/Feature;
  - work ordering redone (optional, unique within a severity, no separate Critical section, smoother);
  - one My feedback list with a Mine / Following filter for non-admins;
  - GitHub branches looking duplicated;
  - he answered "defaults" to the coordinator's 7 decisions.
- **Built and running:**
  - `f327a112` (fixes) is merged into #144's branch;
  - the review server is on **:3110** (branch `review/portal-feedback-all`);
  - packets **J** (work-order v2), **K** (subtasks + Mine/Following), **L** (Jira-style GitHub rebuild, hourly scan, Vercel preview off) and **M** (ClickUp daily sync, button, multi-link, webhooks off, comments, attachments) are building in parallel.
- **Release plan:** a stack of four PRs, written up in `~/Projects/orbit-tickets-v1/docs/plans/2026-10-27-portal-feedback-release-stack.md`:
  1. #144 tracker;
  2. ORBIT-479 API/MCP;
  3. GitHub sync;
  4. ClickUp.

  Merged into one another, never rebased. Migrations are renumbered to go up in stack order. Every new switch stays off on first deploy. The coordinator was waiting on whether it may push the fork branch and open the fork → org PR, or hand him the SHA.
- **He also asked:** "why are there two different servers running locally? can i not run everything on one server?" Running many local servers, worktrees and ports by hand is a pain point Feature Workshop's next phase should remove.
- **How he likes big work run:** a Fable coordinator, packets with owned files, one worktree, branch and port per worker, decisions in a register, gates before every merge, and he pushes or approves each outward step. Feature Workshop's next phase should make *this* way of working its native shape. Ask him whether the coordinator + packets model should become a first-class workflow, i.e. a "program" of several jobs with one coordinator.

---

## 5. Read these first

Feature Workshop:
- `~/Projects/feature-workshop-phase1/` (README, `dashboard/server.js`, `dashboard/lib/driver.js`, `dashboard/lib/auto-level.js`, `dashboard/lib/levels.js`, `web/src/`), and `git log --oneline -40` there.
- `~/Projects/claude-feature-workflow/skills/feature/*.md` and `agents/*.md`.
- Earlier plans in `~/Projects/feature-workshop-phase1/docs/plans/`.

Portal Feedback (planning files are gitignored and live only here):
- `~/Projects/orbit-tickets-v1/docs/plans/2026-10-26-portal-feedback-followups-plan.md` (baseline, branches, packets, **decision register §6**, worker rules §7)
- `…-followups-contracts.md` (authorization, projections, actor and API/MCP contracts, the D9 read-only rule)
- `…-handoff-D-api-mcp-schema.md`, `…-handoff-D2-participant-tokens.md`, `…-handoff-G-github-preview.md`, `…-handoff-E-clickup.md`, `…-handoff-H-work-order-ui.md`
- `2026-10-08-orbit-tickets-roadmap.md` (R5 subdomain, **R8 fix agent**), `2026-10-22-orbit-tracker-usability.md`, `2026-10-27-portal-feedback-pr-notes.md`
- The code in `~/Projects/orbit-feedback-api-mcp/app/src/` (`lib/feedback/operations/**`, `actor.ts`, `api-tokens.ts`, `app/api/feedback/v1/**`, the MCP server) and `~/Projects/orbit-tickets-v1/app/src/lib/feedback/` (access, tracker, references, ticket markdown "Copy all").
- Moxie's git workflow rules: `~/Projects/moxie-portal-git-workflow/CLAUDE.md` and `docs/engineering/git-workflow/agent-rules.md`.

If a path is missing, say so and carry on; don't guess its contents.

---

## 6. Questions you must get answered (add your own)

- **Write-back versus D9:** what may Feature Workshop write to a ticket (nothing, internal comments, job status, branch/PR links, evidence), and through what (narrow scope, service actor, human "post" button)?
- **Source of truth:** which lives where: the job, its state, briefs, decisions, evidence? Portal Feedback, Feature Workshop, or the repo?
- **Intake:** who can file a request that becomes a job? Who triages and assigns? Is a ticket picked up automatically (R8 outbox) or only when a developer clicks start?
- **Mapping:** one job per ticket? How are ticket keys, branch names, PRs and Development panel links connected?
- **Hosting:**
  - inside the portal (R5) or its own domain?
  - Moxie Google sign-in?
  - who approves hosting and security?
  - what may leave the developer's laptop?
- **The runner:**
  - install, update and service on Windows/Mac/Linux;
  - offline behaviour;
  - one per developer;
  - whose Claude plan and GitHub token it uses.
- **Approvals:** can someone other than the job's developer approve a gate? Can a manager watch?
- **Playwright:** test user and secrets, test data, required at which levels, where evidence is stored.
- **Decision records:** format, where they live, how the portal shows them.
- **ClickUp:** does Feature Workshop need to know about it at all, or only through Orbit?
- **The manager's roadmap:** dates or order only? The format he wants it in (repo file, shareable page, Claude Doc)?
- **Scale:** how many developers, how many jobs at once, cost limits per person?

---

## 7. The plan to deliver

Write `~/Projects/feature-workshop-phase1/docs/plans/<date>-feature-workshop-next-phase-plan.md` (and a short manager version if he wants one) containing:

1. **The vision in one paragraph,** and what "done" means for this phase.
2. **Architecture:**
   - components (hosted site, runner, Portal Feedback API/MCP, GitHub, Claude);
   - what runs where;
   - data flow for one ticket from filing to merged;
   - what crosses the network and what never leaves the laptop.
   - Include a simple diagram.
3. **The integration contract with Portal Feedback:**
   - endpoints and MCP tools used;
   - scopes;
   - any new ones needed, and how they fit (or change) D9, as a proposal for Vignesh to decide;
   - events/outbox;
   - ticket ↔ job ↔ branch mapping.
4. **The runner:**
   - commands it accepts;
   - authentication;
   - install and update on Windows/Mac/Linux;
   - offline behaviour;
   - the cross-platform audit list.
5. **Security and permissions:**
   - threat list;
   - what an attacker who controls the website could make a runner do, and why that's limited;
   - audit log;
   - approvals needed from Moxie.
6. **Playwright UI evidence:** design, where it plugs into the stages, what the gate card shows.
7. **Decision records:** format and where they live.
8. **Phased roadmap with stop lines** (refine the draft in §4.6), each phase with acceptance criteria and rough size.
9. **Decision register** (everything asked and answered).
10. **Packets for implementers,** in the same style as the Portal Feedback plan:
    - one self-contained handoff per packet;
    - owned files;
    - base, branch, worktree and port;
    - dependencies;
    - acceptance criteria;
    - verification commands;
    - integration order;
    - at most three workers at once.
11. **Risks and open questions** left for later.

Nothing gets built until Vignesh approves the plan.
