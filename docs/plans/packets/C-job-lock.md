# Packet C · Job lock

**Goal.** One job is driven by one process at a time: the runner or a terminal `/feature` session, never both (plan D12). A dead process's lock is taken over.

**Port 4483 · worktree `../ground-control-C` · branch `packet/C-job-lock`.**

## What exists
- Job folders `~/.claude/feature-work/<slug>/`; the driver opens a job by slug (`dashboard/lib/driver.js`); closing is in `dashboard/lib/close.js`.
- The skill's `SKILL.md` describes how a terminal session starts a job; it has no lock today.
- Sandcastle's lock (reference only): `{"pid","branch","acquiredAt"}` written with `O_EXCL`, taken over if the pid is dead.

## Owns
`dashboard/lib/lock.js` (new), the open/close call sites in `dashboard/lib/driver.js` and `dashboard/lib/close.js` (two small edits each), `dashboard/test/lock.test.js` (new), the lock card in `web/src/views/` (one small component, "This job is open in a terminal (pid N, since T)"), and in the skill repo (worktree of `~/Projects/claude-feature-workflow`, branch `packet/C-job-lock`): a short "Lock" section in `skills/feature/SKILL.md` and a `lock.py`-free rule: the terminal session writes the same file with the shell (`set -o noclobber` on POSIX, `New-Item -ItemType File -ErrorAction Stop` on PowerShell), checked at start.

## Steps
1. `acquire(jobDir, { owner: "runner"|"terminal", pid, branch })` writes `lock.json` with `wx`; on `EEXIST` read it, check the pid (`process.kill(pid, 0)`; on Windows `tasklist /FI "PID eq N"`), take over if dead, else return `{ held: true, by }`. `release(jobDir)` removes it only if the pid is ours. Stale after a reboot is covered by the dead-pid rule.
2. Driver: acquire on open, refuse with the card when held; release on close, stop and error exits. Heartbeat is not needed; pid liveness is the rule.
3. Skill: the terminal session creates the lock at start and removes it at the end; if it exists and the pid lives, it says so and stops.
4. Tests: acquire, held by a live pid, takeover of a dead pid, release only by owner, Windows path guarded by `process.platform`.

## Acceptance
`lock.json` with pid, branch, time; a second driver refuses with a clear card; a dead pid is taken over; released on close. All tests green.

## Verify
```
PORT=4483 npm start
npm test
```


## Rules that apply to every packet (read once, obey always)

- **Base:** `main` of the Ground Control repo (today `~/Projects/feature-workshop`, to be renamed `ground-control`) after Vignesh has fast-forwarded `redesign/orbit-ready` into it. If `git log main..redesign/orbit-ready` is not empty, stop and tell Vignesh; do not base on `main` then.
- **Worktree and branch:** `git worktree add ../ground-control-<id> -b packet/<id>-<name> main` from the main checkout. Work only there.
- **Port:** run the dashboard with `PORT=<port> npm start` in the worktree. **Never use 4477 (Vignesh's live dashboard) or 4479 (his demo).** The screens server takes `<port>+1`.
- **Owned files only.** Touch nothing outside the "Owns" list. If you need a change elsewhere, write it under "Needs from others" in your hand-back and stop at that point.
- **Tests:** `npm test` (node:test, `dashboard/test/*.test.js`) and `cd web && npx vitest run`. Both green before hand-back. **No model calls in tests:** the server under test runs with a fake query (`WORKSHOP_DEMO=1`); never import the Agent SDK in a test.
- **Never push, never open a PR, never merge.** Commit locally, one commit per step, plain messages. Hand back the branch name and the last SHA.
- **Status is never shown by colour alone; themes change looks only; keys never fire while typing or with a dialog open.** Use the theme tokens, not literal colours.
- **Plain words** in every string a person reads. No jargon.
- **Hand-back format** (paste into the integration board's notes or tell Vignesh): packet id, branch, last SHA, what was done per step, test output tail, anything not done and why, "Needs from others".
