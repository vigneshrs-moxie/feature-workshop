# Feature Workshop redesign: research brief (2026-10-14)

Input for the redesign planning session. Sources: Paperclip, Dify, openorchestrators.org, coding-agent orchestrators (Conductor, Claude Squad, Vibe Kanban, Cursor agents, Codex, Copilot agent, and others), and dev-tool design (Linear, Raycast, Warp, Zed, Vercel, Arc). Raw reports: `orchestrators-2026-10-14-reports.md`.

Decisions already made with the user:
- **Stack:** React + TypeScript + Vite front end; keep the existing Node/SDK backend logic.
- **Layout:** three panes (Jobs | Foreman conversation with inline approval cards | Preview with App / Diff / Tests / Terminal), plus a ⌘K command palette.
- **App preview:** embedded browser or Chrome. Ask once which should be the default and remember it.
- **Terminal:** embedded terminal shown on demand, plus "open in iTerm / Mac Terminal / VS Code".
- **Look and feel:** futuristic yet clean and professional, a few fun touches, impressive to the team, and simpler than today.
- **Approvals:** every plan needs the user's approval. Planning happens on Fable 5.1.

---

# Feature Workshop redesign: planning brief

## 1. What the best orchestrators do that we don't (top 10)

| # | Idea | Seen in | Why it matters here | Effort |
|---|---|---|---|---|
| 1 | **One "Needs you" queue across all jobs.** The jobs list is grouped Needs you / Running / Paused / Idle / Done. A count shows in the window title and dock, with OS notifications and sounds for done, needs-you and error. | [Paperclip Decisions] [Superset] [VK] [Warp] | Approval gates are your hot path. You stop polling jobs and only respond when something needs you. | M |
| 2 | **Collapsed turn summaries plus a live status line.** A finished stage shrinks to "Worked 4m · 23 tools · +120/−8 · $0.42". A running one shows a pulsing dot, a timer and the current tool. Silent runs are flagged at 5 and 15 minutes. | [Paperclip] [Multica] [Gas Town] | The Foreman thread stays readable, and "is it stuck?" is answered without opening logs. | S–M |
| 3 | **Gate cards with named buttons that each lead somewhere,** instead of just Allow/Deny: Approve / Edit then approve (the draft is pre-filled) / Revise with feedback / "Other" guidance. Cards stay pinned above the message box. | [Dify Human Input] [Fusion] [Warp] [Paperclip] | Editing the agent's spec or plan in place is faster than writing feedback, and a card can't get lost in scrollback. | M |
| 4 | **Steer, Interrupt or Pause when you message mid-run.** A queued message shows whether it was delivered and acted on. Pause keeps your drafts. | [Paperclip] [Copilot] | These are the controls a terminal lacks. You can redirect a worker without killing the job. | M |
| 5 | **Diff with a scope switcher** (this stage / last turn / whole branch). You comment on lines and send the whole batch to the Foreman with one action. | [Codex] [Claude Code Desktop] [Orca] | Review is the bottleneck, and you can review exactly what the implement stage changed. | M–L |
| 6 | **Preview pane that finds the dev URL on its own.** Adds device sizes, a click-an-element-to-send-to-chat picker, and a coloured banner naming the job whose app you're looking at. | [VK] [Orca] [Paperclip] | No copying ports by hand, and no testing the wrong worktree. | M |
| 7 | **Usage meters** for the 5-hour and weekly windows with a countdown to reset, cost per stage, and per-job budgets (warn at 80%, pause at 100%, one-click "raise and resume"). | [Orca] [Superset] [Paperclip] | Turns your existing pause-at-limit into something you can see and plan around. | S–M |
| 8 | **Per-worktree port ranges, environment variables and setup/run/teardown scripts,** plus a Services panel (start/stop/restart, URL, errors in red). | [Conductor] [Superset] | Several jobs can be tested side by side without `.env` or port clashes. | M |
| 9 | **Re-run one stage using the saved outputs of earlier stages,** plus checkpoints that restore files, git and chat to an earlier point. | [Dify] [Conductor] [Zed] | Retry review or tests without redoing implementation. | L |
| 10 | **A "ready to merge" Checks tab:** git status, PR, CI, review threads, open Foreman questions. CI is watched and the job archives itself when its PR merges. | [Conductor] [Claude Code Desktop] | One place answers "can I ship this?", and "mark done" happens on its own. | M |

