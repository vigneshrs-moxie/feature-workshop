# Packet Q · Review rounds: changes asked for, fixed, pushed, reviewed again, merged

**Goal.** The part of shipping that isn't the happy path. Very often Raj reviews a pull request and asks for changes. Today that is hard: packet N turns each failed check or comment into its own card and can send it to the Foreman, but the Foreman is told not to push and not to reply, and nothing helps with what comes after: pushing the fix through the fork, getting it onto the PR Raj is looking at, answering each of his comments, asking him to review again, and getting it merged. Vignesh (2026-10-29): "lets plan for these cases and make it super easy to address them using ai and fix and push and ask for review and eventually get it merged, we want this whole flow to be intuitive and easy for the user." This packet makes one **review round** the unit: everything a reviewer asked for in one go becomes one item, the Foreman works through it with AI, and one go / no go sends it all back. It also gives the GitHub check and refresh that already exists (packet N, `FlowWatch`) a proper, out-of-the-way home in the new design.

**Port 4489 · worktree `../ground-control-Q` · branch `packet/Q-review-rounds`. Skill repo: worktree `../claude-feature-workflow-Q`, branch `packet/Q-review-rounds`. Depends on N (merged) and M (the new screens); starts after M is merged, beside K2 and P, and merges after K2.** Wireframes first (step 1): no screen code until Vignesh has approved them.

