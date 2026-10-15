# Superpowers (obra/superpowers) vs our workflow (2026-10-15)

# Decision brief: Superpowers vs our feature workflow

Sources read: `/Users/moxie/.claude/skills/feature/{SKILL,job-options,worker-rules,brief,review-lens-rules}.md`, `feature-spec/workflow-gates.md`, `feature-plan/SKILL.md`, all `/Users/moxie/.claude/agents/feature-*.md`, `/Users/moxie/Projects/feature-workshop/docs/plans/redesign-2026-10-14.md`, `docs/research/*`. Nothing modified.

## 1. Side by side

| | Superpowers | Ours (+ redesign) |
|---|---|---|
| Stages | brainstorm → worktree → plan → execute → review → finish; one pipeline for everything | spec → refine → investigate → plan → implement → test → review → PR#1/2/3; sized L0–L3 |
| Subagents | fresh per task, briefed from the plan file; controller never edits code; cheap/standard/strong model by role | fresh worker per step (done); conductor edits nothing; model per agent in frontmatter; Sonnet/Haiku for cheap lenses |
| Review | one reviewer per task (spec + quality verdict), fix loop ≤5, final whole-branch review | 8 parallel lenses on the whole branch, conductor verifies every finding, ≤2 fix rounds; Fable second look |
| Verification | TDD Iron Law, `Expected:` lines per step, verification-before-completion gate, completion script logs only on green | tester agent runs approved checks; "honest checks" rule; no TDD, no root-cause skill (grep: zero hits for tdd/red-green/root cause) |
| Human checkpoints | spec, plan + execution mode, finish; check-ins discouraged mid-run; "rulings" listed at end | gate between every stage, approvals by version, separate yes for DB/push/PR; L0 gate-free in redesign |
| Plans | tasks = smallest testable unit; Files/Interfaces/Steps; "record decisions, not code" | FR-traceable plan + test plan, layer tags; no granularity rule |
| Git | worktree skill, finishing skill (merge/PR/keep), typed discard | git-workflow.md, worktree per task, fork-only, three-PR chain; redesign makes git actions palette tools |
| Recovery | `.superpowers/sdd/` ledger survives compaction | `workflow-status.md` + handoff cards + fresh Foreman from record |

## 2. Adopt from Superpowers

1. **TDD inside each implement step** (`test-driven-development`). Why: our test plan is written before code but tests are added after; TDD-as-spec curbs over-engineering. Map: L1–L3 implementer steps become red → green → commit; L0 exempt. Edit `feature-implementer.md` step 3 and `feature-plan` Step 3.
2. **Verification-before-completion gate.** Why: our "honest checks" rule says *report* accurately; theirs says *run the proving command fresh, read exit code, then claim*. Map: one paragraph in `worker-rules.md`, applies to all levels; the redesign's `checks/<nnn>.log` + tail is the evidence.
3. **Systematic-debugging** for `kind: bug` jobs. Why: we have no root-cause discipline; the quick plan's "cause (file:line)" is a thin stand-in. Map: L0/L1 bug = reproducing test first; "3 failed fixes → stop and ask" matches our review-loop cap.
4. **Plan task shape** (Files / Interfaces / Steps with Expected output, decisions not code). Why: our planner has no granularity rule; redesign §6 wants handoffs ≤5 lines. Map: L2/L3 plan template.
5. **Rulings list.** Every judgement call a worker made, listed in its handoff so you can undo it. Map: a `rulings` field on the handoff card (redesign §6.3).
6. **Discipline-skill writing style** (rationalization table, no exemption clauses) and pressure-testing skill text on subagents. Map: how we write `worker-rules.md` edits in phase 3.
7. **Compaction-safe re-injection** (SessionStart hook on `compact`). Map: redesign's fresh-Foreman bootstrap already covers it; a hook is the cheaper fallback for terminal sessions.

## 3. Keep (Superpowers lacks these)

- **Levels L0–L3 + risk triggers.** Superpowers' biggest complaint is "overkill for one-file edits"; levels are the answer.
- **Usage/window awareness**: ring, per-job cap, approve-after-reset, continue/fresh/compact chooser. Superpowers has nothing; its reviews are the token sink.
- **Gate cards** with Edit-then-approve, staleness guard, "Also decided" overrides. Superpowers' gate is a chat message.
- **Separate-yes list** (DB writes, migrations, email, push, PR) and fork-only, three-PR chain. Superpowers' finish skill is single-repo.
- **Parallel lenses with conductor verification**; permissions/scope lens is Orbit-critical (getScope/scopeWhere) and their single reviewer won't carry it.
- **Local testing**: port-forward, DB lock, manual-test stage. Absent in Superpowers.
- **Dashboard, narrator, Stats**; options choose process never permission.

