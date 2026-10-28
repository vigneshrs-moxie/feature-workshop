# Packets for the Ground Control build

One file per packet. Start a terminal tab, paste the path of one file, and that tab owns that packet until hand-back. Integration happens on the Integration board (packet Z), never by passing text between windows. The plan is `../2026-10-27-feature-workshop-next-phase-plan.md`, section 11.

**v1 order:** Z first, then C, D, E, F, then A and T, then B. The number of packets at once is a setting on the board (starts at three, change it whenever); with three: Z+C+D, then E+F+A, then T+B. (Z, C and D are merged by hand once, since the board does not exist yet.)

| Id | File | Port |
|---|---|---|
| Z | `Z-integration-board.md` | 4481 |
| C | `C-job-lock.md` | 4483 |
| D | `D-usage-warnings.md` | 4485 |
| E | `E-decisions-and-not-doing.md` | 4481 |
| F | `F-facts-up-front-review.md` | none (skill repo) |
| A | `A-orbit-client-and-inbox.md` | 4483 |
| T | `T-telemetry.md` | 4481 |
| B | `B-start-from-ticket-status-v2.md` | 4483 |

v1.5 and v2 packet files are written when v1 ships, from plan §11.

## Rules that apply to every packet (read once, obey always)

- **Base:** `main` of the Ground Control repo (today `~/Projects/feature-workshop`, to be renamed `ground-control`) after Vignesh has fast-forwarded `redesign/orbit-ready` into it. If `git log main..redesign/orbit-ready` is not empty, stop and tell Vignesh; do not base on `main` then.
- **Worktree and branch:** `git worktree add ../ground-control-<id> -b packet/<id>-<name> main` from the main checkout. Work only there.
- **Port:** run the dashboard with `PORT=<port> npm start` in the worktree. **Never use 4477 (Vignesh's live dashboard) or 4479 (his demo).** The screens server takes `<port>+1`.
- **Slots:** how many packets run at once is the board's setting, not a rule in this file.
- **Owned files only.** Touch nothing outside the "Owns" list. If you need a change elsewhere, write it under "Needs from others" in your hand-back and stop at that point.
- **Tests:** `npm test` (node:test, `dashboard/test/*.test.js`) and `cd web && npx vitest run`. Both green before hand-back. **No model calls in tests:** the server under test runs with a fake query (`WORKSHOP_DEMO=1`); never import the Agent SDK in a test.
- **Never push, never open a PR, never merge.** Commit locally, one commit per step, plain messages. Hand back the branch name and the last SHA.
- **Status is never shown by colour alone; themes change looks only; keys never fire while typing or with a dialog open.** Use the theme tokens, not literal colours.
- **Plain words** in every string a person reads. No jargon.
- **Usage check:** `node docs/plans/packets/usage.mjs` from the repo root prints the weekly and five-hour percent. The build session runs it after every packet step and tells Vignesh when the week is at or above 95 %.
- **Hand-back format** (paste into the integration board's notes or tell Vignesh): packet id, branch, last SHA, what was done per step, test output tail, anything not done and why, "Needs from others".