## What exists
- **Packet N** (merged): `dashboard/lib/git.js` read-only `gh` helpers (`prChecks`, `prComments`, `failedLog`); `dashboard/lib/pr-feedback.js` `findNew` (each failed check or comment once, kept in the job's `pr-feedback.json`); the feedback card in `dashboard/lib/driver.js` ("Send it to the Foreman" / "Leave it", resumes with kind `pr-feedback`: "… Fix it on this branch, run the tests, and commit. Don't push." and "… Don't push, and don't reply on GitHub."); the audit lines and thread notes.
- **`dashboard/lib/flow.js`** `FlowWatch`: reads every repo's PRs with `gh pr list` every ten minutes (`NETWORK_EVERY_MS`) and on `POST /api/flow/refresh`; each PR has `review` (`approved`, `changes_requested`, `review_required`) and its checks. The only Refresh button is on the old Flow map (`web/src/home/`, `useFlow.ts`), which M keeps under the gear, out of sight.
- **The ship route** (`skills/ship/SKILL.md`, Orbit's `prRoute` in `dashboard/profiles/orbit.md`): PR #1 fork branch → the same-named branch on moxie (Vignesh reviews and merges it), PR #2 moxie branch → staging (**Raj reviews it**), PR #3 staging → main. "Sync: PR #2 conflicts with staging" is a written procedure (`staging-conflicts.md`). So a change Raj asks for on PR #2 has to travel: a commit on the fork branch → push to the fork → a follow-up PR #1 into the moxie branch → merged → PR #2 shows the new commits → Raj is asked again.
- **The hard lines** (`dashboard/lib/hard-lines.js`): pushes, PRs and merges always ask (or need the job's auto-mode go-ahead for pushes and PRs); org and force pushes are refused.
- **M's design**: the Job map's Ship stop with PR #1 to PR #3 as small steps, the Stage screen, the Desk, the four lanes (In review: a PR waiting on others; Ready to merge: checks green, approvals in), the permission alert.

## Owns
`dashboard/lib/review-round.js` (new: rounds from N's items and the PR's review state), `dashboard/lib/gh-write.js` (new: the only code that writes to GitHub, each call behind a yes), the round card and its kinds in `dashboard/lib/driver.js` (beside N's card, which it groups), the wiring in `dashboard/runner/index.js` (one block next to N's) and `dashboard/lib/flow.js` (the faster refresh while waiting, step 6), `dashboard/site/routes-review.js` (new) and its line in `dashboard/site/index.js`, `dashboard/lib/thread.js` (the round's notes), the round's fields in `dashboard/lib/status-schema.json` and `status-json.js` (`prs[n].rounds`), the review lines in `dashboard/profiles/orbit.md` (who reviews each PR, who merges), `web/src/views/Review/` (new: the round panel), the round card on the Desk and the Ship stop's panel on Job and Stage (M's files: add, don't restyle), the GitHub line (step 7) in M's Jobs header and Ship stop, the round's keys in `keyRegistry.ts`, its types in `web/src/api/types.ts`, the wireframe page this packet draws (outside the repo, by the wireframe skill), `dashboard/test/review-round.test.js`, `dashboard/test/gh-write.test.js`, `dashboard/test/review-round-server.test.js` (new). In the skill repo: `skills/ship/SKILL.md` ("After opening" becomes "Review rounds"), `skills/ship/review-rounds.md` (new), `skills/ship/pr-body.md` (the follow-up PR #1 body and the Decisions line O asked for).

## Steps
1. **Wireframes first.** With the `wireframe` skill, hi-fi, in the approved Ground Control screens design (`~/.claude/wireframes/feature-workshop/ground-control-screens.*`, same cache), draw the round from start to end, every state below, in Play full, subtle and off, with the phone width. Draw where the GitHub line lives. Two options side by side where there is a real choice (for example: one round card on the Desk against a review panel on the Job's Ship stop as the main place; a reply drafted per comment against one summary reply). Publish, send Vignesh the link, stop until he has reviewed it, and build only what he picks.
2. **The round** (`review-round.js`). A round is everything one reviewer asked for in one review, plus the failed checks on the same head commit:
   - From GitHub: a review with "Request changes" (and its comments), plain comments on lines, a general comment, and failed checks. Comments that arrive within ten minutes of each other from the same person join the same round. A new review after a push starts the next round.
   - Each item has a kind (**change**: asks for a code change; **question**: asks something; **nit**: small and optional; **check**: a failed check), the file and line, the quote, and its state: To do, Fixed (with the commit), Answered (with the reply), Won't change (with the reason), Skipped.
   - The kind is a first guess by the Foreman when it reads the round; the person can change it on the card.
   - Outdated comments (their line changed since) are marked as such, not dropped.
   - Rounds and their items live in `status.json` `prs[n].rounds` and in the job's `review/rounds/round-<n>.md`, so the Foreman, the page and a person in the terminal read the same thing.
   - N's single-item cards stay for a lone comment or a lone failed check; a round replaces them when there is more than one item from one review.
3. **Fix with the Foreman** (one yes). The card: "Raj asked for changes on PR #2 · 4 comments, 1 question". Its main action, **Fix with the Foreman** (`a`), resumes the job's session (kind `review-round`) with the whole round, and asks the Foreman to:
   - say per item what it will do (fix, answer, won't change and why), before changing anything;
   - make the fixes on the fork branch in the job's worktree, one commit per item or per small group, each commit message naming the comment it answers;
   - run the checks the profile names (Orbit: `npm run check`) and the tests the change touches;
   - draft a reply for every item ("Fixed in a1b2c3d: renamed to `feedbackId`." / "Kept as it is: … because …" / the answer to a question), short, polite and specific;
   - not push, not reply on GitHub, not merge: those wait for step 4.
   The person can untick items before sending ("Leave the nit about naming"), and add a note for the Foreman. While it works, the round's items tick over one by one on the panel (To do → Fixed), in words.
4. **Send it back** (one go / no go, every part listed first). When the Foreman is done, the card becomes "Round 1 is ready to send back" and lists, in order, exactly what the one button will do, each line in plain words:
   1. Push 3 commits to your fork (`origin/<branch>`).
   2. PR #2 is Raj's, from the moxie branch: open the follow-up PR #1 (fork → moxie, body from `pr-body.md`, "Follow-up for Raj's review on PR #2"), then merge it once its checks pass (you review and merge PR #1, as always: this is your yes for that merge too, or "I'll merge PR #1 myself" to stop there).
   3. Reply on GitHub to each comment with the drafted text (each one shown, editable, and droppable).
   4. Mark the fixed comments resolved (only the ones Fixed, never Answered or Won't change).
   5. Ask Raj to review PR #2 again.
   The button is **Send back to Raj** (go), with **Not yet** (no go) beside it. Every write goes through `gh-write.js`, one call per line, each logged in the audit with its result; any line that fails stops the rest and says which and why, with **Try again from here**. Nothing is force-pushed, ever. When PR #1 is the one under review (no follow-up needed), line 2's follow-up is left out. The words come from the profile's `prRoute`, so another repository's route reads right.
5. **The unhappy paths**, each a state on the same panel with one next action:
   - **A check fails after the push**: "lint failed on the push for round 1" → Fix with the Foreman (the same loop, with the log, N's `failedLog`).
   - **The base moved and now conflicts** (staging changed under PR #2): "PR #2 conflicts with staging in 2 files" → **Bring in staging with the Foreman**, which follows the ship skill's "Sync" procedure and then the same Send back.
   - **The reviewer comments again** while the Foreman is still on round 1: the new items join round 1 if it hasn't been sent back, else they open round 2.
   - **A question only, no change**: Send back has just the replies and the review request; nothing is pushed.
   - **You disagree with an item**: Won't change, with the reason the Foreman drafts and you edit; it's still replied to.
   - **The approval was dismissed by the push** (GitHub drops approvals on new commits in some repos): the lane says "Approval reset by your push: waiting on Raj again".
   - **The reviewer isn't there** (out, or no reviewer set): "No one has been asked to review PR #2" → Ask for a review, with the profile's reviewer filled in.
   - **The PR was closed without merging**: the job says so and offers Reopen the PR or Mark the job dropped.
   - **The lock is held in a terminal**: as everywhere, the card says so and its buttons are off.
6. **Approved, then merged.** When the review turns to approved and the checks are green, the job moves to **Ready to merge** with who merges it from the profile (PR #1: you; PR #2: Raj, or you when the profile says you may; PR #3: the release owner). When you are the one: **Merge PR #2** (go / no go, a hard line: always asks). When it's someone else: "Waiting for Raj to merge" and, after a day, **Remind Raj** (a comment from you, drafted, shown before it's sent). After the merge the job goes on to the next stop (staging QA, PR #3) as today.
7. **The GitHub line, tucked away and easy** (Vignesh: "make sure that works here too but it needs to be tucked away in an appropriate place and made easy to use"):
   - One small line in the Jobs header and on the Job's Ship stop: "GitHub checked 3 min ago · Check now". Check now runs today's refresh (`POST /api/flow/refresh`) and turns into "Checking…", then the new time; on a failure it says why in words ("GitHub didn't answer. gh isn't signed in: run gh auth login") with the exact line to run.
   - Checks happen on their own: every ten minutes as today, **every minute** while a job is waiting on a reviewer or on its checks after a push, and right after any push or reply from step 4.
   - The old Flow map's Refresh keeps working where M left it.
   - Settings → Workflow gets "How often to check GitHub" (every 1, 5, 10 or 30 minutes while waiting; default 1) next to the finish line.
8. **The skill.** `skills/ship/SKILL.md` "After opening" becomes "Review rounds": what a round is, the per-item plan, one commit per item, drafted replies, never pushing or replying without the yes, the follow-up PR #1 for changes on PR #2, and the Sync procedure for a moved base. `review-rounds.md` holds the reply style and examples. `pr-body.md` gets the follow-up PR #1 body and the "Decisions: docs/decisions/…" line (packet O's request).
9. **Tests**, with fixture `gh` outputs and a fake `gh` that records what would be written, no network and no model:
   - `review-round.test.js`: one review with four comments makes one round; a comment ten minutes later joins it; a review after a push makes round 2; outdated comments are kept and marked; N's lone-item cards still work.
   - `gh-write.test.js`: each write is the exact `gh` call; none can force-push; a failure stops the rest and names the line; nothing runs without the yes.
   - `review-round-server.test.js`: a demo dashboard with a fake `gh`: Raj's "Request changes" → one card on the Desk → Fix with the Foreman resumes the same session with kind `review-round` → Send back pushes, opens and merges the follow-up PR #1 (fake), replies, resolves the fixed ones and re-requests Raj, in that order, each in the audit; a failed check after the push opens the check state; approved → Ready to merge; Merge asks.
   - Web tests for each state in the approved wireframe, the keys, and the GitHub line (Check now, Checking…, the failure words).

## Acceptance
Raj's "Request changes" on PR #2 becomes one round, one card. One yes has the Foreman plan, fix, commit and draft replies; one go pushes, gets the fix onto PR #2 through the follow-up PR #1, replies to each comment, resolves the fixed ones and asks Raj again, with every step listed before the button and logged after. A failed check, a moved base, a new comment, a question-only round, a disagreement, a reset approval, a missing reviewer and a closed PR each show one plain next action. Approved jobs reach Ready to merge with who merges named; merging always asks. "GitHub checked … · Check now" is in the Jobs header and the Ship stop, and checks run every minute while waiting. Nothing is written to GitHub without a yes; nothing is force-pushed. The screens match the approved wireframe in all three Play modes. All tests green, no model calls.

This needs Vignesh for the real run: a PR Raj has asked changes on (or a practice PR on the fork where Vignesh plays Raj), and his yes on every push, merge and reply.

## Verify
```
PORT=4489 npm start   # demo: a job on PR #2 with a fake "Request changes" review; go through the round to Ready to merge
npm test && (cd web && npx vitest run)
```

## Rules that apply to every packet (read once, obey always)

- **Base:** `main` of the Ground Control repo after M is merged.
- **Worktree and branch:** `git worktree add ../ground-control-Q -b packet/Q-review-rounds main` from the main checkout, and `../claude-feature-workflow-Q` from `~/Projects/claude-feature-workflow`. Work only there.
- **Port:** `PORT=4489 npm start` in the worktree. **Never use 4477 (Vignesh's live dashboard), 4479 (his demo) or 4485 (his test server).** The screens server takes `<port>+1`.
- **Owned files only.** Touch nothing outside the "Owns" list. If you need a change elsewhere, write it under "Needs from others" in your hand-back and stop at that point.
- **Tests:** `npm test` and `cd web && npx vitest run`, both green before hand-back. **No model calls in tests** (`WORKSHOP_DEMO=1`, a fake `gh`); server tests use `startDashboard()` from `dashboard/test/helpers/dashboard.js`. **Nothing in a test or a demo writes to a real GitHub.**
- **Never push, never open a PR, never merge** from this packet's own work: commit locally, one commit per step, plain messages. Hand back the branch name and the last SHA.
- **Status is never shown by colour alone; themes change looks only; keys never fire while typing or with a dialog open.** Use the theme tokens. The product name comes from `brand.ts` / `PRODUCT`.
- **Plain words** in every string a person reads. No jargon.
- **Hand-back format:** packet id, branch, last SHA, what was done per step, test output tail, anything not done and why, "Needs from others".