## 4. Options

**A. Superpowers wholesale as worker layer, Foreman/dashboard on top.** Cleanest skills, free updates. But: its meta-hook mandates skills *before any action* in every session (fights the Foreman), subagents ignore the meta-skill (known issue), plans/specs land in `docs/superpowers/` inside the app repo (violates our private-folder rule), single reviewer drops the permissions lens, and brainstorming's one-question-per-message conflicts with ≤3 Qs/brief. Fit: poor.

**B. Borrow selectively**: `test-driven-development`, `verification-before-completion`, `systematic-debugging`, the `writing-plans` task template, rulings, and the skill-authoring method. Skip: `using-superpowers`, `brainstorming` (our spec/refine), `requesting/receiving-code-review`, `using-git-worktrees`, `finishing-a-development-branch`, `executing-plans`.

**C. Keep ours, add TDD/verification/debugging only.** Subset of B without the plan template and rulings.

**Recommendation: B**, folded into redesign phases 2–3 (the skill edits already scheduled). Installing the plugin isn't needed; copy and trim the three discipline skills (MIT), rewrite in our voice, keep "no exemption clause" style.

## 5. Token effect (shared Max)

- Fresh-context subagents: already ours; no change.
- TDD: +1 test-run per step, roughly +10–15% implement tokens at L2/L3; offset by fewer review fix rounds (Superpowers users report ~14% net saving). Exempt L0.
- Plan granularity "decisions not code": v6.4.2 measured planning tokens ~⅓ of before; adopt.
- Review passes: keep lenses but make Superpowers' per-task review opt-in (L3 only) rather than default; whole-branch review once. Do **not** add their 5-round fix loop; stay at `review_rounds` 1–3.
- Their brainstorm/visual companion is the sink users complain about; we skip it.

## 6. Verbosity rules (information-preserving)

1. **Brief ≤ 120 words; plan-approval brief ≤ 200.** Every line is a fact, decision or question; no restating artifacts.
2. **One decision = one line**: `D1 <question> → rec: <answer> (<tradeoff>)`.
3. **Handoff card: fixed five fields, ≤5 lines each**, machine-readable:
```
done: S3 labels.ts, labels.test.ts · commit a1b2c3
remaining: S4
checks: npm run check → 0 · npm run build → 0
issues: none
rulings: kept existing enum order (plan silent)
```
4. **Plan task = Files / Interfaces / Steps / Expected**, no code bodies; "a plan longer than the code has written the code".
5. **Status lines for stages**: `Build · 4m · 23 tools · +120/−8 · 2% window`.
6. **Questions carry their recommendation and what they block**; max 3, consequential ones alone (already ours; enforce the length cap in `HandoffCard`).
7. **Workers tail, never paste**: `--stat` first, `tail -n 40` of check logs.

---

## Raw research

I have enough to report. Compiling now.

**Confirmed identity.** "Superpowers" for Claude Code is https://github.com/obra/superpowers by Jesse Vincent (obra; jesse@fsck.com) and "the team at Prime Radiant". Launched 9 Oct 2025, the same day Anthropic shipped Claude Code's plugin system. Plugin manifest at `.claude-plugin/plugin.json` reads: name `superpowers`, version **7.0.0** (released 10 Oct 2026), description "Core skills library for Claude Code covering TDD, debugging, collaboration patterns, and proven techniques", licence MIT. The repo is now multi-harness (Codex, Cursor, Gemini CLI, Copilot CLI, Pi, OpenCode, Kimi, Qwen, Devin, Hermes, Muse, Antigravity, Grok Build), but Claude Code remains the primary target.

## 1. Philosophy

From the README: "a software development methodology for coding agents" built from "composable skills and bootstrap instructions that make the agent use them." The agent should clarify intent before writing code, write a spec, write a plan, then execute with subagents and reviews. Stated principles: test-driven development (tests first), systematic process over ad-hoc guessing, complexity reduction (YAGNI, DRY, simplicity), and "evidence over claims: verify before declaring success." Skills are "Mandatory workflows, not suggestions."

From Vincent's launch post (https://blog.fsck.com/2025/10/09/superpowers/): the origin is him extracting and systematising his own agentic coding process; the foundational idea is that agents should "learn from documents and experience and write down what they learn." Two notable design choices: (a) skills are *tested like code* — he runs subagents through realistic pressure scenarios and hardens the text after every failure; (b) the wording leans on Cialdini's persuasion principles (authority, commitment), which he cites a study showing affect LLM behaviour. Quote: "Skills are what give your agents Superpowers."

