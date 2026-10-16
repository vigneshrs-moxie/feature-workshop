# Phase 2 handoff (written 2026-10-15 by Claude Fable 5.1 for Claude Opus 5.5)

The user starts phase 2 by sending one secret keyword: **hammertime** (a message that is only that word). When you get it, do this, in order, and nothing else first.

## 1. On the keyword

1. Read this file, then `phase-2-plan-2026-10-15.md` (the plan, v1, **not yet approved**), then `redesign-2026-10-14.md` section 3 and decisions 7–10, then `phase-2-facts-2026-10-15.txt` (code facts with file:line, gathered 2026-10-15; verify a line before relying on it).
2. Give the user a short plain overview of the plan (under 300 words) and its five decisions D1–D5, one line each with the recommendation. Ask for a yes on the plan and on each decision. **Do not build before the yes.** Every plan needs the user's explicit approval (their standing rule); the one exception is L0 tweaks, which is what phase 2 itself implements.
3. After the yes: create branch `redesign/phase-2` off `redesign/phase-1` in the worktree `~/Projects/feature-workshop-phase1` and build the steps in order, one commit per step, with an independent review after steps 2, 4, 6 and 8 (same shape as phase 1: `~/.claude/projects/-Users-moxie-Projects-moxie-portal-vrs-app/40cd4e70-d84e-482c-9b9a-aa2914fdea56/workflows/scripts/redesign-phase-1-wf_81b31614-1b1.js` is the phase 1 orchestration script; copy its shape, swap the brief and steps).
4. Finish with `docs/plans/phase-2-gate.md` and screenshots, then tell the user it is ready for the gate. Do not push, do not merge.

## 2. Where things are

- Dashboard repo: `~/Projects/feature-workshop` (main, a live dashboard may be running from it: **never edit there, never restart it**). Phase 1 + themes: worktree `~/Projects/feature-workshop-phase1`, branch `redesign/phase-1`, head `e061672`, 28 commits ahead of main, unpushed. GitHub `vigneshrs-moxie/feature-workshop` (fork = `origin`; push only when the user asks).
- Public workflow repo (skills and agents shared with teammates): `~/Projects/claude-feature-workflow`, GitHub `vigneshrs-moxie/claude-feature-workflow`. Step 3 edits live here. The user's own `~/.claude/skills/feature/*` are plain copies, not symlinks (see plan D4).
- Design doc: `docs/plans/redesign-2026-10-14.md` v0.3. Phase 1 plan and gate notes: `phase-1-plan-2026-10-15.md`, `phase-1-gate.md` (component list, token sheet, how to run the demo). Themes: `docs/design/themes-2026-10-15/README.md`, `web/src/theme/THEMING.md`.
- Workflow draft (on hold, do not implement): `workflow-draft-2026-10-15.md`.

## 3. How to run and check (costs no Claude usage)

```sh
cd ~/Projects/feature-workshop-phase1
npm run web:build && PORT=4479 npm run demo     # fake Foreman, invented jobs → http://127.0.0.1:4479/next/
npm test && npm run web:test && npx tsc --noEmit -p web && npm run web:build
```

Phase 1 numbers at handoff: node 120/120, web 218/218, tsc clean, build ok. Headless Chrome via CDP works for screenshots (launch Chrome with your own `--remote-debugging-port` and `--user-data-dir`, record the PID, stop by PID).

## 4. The user's standing rules (from memory; all still in force)

- Ask before acting. No tests or checks that could use Claude usage; `npm test`, Vitest and the demo are free and fine. Never run `npm start` or the real SDK in tests. Never use real jobs or real features in tests or demos; invented ones only.
- Every plan (quick, provided, revised, your own) needs an explicit yes. Approved test plans pre-approve read-only checks.
- Push and PR only to the fork `origin`, never the moxie org repo, and only when asked. Branches for Orbit come off `moxie/main`; this is not Orbit.
- Every new dashboard feature gets a brief in-UI explanation for new teammates (hover hints, a folded "How this works").
- Short plain overviews, "less verbosity but full information". The user talks only to the Foreman in the product; mirror that in the UI.
- Edit files with Edit/Write only (no sed, python or heredoc edits). `git -C <worktree> …`, join commands with `&&`. Never `pkill`/`killall`; stop processes by exact PID. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` when you are Opus.
- Deferred by the user, do not raise it again unless they do: whether their own message asking for a push should count as the yes for that push.

## 5. Known gaps carried over from phase 1 (fix only if cheap while you are in the file)

- "How this works" boxes start open and are long; the user wanted them folded by default once read.
- Steer was tested with the fake Foreman only; usage-limit pause was not walked live.
- Hard lines ask even when the user's message asked for the action (deferred, see above).
