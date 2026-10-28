# Packet E · decisions.md and the not-doing list

**Goal.** Every job keeps one plain decision file, readable by engineers and agents, generated after every gate from the audit log plus the Foreman's own entries, with a "Not doing" list; a "Copy for the ticket" button gives it as text (plan §8, D6, D13).

**Port 4481 · worktree `../ground-control-E` · branch `packet/E-decisions-and-not-doing`.**

## What exists
- The Decisions tab is built from `~/.feature-workshop/audit.jsonl` by `dashboard/lib/decisions.js`; no file is written.
- `dashboard/lib/history.js` writes `history.md`; follow its write pattern.
- The format to produce is in plan §8: a table with id, question, options, choice, who, when, why; `## Section: <name>` headings for stack sections (none yet; emit none); `## Not doing` at the end.

## Owns
`dashboard/lib/decisions.js` (add `render()` and `writeDecisionsFile(jobDir)`), the call after each gate in `dashboard/lib/gate.js` (one line), `dashboard/test/decisions.test.js` (extend), the Decisions tab's "Copy for the ticket" button (one component), the `GET /api/jobs/:slug/decisions.md` route, and in the skill repo (worktree, branch `packet/E-not-doing`): `skills/feature/SKILL.md` gains a short rule that the Foreman appends its own decisions and the not-doing items to `decisions.md` under the same table shape and never rewrites the generated rows.

## Steps
1. Decision id `ORBIT-<n>.D<k>` when the job has a ticket key (from `status.json` `ticket.key` when packet B lands; until then from the slug `orbit-<n>-`), else `<slug>.D<k>`; k increases in audit order.
2. Rows from audit events of kind gate decision, level override, question answered, permission allowed/denied with a reason; "who" is the person or "Foreman"; "why" is the note typed on the card, or the Foreman's one-line reason.
3. Merge rule: generated rows are rewritten each time; rows the Foreman added (marked by a trailing `<!-- foreman -->` on the line) and the `## Not doing` list are kept verbatim.
4. Copy for the ticket: the table as plain text (pipes kept), under 40 lines; longer files copy the last 40 and say so.
5. Tests: render from a fixture audit, merge keeps Foreman rows and not-doing, ids stable across rewrites.

## Acceptance
`decisions.md` generated after every gate in the §8 format; copy gives plain text; the Decisions tab reads the file. All tests green.

## Verify
```
PORT=4481 npm start
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
