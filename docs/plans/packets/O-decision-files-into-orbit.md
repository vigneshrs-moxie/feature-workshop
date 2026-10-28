# Packet O · Decision files go into Orbit with PR #1

**Goal.** A job's `decisions.md` stops living only in the job folder: at the ship stage it is copied into Orbit's tracked `docs/decisions/` folder on the feature branch as `docs/decisions/ORBIT-0479-feedback-api.md`, and the folder's index `docs/decisions/README.md` is rebuilt in the same commit, so the decisions ride PR #1 and engineers and agents can read them in the repo later (plan G21, G22, G27, §8). Ground Control's own product decisions get the same shape in its own repo. The job's "Not doing" list is also given to the review lenses, so they don't report as missing what was left out on purpose.

**Port 4483 · worktree `../ground-control-O` · branch `packet/O-decisions-into-orbit`. Skill repo: worktree `../claude-feature-workflow-O` of `~/Projects/claude-feature-workflow`, branch `packet/O-decisions-into-orbit`. Depends on E (in v1) and on Orbit's `.gitignore` change (below); start after K is merged, since K uses port 4483 until then. Runs beside M and merges after it; it changes no web files.**

## What exists
- `dashboard/lib/decisions.js` (from v1 packet E) writes `decisions.md` in the job folder after every gate:
  - `decisionPrefix()` gives the ticket key (`ORBIT-479`) or the slug, and `decisionRows()` and `render()` build the table in the §8 format;
  - `keptParts()` keeps the Foreman's own rows (marked `<!-- foreman -->`), any `## Section: <name>` parts (filled by K for stacks) and `## Not doing`;
  - `writeDecisionsFile(jobDir, opts)` writes it; `ticketCopy()` gives the plain text for the ticket.

  Nothing writes it into a repository.
