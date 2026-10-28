# Packet B · Start from a ticket, status.json v2, schema with retry

**Goal.** A job is created from a ticket and carries the ticket key; the branch is derived from it; every `status.json` the Foreman writes is checked against a schema and errors go back to the same session to fix (plan D1, D11).

**Port 4483 · worktree `../ground-control-B` · branch `packet/B-start-from-ticket-status-v2`. Depends on A (inbox) and C (lock); start after both are merged.**

## What exists
- `dashboard/lib/status-json.js` parses `status.json` leniently (schema_version 1, documented in the skill repo at `skills/feature/status-json.md`); unknown values become null with warnings; no validation errors are sent anywhere.
- `dashboard/lib/driver.js` starts the Foreman with `query()` from `@anthropic-ai/claude-agent-sdk`, owns the session, parks permission cards, emits events; it can send a follow-up message into the running session (see how replies and send-backs are delivered).
- `dashboard/lib/options.js` and `web/src/views/` New job form hold the job options.
- The skill's `SKILL.md` names the branch `<kind>/orbit-<n>-<slug>` and requires a real `ORBIT-<n>` ticket.

## Owns
`dashboard/lib/status-json.js` (schema v2 and a `validate()` returning errors), `dashboard/lib/status-schema.json` (new), the status-write path in `dashboard/lib/driver.js` (validate on each write, on error send one corrective message into the same session with the error list, at most 3 tries per write, then a "Needs you" card and an audit event), the Start path in `driver.js`/`options.js` (ticket block from the inbox, slug `orbit-<n>-<short-title>`), `dashboard/test/status-json.test.js` and `status-schema.test.js`, the New job form's ticket field (prefilled, read-only when started from the inbox), and in the skill repo (second worktree of `~/Projects/claude-feature-workflow`, branch `packet/B-status-v2`): `skills/feature/status-json.md` (version 2: the `ticket` block `{ key, title, url, level }`; version 1 files remain valid).

## Steps
1. Schema: JSON Schema for versions 1 and 2 (allow unknown extra keys with a warning, refuse wrong types, enums for stage states, waiting_for, PR states, levels; the ticket block required in v2 when the job was started from a ticket).
2. `validate(json)` → `{ ok, errors[], warnings[] }`; `parse()` keeps today's lenient behaviour for display.
3. Driver: watch the job folder's `status.json` writes (today's watcher); on invalid, write an audit event `status_invalid` with the errors, send the session one message: "status.json is invalid: <errors>. Rewrite the whole file to match skills/feature/status-json.md and write it again." Count per write; after 3, park a "Needs you" card "The Foreman cannot write a valid status.json" with the errors.
4. Start from a ticket: `POST /api/jobs` accepts `ticket: { key, title, url }`; the slug and the branch kind come from the options; the first brief tells the Foreman the key and that the ticket is readable through the `orbit-feedback` MCP server.
5. Skill doc: version 2 text, examples, the rule that the Foreman reads the ticket through MCP at clarify, spec and test.
6. Tests: schema accepts the fixtures in `dashboard/test/fixtures`, refuses wrong types, retry message sent once per invalid write, card after three, Start creates the folder with the ticket block.

## Acceptance
Start creates the job with the ticket key; the branch is derived; an invalid write produces a corrective message in the same session and an audit event; after three the card appears; version 1 files still parse. All tests green, plus the skill repo's own checks.

## Verify
```
PORT=4483 npm start
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
