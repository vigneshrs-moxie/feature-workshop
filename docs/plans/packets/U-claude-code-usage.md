# Packet U · Claude Code use outside the app, in Telemetry

**Goal.** Telemetry counts your own Claude Code use outside the app by name, read from Claude Code's own session logs on this computer, instead of folding it into the estimated "Other use". Asked for by Vignesh on 2026-10-29: "for the telemetry, we can choose to only take claude code usage from claude directly since any other usage is usually not me or sohum. idk if this helps telemetry calculations for the charts."

**Why it helps.** The plan's meters count everything on the Claude account. Today the app sees only its own jobs (`~/.ground-control/usage.jsonl`), so everything else is "Other use, estimated". Claude Code writes every session to `~/.claude/projects/<folder>/<session>.jsonl`, with each reply's model and token usage. The app already parses these files for its own jobs (`dashboard/lib/session-log.js`). Reading all of them gives:
1. **Your terminal Claude Code use by name:** "Vignesh · in the app 15% · in Claude Code 9%".
2. **A smaller, truer "Other use":** what's left is claude.ai, the Claude app and other people's use. Vignesh says that is usually not him or Sohum, so it is labelled "Other use (claude.ai, the Claude app, other people)".
3. **A better percent per dollar:** `percentPerDollar` only trusts short stretches where it knows all the spend. Terminal sessions were the main unseen spend on this computer, so more stretches qualify and fewer are wrong.

**Limits, said on screen:** only this computer's logs are read. A teammate's terminal use on their own computer stays in Other use until they run the app too, or the team site (v2) exists.

**Port 4497 · worktree `../ground-control-U` · branch `packet/U-claude-code-usage`.** Server side now, beside R and S. The Telemetry page's few words and its new segment wait for R to be merged (R is restyling Telemetry), as the second step.

## Owns
- `dashboard/lib/claude-code-usage.js` (new): the reader and its cache.
- `dashboard/lib/telemetry.js`, `dashboard/lib/insights.js`.
- `dashboard/site/routes-telemetry.js`.
- The `read.telemetry` lines in `dashboard/runner/index.js`.
- `dashboard/test/claude-code-usage.test.js` (new), `telemetry.test.js`, `insights.test.js`.
- The Telemetry shapes in `web/src/api/types.ts`.
- **Step 2 only, after R is merged:** `web/src/views/Telemetry*`.

## Steps
1. **The reader** (`claude-code-usage.js`):
   - Stream each `~/.claude/projects/**/*.jsonl` changed in the last 100 days, including sub-agent files, and keep only what Telemetry needs from assistant replies with usage: time, model family, the four token counts, session id, and whether it is a sub-agent. Never the text, prompts, tool input or file names.
   - Count each reply once. Claude Code can write the same message id on several lines while streaming; take the last.
   - Cost each reply with `lib/cost.js` prices.
   - Leave out every session that belongs to one of the app's own jobs, so it is never counted twice. Match by session id against `usage.jsonl` and the jobs' known sessions, and by the job worktrees' folders.
   - Leave out the demo's and tests' temp folders (the `isTemp` rule).
   - The person is this computer's user (`groundControlUser`).
   - **Cache** per file by size and modified time in the state folder, so a refresh reads only new bytes (the logs on Vignesh's Mac are about 320 MB). The first full read happens in the background and must not block the page: Telemetry says "Reading Claude Code's logs…" until it's done.
   - Setting: Settings → Workflow → "Count my Claude Code use outside the app" (on by default). With it off, Telemetry is as today.
   - **Tests** use fixture folders: duplicate message ids, sub-agent files, a job's own session left out, a temp folder left out, a file that grows between reads (only the new part is read), a malformed line skipped, and no text or file names in the output.
2. **Into Telemetry:**
   - `percentPerDollar` and `limitSplit` count the outside spend too, as known spend.
   - `limits.people[]` gets per-person parts `{ user, app, claudeCode }`.
   - `other` is what's left, labelled "Other use (claude.ai, the Claude app, other people)". It is still marked estimated.
   - Graph 5 (People on the account) and graph 9 (when the limit goes) include it.
   - Graphs about the app's own jobs (cost per ticket, by stage, rework) don't.
   - **Tests:**
     - a stretch with only terminal use is now attributed by name, not to Other;
     - the ratio from short stretches improves on a fixture where terminal use sat between readings;
     - with the setting off, the result is the same as today.
   - **The page**, after R is merged: the "Who used this week's limit" line splits each person into "in the app" and "in Claude Code", each with a pattern and in words, and the Other use note gets its new words. Follow R's components and the design philosophy.

## Acceptance
- Your terminal Claude Code use shows by name on Telemetry and is never counted twice with the app's jobs.
- Other use is smaller and labelled with what it now means.
- Percent per dollar uses the extra known spend.
- Only usage numbers are kept: never text, prompts or file names.
- The first read doesn't block the page, and later reads read only what's new.
- A setting turns it off.
- All tests are green, with no model calls, and nothing reads the real `~/.claude` in tests.

## Rules that apply to every packet (read once, obey always)
- **Base:** `main`. **Worktree:** `git worktree add ../ground-control-U -b packet/U-claude-code-usage main`.
- **Port:** 4497 (screens 4498).
  - **Never use 4477, 4479 or 4485.**
  - Leave 4481, 4483, 4487, 4489, 4491, 4493 and 4495 alone.
- **Owned files only**; anything else goes under "Needs from others". R is restyling web/src and S is building the 3D floor at the same time.
- **Tests:** `npm test` and `cd web && npx vitest run` (and `npx tsc --noEmit -p .`), green before each commit. **No model calls in tests.**
- **Never push, never open a PR, never merge.** One commit per step, plain messages.
- **Status is never shown by colour alone. Plain words. No product name** (use `PRODUCT`/`BRAND`).
- **Privacy:** reading `~/.claude/projects` for real is allowed only in the running app, never in tests. Only usage numbers ever leave the reader.
- **Hand-back format:** packet id, branch, last SHA, what was done per step, test output tail, anything not done and why, "Needs from others".