## 2. How skills are structured and discovered

**SKILL.md format** (from `skills/writing-skills/SKILL.md`):
- One folder per skill, flat namespace, required `SKILL.md`; optional supporting files only for heavy reference material (~100+ lines) or reusable scripts/templates (invoke via `bash scripts/x.sh`, never bare path, since packagers strip exec bits).
- YAML frontmatter: `name` (letters/digits/hyphens only, verb-first gerund naming like `writing-plans`) and `description` (third person, must start "Use when...", describe *only* triggering conditions, under 1024 chars, target under 500).
- Body: Overview/core principle, When to Use, Core Pattern, Quick Reference, Implementation, Common Mistakes, optional Real-World Impact.
- "Claude Search Optimization (CSO)": the description must *not* summarise the workflow, because the model will follow the summary and skip the body (they observed one review step being done where the flowchart required two). Keywords should match error messages/symptoms the agent would search for. Token budgets: <150 words for getting-started, <200 for frequently loaded skills, <500 otherwise. Cross-reference by name and mark as required; avoid `@` links (force-load).
- Skill types: technique, pattern, reference. "Discipline" skills (TDD, verification) get a rationalization table, red-flag list, explicit loophole closures, and a "violating the letter violates the spirit" clause; nuance/exemption clauses are deliberately avoided because they "reopen the negotiation."
- Skills are written with RED-GREEN for docs: run a pressure scenario on a subagent *without* the skill, record the rationalisations, write the minimal skill that fixes them, re-run; micro-tests with 5+ repetitions and a no-guidance control.

