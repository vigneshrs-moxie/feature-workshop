# Packet Y · The name is Starbase, everywhere

**Goal.** Vignesh, 2026-10-30: "we have decided on the name - starbase. change it everywhere from dashboard/feature-workshop/ground-control to starbase." That covers every string a person reads, the CLI, the package, the state folder, environment variables, the service, the installers, the hosted site and the living docs. Nobody's existing data or setup may break on the way, including Vignesh's own dashboard running on 4477.

**Port 4517 · worktree `../starbase-Y` · branch `packet/Y-rename-starbase`.** Base: `main` after X, 2B and 2C are merged. It runs alone, because it touches almost every file.

## The names
| Was | Now |
|---|---|
| "Dashboard" (the placeholder in `BRAND.name` / `PRODUCT`), "Ground Control", "Feature Workshop" in anything a person reads | **Starbase** |
| CLI `ground-control` | `starbase`. `ground-control` stays one release as an alias that prints "ground-control is now called starbase" and runs the same command. |
| npm `@moxie/ground-control` | `@moxie/starbase` |
| State folder `~/.ground-control/` (and the older `~/.feature-workshop/`) | `~/.starbase/` |
| `GROUND_CONTROL_DIR`, `GROUND_CONTROL_USER` | `STARBASE_DIR`, `STARBASE_USER` |
| `WORKSHOP_DEMO`, `WORKSHOP_PROJECTS_DIR` and every other `WORKSHOP_*` | `STARBASE_DEMO`, `STARBASE_PROJECTS_DIR` and so on |
| Header `X-Workshop-Token` | `X-Starbase-Token`. The server also accepts the old header, so a page left open across the update keeps working. |
| launchd label, Windows scheduled task, systemd unit | `com.moxie.starbase`, task `Starbase`, `starbase.service` |
| Hosted: Vercel project, subdomain, Google app name | `starbase`, `starbase.<domain>`, "Starbase" (`docs/hosting/vercel-setup.md` already says so) |
| Package names inside the repo (root, `web`, `hosted`) | `starbase`, `starbase-web`, `starbase-site` |
| Worktrees for new packets | `../starbase-<id>` |

**Old environment variable names keep working as fallbacks,** read only when the new one is unset. The `WORKSHOP_FEATURES_DIR` that the `/feature` skill uses is one of them. A test lists every old name and its new one.

**Not renamed:**
- the `/feature` skill and its job folders `~/.claude/feature-work/`: those are the feature workflow's own names, not the product's;
- the code folders `dashboard/`, `web/`, `hosted/`: they name parts of the code, and nobody reads them in the app. Keep the folder named `dashboard/`, but rename what it says about itself.

## Moving the state folder (careful)
Starting `starbase` for the first time:
- **If `~/.starbase` doesn't exist and `~/.ground-control` does:**
  1. move it with a rename on the same disk;
  2. leave a **symlink** `~/.ground-control → ~/.starbase`, so an older process still running (Vignesh's 4477) keeps finding its files;
  3. write one line to the audit: "Moved ~/.ground-control to ~/.starbase".
- **If only `~/.feature-workshop` exists,** follow the existing older move, ending in `~/.starbase`.
- **If both the old and the new folder exist,** don't merge them. Use `~/.starbase`, and say once in the terminal that the old folder was left alone.
- **On Windows, if the symlink can't be made** (no rights), leave a `MOVED-TO-STARBASE.txt` in the old folder instead. Don't fail.
- Tests use temporary homes only. **Never touch the real `~`.**

## The service, on update
- `starbase install` (and the installers) finds the old `ground-control` service, stops and removes it, then installs the Starbase one.
- `doctor` reports any old service still there.
- Tests use the existing fake service runner. They never call `launchctl`, `schtasks` or `systemctl` for real.

## The skill repository
In a worktree of `~/Projects/claude-feature-workflow` (branch `packet/Y-rename-starbase`), change every mention of "Feature Workshop", "Ground Control" or "the dashboard" (meaning the app) to Starbase, and the `WORKSHOP_*` environment names to `STARBASE_*` with the old names as fallbacks. Its own checks must pass.

## Docs
- **Living docs:** README, `docs/hosting/`, `docs/design/`, `web/src/theme/THEMING.md`, the packet README's rules, and the skill's docs. Change the name throughout.
- **Dated plans, handoffs and the decision register:** keep them as written; they are history.
  - Add decision **G36** to the register: "The product is called Starbase (Vignesh, 2026-10-30)", with the names table above.
  - Add one line under the main plan's title: "Ground Control and Feature Workshop are now called Starbase (G36)."

## The check left behind
A test greps the repo (and a second one the built `web/dist` and `hosted/public`) for "Ground Control", "Feature Workshop", "ground-control", "feature-workshop", "GROUND_CONTROL", `WORKSHOP_` and the placeholder name "Dashboard" used as the product's name. It fails on any hit outside an allowlist:
- the migration code;
- the fallback table;
- the alias;
- the dated docs;
- the changelog.

The word "dashboard" for the code folder and in plain sentences, such as "the Telemetry dashboard", is fine; judge by meaning.

## Owns
Everything the rename touches, in both repositories. Run it alone.

## Steps (one commit each, tests green)
1. `BRAND` / `PRODUCT` and every user-facing string, plus the page title, the icon's label, notifications, the terminal and the CLI help.
2. Environment names with fallbacks, the header, and the package names (refresh the lockfiles).
3. CLI `starbase` and the `ground-control` alias, the state folder move with its tests, and the service and installers.
4. The hosted site's names, and anything 2A–2C wrote.
5. Docs, and G36.
6. The skill repo (its own commit there).
7. The grep check. Then:
   - run the demo and look at every screen in Light and Default at 1512 px for any old name;
   - run `starbase doctor` against a temporary home that holds an old `~/.ground-control` and an old service file.

   Hand back with what Vignesh has to do on his own Mac (restart 4477 with `starbase`, and the optional GitHub and folder renames in `docs/hosting/vercel-setup.md` §6a).

## Rules that apply to every packet (read once, obey always)
- **Worktree and branch:** `git worktree add ../starbase-Y -b packet/Y-rename-starbase main` from the main checkout. Work only there.
- **Port 4517.** **Never use 4477, 4479, 4485, 4491 or 4505.**
- **Never touch Vignesh's real `~/.ground-control`, `~/.feature-workshop`, `~/.claude`, his running dashboard or his services.** Use temporary homes.
- **Never push, never open a PR, never merge.** Never rename the GitHub repo or the `~/Projects/feature-workshop` folder: those are Vignesh's steps.
- **Tests:** `npm test`, `npm test -w hosted`, `cd web && npx vitest run` and `npx tsc --noEmit -p .`, green before each commit. **No model calls in tests.** No real people's names.
- **Hand-back format:** packet id, branch, last SHA, what was done per step, test output tail, anything not done and why, "Needs from others".
