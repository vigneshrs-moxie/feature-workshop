# Packet N · Failed checks and review comments go back to the Foreman

**Goal.** When a job's pull request gets a failed check or a review comment, Ground Control notices it, puts one **Needs you** card on the job ("A check failed on PR #1: lint. Send it to the Foreman?"), and on a yes resumes that job's own Foreman session with the failure or comment quoted, so the fix starts without anyone copying text between windows (plan §11 N). Nothing is ever sent to the Foreman without that yes, and nothing is ever written to GitHub.

**Port 4485 · worktree `../ground-control-N` · branch `packet/N-pr-feedback`. Depends on G; start after G is merged. Runs beside H and J.**

## What exists
- `dashboard/lib/flow.js` `FlowWatch` refreshes every ten minutes (`NETWORK_EVERY_MS`) and on `POST /api/flow/refresh`. `gatherRepo()` calls `gh pr list --repo <org/repo> --json ...` and reads each PR's checks into pass, fail or pending (`checksOf(rollup)`); `laneOf()` and `flowView()` place jobs. It finds a job's PR by branch name (`pickPr`). It never reads review comments or the log of a failed check.
- `dashboard/lib/git.js` is read-only git (`isGitRepo`, `headOf`, `commits`, `show`, `splitPatch`); it has no `gh` helpers.
- `dashboard/lib/driver.js` has the pattern to copy: when the Foreman writes a bad `status.json` three times, `#parkStatusCard()` parks a question card kept apart from the reply (`statusCard: true`, held in `this.statusCards`, shown with `viewPermission`, answers "Ask it to try again" or "Leave it"); a yes resumes the same session with a message of kind `status-fix` (`#sendStatusFix`). `Driver.start({ sessionId, text, kind, ... })` resumes a session; it takes the job lock and refuses with `JobLocked` when another process holds it.
- After G, the runner (`dashboard/runner/index.js`) builds `FlowWatch` and the `Driver`, and every event the page sees goes through `makeEvent` in `dashboard/lib/protocol.js`.
- `dashboard/lib/thread.js` `buildThread()` turns audit lines into the job's thread. It has notes for a usage-limit `resume` but none for `status_invalid` or a `status-fix` send, which therefore shows as if the person wrote it (left open from v1). G's `resume-after-restart` sends and its `service-stop` and `service-start` lines have no notes either.
- `dashboard/lib/orbit.js` `scrub()` and `scrubDeep()` hide token-looking text.

## Owns
`dashboard/lib/git.js` (new read-only `gh` helpers), `dashboard/lib/pr-feedback.js` (new), the feedback card in `dashboard/lib/driver.js` (beside the status card: park, answer, resume with kind `pr-feedback`), the wiring in `dashboard/runner/index.js` (one block: feed each flow refresh to the new module), `dashboard/lib/thread.js` (the notes), `dashboard/lib/protocol.js` (one new event type `pr-feedback`, if a new type is needed), `dashboard/test/pr-feedback.test.js`, `dashboard/test/pr-feedback-server.test.js` and `dashboard/test/thread-notes.test.js` (new).

## Steps
1. **Read-only GitHub helpers** (`lib/git.js`). Each takes an injectable `gh` runner like `gatherRepo` does, and none of them can write:
   - `prChecks(repo, number)`: name, state, link and the run id of each check, from `gh pr view <n> --repo <repo> --json statusCheckRollup`.
   - `prComments(repo, number)`: review comments and reviews with a body, from `gh api repos/<repo>/pulls/<n>/comments` and `.../reviews`. Each has its id, author, file and line, body, link and time.
   - `failedLog(repo, runId, { lines = 80 })`: the last lines of `gh run view <id> --repo <repo> --log-failed`.
2. **What's new** (`lib/pr-feedback.js`). `findNew({ job, pr, checks, comments, seen })` returns the failed checks and comments not seen before, so each one becomes a card once. A check that fails again after a new push counts as new (key: check name plus head commit). Comments by the person themselves, by bots that only post summaries (a short list in the file), and comments on a PR whose job is closed are skipped. `seen` is kept in `pr-feedback.json` in the job folder. The owner is the job whose branch is the PR's head branch; a PR no job owns is left alone. It runs after each `FlowWatch` refresh, so it adds no polling of its own.
3. **The card** (`driver.js`). `parkFeedbackCard(job, item)` parks a question card the same way the status card is parked: kept apart from the reply, shown in Needs you, survives a page reload, one per item.
   - Words: "A check failed on PR #1: lint." or "Ana commented on PR #1, web/src/App.tsx line 40." Then the first lines of the log or the comment, quoted.
   - Answers: "Send it to the Foreman" and "Leave it".
   - On send, the runner resumes the job's session (`Driver.start` with its `sessionId`, kind `pr-feedback`) with: "A check failed on PR #1: <name>. The end of its log is below. Fix it on this branch, run the tests, and commit. Don't push." or "<author> commented on PR #1 at <file>:<line>: <quoted comment>. Answer it on this branch: change the code, or explain in your reply why not. Don't push, and don't reply on GitHub." All quoted text goes through `scrub()` first and is cut to 4,000 characters.
   - When the job's lock is held elsewhere, the card stays and says so (plan §3 lock rules).
   - When the Foreman is already working, the message waits until the reply ends.
   - "Leave it" marks the item seen.
4. **Wiring** (`runner/index.js`): after each flow refresh, for each open job with a PR, read checks and comments, pass them to `findNew`, park a card for each new item, and write the audit lines `pr-feedback-found`, `pr-feedback-sent` and `pr-feedback-left`. The site needs nothing new: the card is a permission-style card, answered through the existing `allow` and `deny` commands.
5. **Thread notes (left open from v1, plus G's).** `buildThread()` shows plain notes instead of "you" bubbles:
   - `status_invalid`: "The Foreman's status.json didn't match the format: <first error>."
   - a `status-fix` send: "Ground Control asked the Foreman to rewrite status.json."
   - `resume-after-restart`: "Ground Control restarted and told the Foreman to carry on."
   - `service-stop` and `service-start`: one note, "Ground Control stopped at 14:02 and started again at 14:05."
   - `pr-feedback-sent`: "You sent the failed check lint on PR #1 to the Foreman."
6. **Tests.**
   - `pr-feedback.test.js`, with fixture `gh` outputs and no network: a failed check makes one card, a second refresh makes none, a failure after a new push makes a new one; a comment by the person is skipped; a PR no job owns is skipped; the resume message quotes the log and hides an `orbfb_` token.
   - `pr-feedback-server.test.js`, a demo dashboard with a fake `gh`: the card appears in Needs you, Send resumes the same session id with kind `pr-feedback`, Leave it doesn't.
   - `thread-notes.test.js`: each note in step 5, from fixture audit lines.

## Acceptance
A failed check or a review comment creates a Needs you card and, on Send, resumes the Foreman that owns the PR (plan §11 N); "Leave it" sends nothing; nothing is sent twice; nothing is written to GitHub; a job whose lock is held elsewhere is not resumed. The thread shows the notes in step 5 instead of messages the person never wrote. All tests green.

## Verify
```
PORT=4485 npm start   # a job with an open PR: make a check fail, press Refresh on Flow, answer the card
npm test && (cd web && npx vitest run)
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