## 2. Recommended feature set

**Must (v1)**
- **Left pane (Jobs):** the status groups from #1. Each row has a status glyph plus a label (never colour alone), a stage chip and a relative time. Paused rows show "resumes 3:42pm". Collapses to an icon rail.
- **Centre pane (Foreman):**
  - Worker activity appears as collapsible blocks with the summary line and live status line (#2).
  - Gate cards (#3) with keys A / ⇧A / D / E / O.
  - Auto-allowed calls appear as dim one-line entries that link to the rule that allowed them.
  - Steer, Interrupt and Pause (#4).
- **Right pane (Preview):**
  - App tab with auto-detected URL and the worktree banner. "Open in Chrome" is one key away.
  - Diff tab with scopes and batched comments.
  - Terminal tab (xterm).
  - "Open in" menu: iTerm, Terminal, VS Code, Finder.
- **Top bar:** stage stepper (spec → … → PR, skipped stages shown dashed) and a usage meter with reset countdown.
- **Command palette (⌘K):** fuzzy matching, and only shows actions that apply right now (for example, Push only appears when there are unpushed commits). Also: `?` shortcut sheet, `n` jumps to the next pending approval, ⌘N starts a new job.
- **Reconnect:** reloading the page replays the job's state immediately [Dify state snapshot].

**Should (v1.x)**
- Structured worker handoff cards and a numbered acceptance checklist written at the spec stage [Factory].
- Cost per stage, per-job budgets (#7), and a Services panel with port ranges (#8).
- Checks tab and PR monitoring (#10). Tests tab with "rerun failed".
- Element picker and device sizes in the preview.
- Job presets that bundle flow size, skipped stages, reviewers, Fable checks and model per stage [VK variants].
- Notes per job, and pane layout remembered per job.
- A "review later" list kept separate from "needs you now".
- Drift warnings for files outside the brief, edits to shared config, and the same failure repeating [GitHub].
- Start a job from a GitHub issue, a branch or a PR, not only from past sessions.

**Later**
- Stage re-run and checkpoints (#9).
- Side chats (`/btw`).
- Gantt-style timeline with one lane per worker [Paperclip].
- Best-of-N runs (niche, and costs N times as much).
- Approvals from your phone.
- Shared templates and rules for the team, with an append-only audit log.
- Asking questions of a past session [Gas Town seance].
- A machine resources view.
- Helpful / Needs work votes on worker output.
- OpenTelemetry export.

## 3. Workflow optimisations for your flow

- **Worker handoffs:** every worker must end with a handoff covering what's done, what remains, the commands it ran with exit codes, and any issues. If one is missing, the worker is woken once to write it [Paperclip]. The Foreman and you read the cards, not the logs.
- **Spec gives a checklist:** the spec stage produces a numbered acceptance checklist. Test and review mark each item pass or fail, with evidence [Factory].
- **Review loop cap:** requested changes go back to the same implementer. After 3 rounds between reviewer and implementer, the job escalates to you [Paperclip]. This stops endless agent back-and-forth.
- **Gates:**
  - Default to "edit the draft, then approve."
  - Gates have a timeout: after N hours you get a notification and the job is parked, not left silently blocked [Dify].
  - Several briefs or questions from the same job are combined into one card (at most 3 questions).
- **Auto-allow rules:**
  - "Always allow" proposes a rule that you accept. Rules are never widened silently [Paperclip warning].
  - Rule suggestions are mined from past approvals, which addresses the "fewer permission prompts" backlog item.
- **Local testing:**
  - Each job gets a port range, and its setup script links `.env`.
  - The DB switch is a single shared resource, so treat it as a lock: "DB in use by job X" [Conductor Spotlight caveat].
  - Stop the dev server before removing a worktree.
- **PR chain (fork → org → staging):**
  - Model it as three explicit steps in the Checks tab, each needing its own approval. Fork is the default, and org is never pushed unless you ask.
  - Fetch org main automatically before every push.
  - Merge accepted jobs one at a time and re-run checks after each one. Warn when two jobs touch the same files [Superset].
- **Usage limits:**
  - Cap how many jobs run at once to avoid hitting the limit [Gas Town].
  - Show what's left in the 5-hour window before starting implement or test.
  - Optionally queue heavy stages to start after the reset.
  - Validation work needs a budget: in Factory's run it took 37% of the time (778M tokens was the whole run, mostly cache reads).
- **Fable vs Opus:** make the model a per-stage setting (planner / implementer / checker), with a per-job override [Fusion]. Show cost per stage so the split is decided from real data. Good candidates for Fable checks:
  - A "checker" that verifies a worker's "done" claims against the evidence [Paperclip watchdog].
  - Confirming that a revision actually addressed the feedback [Dify].

## 4. Design direction

**Tokens**
- **Colour:**
  - Generated in oklch from three inputs: base hue, accent hue and contrast [Linear]. Dark theme first; light and high-contrast themes come from the same generator.
  - Neutrals: five background steps from `oklch(.16 .006 260)` to `.28`. Borders are white at 6%, 10% and 18% opacity.
  - Text: `.95` for primary (APCA contrast target Lc 90) and `.72` for secondary (target Lc 60 or higher).
  - One accent: indigo `oklch(.70 .15 275)`.
  - Status colours: ok `155`, warn `80`, error `25`, info `235`, paused grey.
- **Type:** Inter (13px base, line height 1.45), Inter Display for headings, Geist Mono with tabular numbers for times, ports, costs and counts. Sizes: 11 / 12 / 13 / 15 / 20 / 28.
- **Spacing and shape:** 4px grid. 32px list rows. Corner radii 4 / 6 / 10 / 14, with a child never rounder than its parent. Two-layer translucent shadows.
- **Layout:** jobs pane 240–280px, Foreman text at most about 760px wide, preview pane 40%. 40px top bar. 32px bottom action bar that shows key hints [Raycast].

**Motion**
- Animate only transform and opacity. Durations are 120ms for hover and press, 180ms for menus and popovers, 240ms for panes and dialogs. Nothing over 300ms. Ease-out on entry.
- **Nothing animates on frequent keyboard actions** (palette open, j/k, switching tabs). Menus grow from `scale(.96)`, starting at the button that opened them.
- Spinners wait 150–300ms before appearing, then stay at least 300–500ms so they don't flicker. Use View Transitions for switching jobs.
- With reduced motion turned on, only fades remain and pulses stop.

**Fun touches** (each rare and optional)
1. Each job gets its own hue, which tints its dot, stepper and terminal cursor [Arc].
2. The Foreman's glyph orbits while it is thinking, and orbits faster as more workers run.
3. A short confetti burst (under 1.2s) when a PR opens, once per job, without taking focus [Raycast].
4. Pause message: "Claude's taking a breather, back at 3:42pm" with a countdown ring.
5. A small "naming…" animation while the branch is auto-named.

**Avoid**
- Glassmorphism, neon, more than one gradient, colour-only status, and toasts for things that need a decision.
- Company role-play and invented vocabulary [Paperclip CEO, Gas Town Polecats].
- Overlapping concepts (Inbox vs Decisions vs Blocked) and lots of feature flags.
- Analytics sprawl [Fusion's 11 views].
- Telemetry switched on by default, and exposing the dashboard port beyond your own machine.

## 5. Risks and open questions

1. **Embedding the app:** Google sign-in and `X-Frame-Options` will probably break the Moxie portal inside an iframe. Do we build a small proxy, or make Chrome the primary preview and keep the embedded view for simple pages?
2. **Shared DB:** can two jobs ever be tested at the same time, or is the DB switch strictly one job at a time (a lock with a clear warning)?
3. **Scope creep:** the research yields about 100 ideas. Do we agree that v1 is only the "Must" list, to avoid Paperclip-style sprawl?
4. **Default model per stage:** which stages use Fable and which use Opus by default, and what is the daily or per-job budget ceiling?
5. **Team scope for v1:** is it shared presets and auto-allow rules only, or also visibility into each other's jobs? Either way it stays local-first; v1 should not depend on any cloud service.
6. **Migration path:** do we move to the React UI one screen at a time on the existing Node/SDK server (jobs keep running throughout), or rebuild everything at once? This decides whether the reconnect-and-replay work comes first.

---

## Completeness review: corrections and gaps to weigh

- **Wrong number in the brief.** It says validation took "37% of the time and 778M tokens". In the Factory report, 778.5M is the token count for the whole 16.5-hour run, mostly cache reads. Validation was 37% of the time, not 778M tokens. Fix the wording so validation budgets aren't sized on a wrong figure.

- **Approvals can go stale (key for "human approval on every plan").** The brief dropped several Paperclip safeguards:
  - Lock the approved spec or plan version, so later changes go to a new derived copy.
  - Add a "target changed since this was proposed" warning that disables the old options.
  - Have each option state its exact effect.
  - Require typing to confirm destructive actions.
  - From the design report, also dropped: risk tags on Allow/Deny cards ("writes outside worktree", "network", "git push").

- **Missing fallback for one dev server or one DB.** Conductor Spotlight and Sculptor Pairing mirror one job's worktree into the main checkout. That fits the existing DB switch, and probably Google sign-in callbacks on fixed ports, better than a proxy. Risk #1 only offers "proxy vs Chrome". The brief cites Spotlight only as a caveat. Note that the Spotlight details come from search results only.

- **No rule on where status comes from.** The orchestrators report warns against hook-injected status and stale "running" states that need a manual "Clear Status" (Superset). Status should come from the SDK session and the actual process state, and be re-checked after a restart. The brief never says this, yet #1, #2 and Reconnect depend on it.

- **The usage and cost claims don't say where the data comes from.**
  - The brief rates the 5-hour and weekly meters "S–M" without saying where quota data comes from in the Agent SDK. No report confirms the SDK exposes it.
  - On a subscription, dollar figures ("$0.42") and dollar budgets can mislead. Superset labels "Cost to you $0" separately from the API-equivalent cost. The brief dropped that distinction.
  - Budgets should probably be expressed as quota percent or tokens.

- **The review stage is thin, even though the brief calls review the bottleneck.** Dropped:
  - A findings card you step through in the diff, each with "send to fix" (Claude Code /code-review, Devin's confidence labels).
  - Keep, reject or revert per hunk (Zed, Codex).
  - Diffs grouped by logical change.

  Also, the PR chain approvals and "fork only" are already part of today's flow and match a user rule. Yet the Checks tab that hosts them is only "Should", so this is inconsistent.

- **Conflicts with local-first.**
  - "Approvals from your phone" (Later) contradicts "never expose the dashboard port beyond your machine". It needs a stated approach, or should be dropped.
  - A "dock badge" isn't available to a plain browser tab. The design report used the window title plus a favicon badge, unless this becomes a PWA.

- **Keyboard and accessibility gaps.**
  - ⌘N, ⌘R and ⌘1/2/3 are taken by the browser in a web dashboard. ⌘N can't be intercepted in Chrome.
  - The design report uses `e` for both "mark done" and "edit".
  - The brief dropped "single-letter keys are ignored in text fields".
  - The brief dropped the whole accessibility section: focus rings, the combobox pattern for the palette, and a debounced polite live region so streaming output doesn't flood screen readers.

- **Trust in auto-allow was pushed to "Later".** An append-only log of approvals and auto-allows sits under team features. Auto-allow already exists today, so that log, plus Archive/History that keeps full Foreman transcripts (Conductor), belongs in v1 or v1.x. Also dropped: blocked-reason chips with an owner and the action needed ("External wait · you · run migration · stopped 2h"). Today the brief covers only "resumes 3:42pm".

- **Smaller dropped items worth a decision.**
  - A Plan / Ask / Auto mode chip per message (Shift+Tab), familiar from Claude Code.
  - A per-job or per-repo note the Foreman reads at the start of every session, so it survives restarts (Dify `build_note.md`, Conductor `.context/`).
  - Moxie-specific drift checks: flag edits to `getScope`/`scopeWhere`, hardcoded office or branch names, and gated features with no seeding migration, per the repo's AGENTS.md. The brief's drift warnings are generic.
  - Checkpoints rest on a search-only Conductor source. That should be marked as unverified.