- `bin/ground-control.js` (from G and I) has the CLI commands; there is no `decisions` command.
- Orbit's `.gitignore`: on the fork checkout (`~/Projects/moxie-portal-vrs`) line 41 is `docs/`, so `docs/decisions/` is ignored today. G22 says Vignesh changes it to `docs/*` plus `!docs/decisions/` in his Portal Feedback changes; his Portal Feedback worktree's `.gitignore` already tracks `docs/`. Orbit is not this packet's to change: if `git check-ignore docs/decisions/x.md` still matches in the job's worktree, the step refuses (step 2) and you say so in the hand-back.
- The skill (`~/Projects/claude-feature-workflow`): `skills/feature/SKILL.md` (Records: the decisions.md rules; Stage notes: the PRs), `skills/ship/SKILL.md` (PR #1 steps 1 to 6: org branch, merge main, checks, self-review, body, push with a yes), `skills/feature/review-facts.md` (the facts block every lens gets: commit, range, diff, spec, plan steps, acceptance, recent commits) and `skills/feature/review-lens-rules.md`. Neither of the last two has the Not doing list (left open from v1).
- The Ground Control repo has no `docs/decisions/` folder. The plan's register is `docs/plans/2026-10-27-ground-control-decisions.md`.

## Owns
`dashboard/lib/decisions.js` (the repo copy and the index), the `decisions` command in `bin/ground-control.js`, `dashboard/test/decisions-repo.test.js` (new), `docs/decisions/0001-next-phase-register.md` and `docs/decisions/README.md` (new, in the Ground Control repo), one pointer line at the top of `docs/plans/2026-10-27-ground-control-decisions.md`. In the skill repo: `skills/feature/SKILL.md` (Records and the Ship notes), `skills/ship/SKILL.md` (PR #1, one new step), `skills/feature/review-facts.md` and `skills/feature/review-lens-rules.md` (the Not doing list).

## Steps
1. **The file name** (`decisions.js`). `repoFileName({ ticketKey, title, slug })` gives `ORBIT-0479-feedback-api.md`: the key's number zero-padded to four digits so files sort, then a short slug from the ticket's title (lowercase, words joined by `-`, at most 6 words, no ticket number twice). With no ticket it gives `null`: a job without a ticket isn't written into Orbit.
2. **Write into a worktree.** `writeRepoCopy({ jobDir, worktree, ticket })`:
   - refuses with a plain reason when the worktree isn't a git checkout or when `git check-ignore` says `docs/decisions/` is ignored ("Orbit still ignores docs/decisions/. Its .gitignore needs `docs/*` and `!docs/decisions/` first.");
   - otherwise writes the job's `decisions.md`, unchanged apart from removing the notes meant for agents (the HTML comments), to `docs/decisions/<name>`;
   - rebuilds the index;
   - returns the two paths.

   It never commits, never stages, never pushes; the Foreman commits (step 4).
3. **The index.** `renderIndex(dir)` reads every `docs/decisions/*.md` and `docs/decisions/general/*.md` except `README.md` and writes `docs/decisions/README.md`: a one-line note on what the folder is, then a table of ticket, title, decisions count, last updated (the newest `when` in the file), each ticket a link to its file, sorted by ticket number; files under `general/` in a second table. The same input always gives the same file, byte for byte, so two branches that rebuild it conflict only when they really differ.
4. **The command and the ship step.**
   - `ground-control decisions <job> --worktree <path>` runs step 2 and prints the paths.
   - In the skill, PR #1 gets a step before the push (in `skills/ship/SKILL.md` and the Ship notes of `skills/feature/SKILL.md`): with a ticket, run the command (or, when Ground Control isn't installed, copy `decisions.md` by hand to the same name and rebuild the index as `skills/feature/SKILL.md` describes), check `git status` shows only those two files, and commit them on the feature branch as `docs(decisions): ORBIT-479 decisions`. The PR #1 body links the file.
   - If the command refuses because the folder is ignored, the Foreman says so in its brief and ships without the file. It never edits Orbit's `.gitignore` itself.
   - A later change to the job's decisions after PR #1 goes in the same way, as part of the next fix commit.
5. **Not doing in the review (left open from v1).** `review-facts.md` adds the job's `## Not doing` list to the facts block (from `decisions.md`, or "none" when empty). `review-lens-rules.md` adds one rule: an item on that list is not a finding unless the change does it anyway or the spec says it must be done.
6. **Ground Control's own decisions** (its repo). Create `docs/decisions/0001-next-phase-register.md`: the register in `docs/plans/2026-10-27-ground-control-decisions.md` copied into the same shape (title line, the table with ids `G1`, `G2`…, `## Not doing` with the "Not adopted" items it names, such as Sandcastle as a library and the Symphony ideas). Then `docs/decisions/README.md`, built with `renderIndex`. Leave the plan file where it is, and add a line at its top pointing to the new file.
7. **Tests** (`decisions-repo.test.js`, with temp git repos, no network):
   - the file name (padding, slug, no ticket gives `null`);
   - the write refuses when the folder is ignored and works when it isn't;
   - the agent notes are removed;
   - the index is sorted and identical on a second build, and lists `general/` apart;
   - `## Section:` parts and `## Not doing` come through unchanged;
   - nothing is staged or committed.

## Acceptance
On a real ticket, the decisions file `docs/decisions/ORBIT-NNNN-<slug>.md` and the rebuilt `docs/decisions/README.md` ride PR #1 (plan §11 O). This needs Vignesh: he picks the ticket, and the push and PR wait for his yes as always. Until Orbit's `.gitignore` tracks `docs/decisions/`, the step refuses in plain words and nothing else changes. Lenses get the Not doing list and don't report its items. The Ground Control repo has `docs/decisions/0001-next-phase-register.md` and its index. All tests green.

## Verify
```
npm test && (cd web && npx vitest run)
node bin/ground-control.js decisions <slug> --worktree ../orbit-<slug>   # in a scratch worktree, then git status
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