**The `using-superpowers` meta-skill and how it forces use** (`skills/using-superpowers/SKILL.md`, injected by `hooks/session-start`):
- `hooks/hooks.json` registers one `SessionStart` hook, matcher `startup|clear|compact`, command `"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd" session-start`, synchronous. The script reads `skills/using-superpowers/SKILL.md`, JSON-escapes it, wraps it in an `<EXTREMELY_IMPORTANT>` block saying the session "has superpowers" and must use the `Skill` tool for all other skills, and emits `hookSpecificOutput.additionalContext` for Claude Code (other field names for Cursor/Copilot/Muse). Because the matcher includes `compact`, it is re-injected after context compaction.
- Rules in the meta-skill: invoke relevant skills *before any response or action*, including clarifying questions or file reads; "IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT." (opt-out only if, once read, it clearly doesn't fit). Before entering plan mode, invoke brainstorming first. A red-flag list of rationalisations ("This is just a simple question") signals to stop and check. Priority: process skills (brainstorming, systematic-debugging) first, implementation skills second. Announce the skill and its purpose, follow it exactly, create a todo per checklist item, re-read the current version rather than relying on memory. Subagents dispatched for a specific task ignore this meta-skill. Precedence: user instructions (CLAUDE.md/AGENTS.md/direct requests) > skills > default behaviour. Platform reference files under `references/` for Claude Code, Codex, Pi, Antigravity, Hermes, Muse.
- Earlier (v1–v3) discovery was via a shell search script and a bootstrap under ~2,000 tokens; v6.1.0 trimmed the bootstrap further for per-session cost. Personal overrides in `~/.config/superpowers/skills/` take precedence on path match (per the heyuan110 deep-dive; not re-verified in current README).

## 3. The full skill list (15 directories in `skills/`, verified at https://github.com/obra/superpowers/tree/main/skills)

| Skill | One line |
|---|---|
| **using-superpowers** | Meta-skill injected at session start; mandates checking for and invoking applicable skills before any action. |
| **brainstorming** | Before any creative work: one question per message, recon offer, periodic 200-300-word playback, size the work (quick task / small change / project), write a design doc to `docs/superpowers/specs/YYYY-MM-DD-*.md`, "builder check" by a fresh subagent, optional browser "visual companion" for mockups; hard gate — nothing built until the human approves; hands off to writing-plans only. |
| **writing-plans** | Turn an approved spec into `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`: header (Goal, Architecture, Tech Stack, spec link, Global Constraints, Review Focus), tasks that are the smallest independently testable unit, each listing Files (create/modify with line ranges/tests), Interfaces (exact signatures consumed/produced), and Steps (write failing test → run, see fail → implement signature in named file → run, see pass → commit) with expected output. Self-review for spec coverage, type consistency, proportion. Then offers Subagent-driven vs Native execution. |
| **executing-plans** | "Native" inline execution in the current session: worktree, per-plan ledger file, pre-flight interface-conflict scan, TDD per task, completion script writes ledger line only when tests pass; one whole-branch fresh-context review at the end on the most capable model. |
| **subagent-driven-development** | Fresh subagent per task with a task brief (no session history, no nested subagents); implementer reports DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED; reviewer returns spec-compliance *and* code-quality verdicts; fix loop up to 5 rounds (1-3 same implementer, 4-5 fresh stronger model), then controller adjudicates; final whole-branch review; controller never edits code itself. |
| **test-driven-development** | "Iron Law": no production code without a failing test first; if code was written before its test, delete it and don't reuse it as reference; red-green-refactor; rationalization table; run full suite before claiming done; bug fixes start with a reproducing test. |
| **systematic-debugging** | Four phases (root-cause investigation, pattern analysis, single hypothesis + minimal test, implementation with failing test first); "NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST"; after 3 failed fixes stop and question the architecture with the human. Supporting docs: root-cause-tracing, defense-in-depth, condition-based-waiting. |
| **verification-before-completion** | Gate before any "done/fixed/passing" claim or commit/PR: identify the proving command, run it fresh, read full output incl. exit code, compare to claim, only then claim. Tests zero failures, lint, build, bug repro, red-green regression test, inspect agent diffs yourself. |
| **requesting-code-review** | Dispatch a `general-purpose` reviewer subagent with the `code-reviewer.md` template filled with description, plan/requirements, BASE_SHA/HEAD_SHA; mandatory after each SDD task, major features, and before merge; Critical fix now, Important fix before proceeding, Minor note. |
| **receiving-code-review** | Verify feedback against the codebase before implementing; no performative agreement or gratitude; push back with technical reasoning (YAGNI, breaks existing behaviour, reviewer lacks context); one item at a time; reply in GitHub inline threads. |
| **using-git-worktrees** | Isolated workspace before feature work: prefer native worktree tooling; directory priority user-declared > existing `.worktrees`/`worktrees` > default `.worktrees/`; verify git-ignored (add and commit if not); install deps; run baseline test suite and report. |
| **finishing-a-development-branch** | Run full suite (stop if red), detect repo/worktree/detached state, confirm base branch, offer merge locally / push + PR / keep; discard only on explicit request with a typed confirmation word; clean up only worktrees it created, never `--force` without approval. |
| **dispatching-parallel-agents** | For 2+ independent problems: group by area, write a focused brief each (scope, goal, constraints, expected output), dispatch all in one response, integrate and run the full suite. |
| **writing-skills** | How to author/test skills (format above). |
| **diagnosing-superpowers** | Forensics on a session where the workflow misbehaved (skills not firing, ignored plans, high cost): locate transcripts, parallel analyst subagents across 7 dimensions, evidence-cited report, optional redacted bundle and GitHub issue. |

The README groups them: Testing (TDD), Debugging (systematic-debugging, verification-before-completion, diagnosing-superpowers), Collaboration (the rest), Meta (writing-skills, using-superpowers). Community add-on modules exist as `superpowers-*` repos; new skills are generally *not* accepted into core.

## 4. Workflow it imposes, idea to merged PR (README "Basic Workflow")

1. **brainstorming** — clarify intent, write spec, human approves (gate).
2. **using-git-worktrees** — isolated branch/dir, baseline tests.
3. **writing-plans** — 2-5-minute tasks with exact paths and verification; human reviews plan and picks execution mode.
4. **subagent-driven-development** or **executing-plans** — run the plan; TDD enforced inside each task.
5. **requesting-code-review** — review between tasks; Critical/Important block progress.
6. **finishing-a-development-branch** — tests, then merge / PR / keep.

## 5. Subagents, plans, verification, human checkpoints

- **Subagents:** fresh context per task, briefed from the plan file (artifacts passed as files, not pasted text, to keep the controller small); subagents never see session history and never spawn their own. Model per role: cheap for mechanical, standard for integration, most capable for architecture/final review. Memory/skill searches also go to subagents so dead ends don't pollute main context.
- **Two-stage review:** v4.0 used two separate reviewer agents (spec compliance, then code quality). v6.0.0 (June 2026) merged them: "The two per-task reviewer prompts became one" — a single reviewer must return *both* a spec-compliance verdict and a quality verdict, plus one whole-branch review at the end. Severity Critical / Important / Minor; Minor is deferred to the ledger.
- **Plans:** see writing-plans row; v6.4.2 changed plans to "record decisions instead of full code" (planning time ~¼, tokens ~⅓). "A plan longer than the code it describes has written the code."
- **Ledger:** `.superpowers/sdd/` progress ledger (introduced v6.0.0, plan-scoped since v6.2.0) is the recovery map after compaction; same format for both executors so a plan can switch mode mid-flight.
- **Verification:** TDD red-green per step with `Expected:` lines, completion script that only logs success on green, verification-before-completion gate, final fresh-context review, full suite before finish.
- **Human checkpoints:** brainstorm skip/continue, visual companion offer, builder-check open questions, spec approval, plan approval + execution-mode choice, integration choice at finish, typed confirmation for discard. During execution, check-ins are explicitly *discouraged*; stop only for irreversible/destructive ops, security-sensitive actions, side effects outside the worktree (merge, push to shared branch, publish), or a plan so broken every path is a guess. Starting on main/master requires explicit consent. Every judgement call is recorded as a "ruling" and listed in the final message so the human can undo it.

## 6. Install and keeping current

Claude Code:
```
/plugin install superpowers@claude-plugins-official
```
or
```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```
Requires Claude Code ≥ 2.0.13 (launch post). Updates come through the plugin marketplace mechanism ("somewhat coding-agent dependent, but are often automatic"). Must be installed separately per harness. Optional telemetry: a logo in the brainstorming visual companion reports version; opt out with `SUPERPOWERS_DISABLE_TELEMETRY`, and it honours `DISABLE_TELEMETRY` / `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. Enterprise support via Prime Radiant. Release cadence is brisk: v6.0.0 16 Jun 2026 → v7.0.0 10 Oct 2026, roughly every 2-6 weeks.

## 7. Reception

Praise: forced planning makes features "so much more correct than with stock Claude Code" (Evan Schwartz review, 50 HN points, Apr 2026); users feel safer not re-reading code because they approved a plan; consistent output on large projects and portability across vendors; one 12-session A/B reported ~14% fewer tokens and better quality on most tasks; users who turned it off re-enabled it within a day; TDD-as-spec limits over-engineering.

Criticism: "a bit bloated"/token-heavy, especially the full brainstorm→plan→execute pipeline and visual brainstorming; with Fable 5 pricing (~2x Opus) one user called it "a good way to waste a day of tokens"; overlap with native Claude Code plan mode, skills, marketplace and subagents; Claude becomes "incredibly verbose about simple things"; overkill for one-file edits, prototypes and config changes; editing a plan tends to regenerate the whole thing; TDD enforcement really does delete code written before a test; inconsistent skill activation in subagent sessions (known issue) and models guessing skill contents from descriptions (mitigated in v4); supply-chain "curl|bash" worry about executing third-party instructions; some say Claude makes *more* mistakes with it; the author's own v5+ guidance says prefer your CLAUDE.md/AGENTS.md over its internal instructions. Common workaround: use the full pipeline only for new features and refactors.

Star counts are inconsistent across sources (40k in Feb 2026 writeups, ~93k–200k+ elsewhere; GitHub page rendered "299.6k" to the fetcher, which may be unreliable) — treat as "very popular, exact number unverified".

## 8. Licence

MIT, "Copyright (c) 2025 Jesse Vincent" (https://github.com/obra/superpowers/blob/main/LICENSE).

## URLs read

- https://github.com/obra/superpowers (README)
- https://raw.githubusercontent.com/obra/superpowers/main/README.md
- https://github.com/obra/superpowers/tree/main/skills
- https://raw.githubusercontent.com/obra/superpowers/main/skills/{using-superpowers,brainstorming,writing-plans,executing-plans,subagent-driven-development,test-driven-development,systematic-debugging,verification-before-completion,requesting-code-review,receiving-code-review,using-git-worktrees,finishing-a-development-branch,dispatching-parallel-agents,writing-skills,diagnosing-superpowers}/SKILL.md
- https://raw.githubusercontent.com/obra/superpowers/main/hooks/hooks.json
- https://raw.githubusercontent.com/obra/superpowers/main/hooks/session-start
- https://raw.githubusercontent.com/obra/superpowers/main/.claude-plugin/plugin.json
- https://github.com/obra/superpowers/releases
- https://github.com/obra/superpowers/blob/main/LICENSE
- https://github.com/obra/superpowers/tree/main/docs
- https://blog.fsck.com/2025/10/09/superpowers/
- https://mcp.directory/blog/superpowers-skill-worth-it-2026
- https://www.heyuan110.com/posts/ai/2026-02-01-superpowers-deep-dive/
- Search-result summaries (not fetched in full, 403/404): https://pub.towardsai.net/i-installed-40-claude-skills-three-survived-29fe64f802ec, https://blog.fsck.com/2025/10/27/skills-for-claude/ (404)

No local files were modified.
