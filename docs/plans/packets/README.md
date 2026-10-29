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

**v1.5 order:** G first and alone (every other v1.5 packet depends on it), then H, J and N, then I, K and L, then M and O, then K2, Q and P. With three slots: G, then H+J+N, then I+K+L, then M+O, then K2+Q+P (all three start once M is merged). Merge in this order: G, H, J, N, I, K, L, M, O, K2, Q, P. K2 is K's steps 7 and 8 (the Stack screens and the Integrate board's removal), moved after M after the Stack review so the page is built once in the new design. Q (review rounds: changes asked for on a PR, fixed, pushed, reviewed again, merged) was added on 2026-10-29. P was added after Vignesh's first review of the Ground Control screens (`M-screens-review-1.md`): Telemetry's ten insight graphs moved out of M into it. The board's saved order still starts as v1's, so set it to `G,H,J,N,I,K,L,M,O,K2,Q,P` on the board first. The board merges only Ground Control branches: the skill-repo branches of H, K, L and O (`packet/<id>-*` in `../claude-feature-workflow-<id>`) are merged by hand in the same order. After K2 is merged, the Integration board is gone and the remaining packets (Q, P) are merged from the "Ground Control build" stack on the Stacks page.

| Id | File | Port |
|---|---|---|
| G | `G-split-and-protocol.md` | 4481 |
| H | `H-cross-platform-audit.md` | 4481 |
| J | `J-repo-registry-and-profile.md` | 4483 |
| N | `N-pr-feedback-routing.md` | 4485 |
| I | `I-installer-service-update.md` | 4481 |
| K | `K-stacks.md` | 4483 |
| L | `L-playwright-evidence.md` | 4485 |
| M | `M-redesign.md` | 4481 |
| O | `O-decision-files-into-orbit.md` | 4483 |
| K2 | `K-stacks.md` ("Steps 7 and 8, second run") | 4483 |
| Q | `Q-review-rounds.md` | 4489 |
| P | `P-telemetry-insights.md` | 4487 |

**Ports:** a packet takes a port only after the packet that last used it is merged, so no two packets running at the same time share one (H after G on 4481; I after H; K after J; L after N; M after I; O after K). 4477 and 4479 are never used.

v2 packet files are written when v1.5 ships, from plan §11.

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
