# Packet F · Facts up front in review prompts

**Goal.** Each review lens gets the diff, the spec, the plan and the recent commits pasted into its prompt instead of fetching them itself, so reviews finish in fewer turns and never disagree about the range (plan D13). Skill repo only.

**No port · worktree `../claude-feature-workflow-F` of `~/Projects/claude-feature-workflow` · branch `packet/F-facts-up-front-review`.**

## What exists
- `skills/feature/review-lens-rules.md`: lenses take "the diff range in your prompt (read-only git only), the spec, the implementation plan and test plan, and the layer checklists" and read the diff themselves.
- `agents/feature-review-*.md` and `agents/feature-reviewer.md`: the lens agents (tools: Read, Grep, Glob, Bash, Write).
- The Foreman's review stage in `skills/feature/SKILL.md` dispatches the lenses in parallel and reads `review/<lens>.md`.

## Owns
`skills/feature/review-lens-rules.md`, `agents/feature-review-*.md`, `agents/feature-reviewer.md`, the review stage text in `skills/feature/SKILL.md`, and a new `skills/feature/review-facts.md` describing the facts block.

## Steps
1. Define the facts block the Foreman builds once per review: commit sha, base, `git diff --stat`, the full diff when under 1,500 lines (else the diff of the files that match the lens's axis, and the stat for the rest), the spec, the implementation plan's step list, the last 10 commit subjects, the acceptance criteria. Written to `review/facts.md` in the job folder.
2. Lens prompts: "Your inputs are in the facts block below; do not run `git diff` or `git log`; read surrounding code with Read only." Keep Bash for running checks the lens is allowed to run; say which.
3. The Foreman writes `review/facts.md` once, then pastes it into every lens dispatch.
4. The report header keeps `commit <sha> · diff <range>` so the gate card's proof stamp still matches.
5. Check with the skill's own checks (see the repo README) and a dry run on a sample job folder in `~/.claude/feature-work/` (read-only; no model calls).

## Acceptance
Every lens prompt carries the facts block; lens agent files no longer tell the lens to run `git diff`; the proof stamp fields are unchanged. The skill's checks pass.

## Verify
```
# in the skill worktree: the repo's check script (README), then grep:
grep -rn "git diff" agents/feature-review-*.md   # expect no instructions to run it
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
