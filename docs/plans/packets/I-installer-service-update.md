# Packet I · Install, run as a service, update

**Goal.** One command installs Ground Control on Windows, macOS or Linux. It runs as the person's own background service from logon, and `ground-control update` moves it to the next release after checking the file against a checksum (plan G18, G31, §4.1, §4.3). `ground-control doctor` says what is missing and how to get it. Where the person can't install a service (no admin rights, plan Q3), Ground Control still works when started by hand. The state folder moves once from `~/.feature-workshop` to `~/.ground-control`.

**Port 4481 · worktree `../ground-control-I` · branch `packet/I-installer`. Depends on G and H; start after H is merged. Runs beside K and L.**

## What exists
- `package.json`: name `feature-workshop`, `private: true`, scripts `start` (`node dashboard/server.js`), `demo`, `test`, `web:*`; dependencies `@anthropic-ai/claude-agent-sdk` 0.3.296 and `markdown-it`. Node 22 or later.
- From G: `bin/ground-control.js` with `resume <job>` only, the `bin` field, and `service.json` in the state folder (pid, port, write token, mode 600) written by the running service (`dashboard/runner/service-file.js`). G's restart pauses replies on stop and resumes them on start, which is what makes stopping a service safe.
- From H: `dashboard/lib/platform.js` (`shellFor`, `killTree`, `openIn`, `terminalApps`, `findOnPath`), `dashboard/lib/credentials.js`, CI on Windows and macOS.
- From J (beside you, may not be merged yet): `addRepo()` in `dashboard/lib/repos.js` and `loadProfile()` in `dashboard/lib/profile.js`. `repo add` uses them; if J isn't merged when you reach that step, leave `repo add` printing "Not ready yet" and put it under "Needs from others".
- `dashboard/lib/state.js` `State` defaults to `~/.feature-workshop` (`WORKSHOP_STATE_DIR` overrides it); `dashboard/lib/integrate.js` already writes `~/.ground-control/integrate.json`, and Telemetry's `usage.jsonl` is planned there (plan §7a.1).
- `dashboard/lib/orbit.js` has `setToken(store, token, ...)` and `writeMcpEntry(...)`, used by `POST /api/orbit/token`; `lock.js` has `describeLock()`; `plan-usage.js` reads the two meters.
- There is no installer, no service file, no release, no update path, and no doctor. The skill repo's `install.sh` (and H's `install.ps1`) put the skill in `~/.claude`; that is separate and stays.

## Owns
`bin/ground-control.js` (every command but `resume`, which G wrote; keep it working), `dashboard/lib/doctor.js` (new), `dashboard/lib/update.js` (new), `dashboard/lib/service.js` (new: install, remove and check the service for each system), `service/ground-control.xml`, `service/com.moxie.ground-control.plist` and `service/ground-control.service` (new templates), `install.ps1` and `install.sh` at the Ground Control repo root (new), the default state folder and the one-time move in `dashboard/lib/state.js`, `package.json` (`name`, `version`, `private`, `bin`, `files`, `scripts`), `.github/workflows/release.yml` (new, builds the release files; runs only on a tag Vignesh pushes), `docs/install.md` (new, the person-facing install page), `dashboard/test/cli.test.js`, `dashboard/test/doctor.test.js`, `dashboard/test/update.test.js`, `dashboard/test/service.test.js` and `dashboard/test/state-move.test.js` (new).

## Steps
1. **The command line** (`bin/ground-control.js`): one small parser, no new dependency, `--help` on every command, plain errors, exit code 0 or 1. Commands from plan §4.1:
   - `start`: starts the service, or, with `--here`, runs it in this terminal (the no-service mode).
   - `stop`: stops it (running Foremen pause and resume on the next start, from G).
   - `status`: one screen with the service (up or not, port), repos registered, jobs by group, locks held, both usage meters.
   - `doctor`: see step 2.
   - `repo add <path>`: J's `addRepo`; with no `ground-control.md`, asks the five questions from §4.1 and writes the profile into the registry.
   - `token set`: reads the token without echoing it, saves it with `setToken`, writes the MCP entry.
   - `resume <job>`: G's, unchanged.
   - `update`: see step 4.
   - `open <job>`: H's `openIn` with the person's terminal and editor.
   - `install` and `uninstall`: see step 3.

   `login` is v2 and prints "Pairing with the site comes in a later version." Commands that talk to a running service read `service.json`; with no service they say how to start one.
2. **Doctor** (`lib/doctor.js`). Each check returns `{ name, ok, found, fix }`, and the fix is the exact line for this system:
   - Node 22 or later; git; `gh auth status`; Claude Code installed and signed in;
   - Playwright browsers (`npx playwright install chromium`; only a warning until packet L is in);
   - Postgres tools on `PATH` or in the usual folders;
   - the Orbit token saved;
   - ports 4477 and 4478 free (or held by Ground Control itself);
   - the service installed and running;
   - admin rights, on Windows, for the service install.

   On Windows the fixes use `winget install` (`OpenJS.NodeJS.LTS`, `Git.Git`, `GitHub.cli`, `PostgreSQL.PostgreSQL`); on macOS `brew install`; on Linux the package names. `doctor --json` for the installer and the tests. Doctor never installs anything itself.
3. **The service** (`lib/service.js` and `service/`). Install, remove and check, all as the person, never as an administrator account:
   - Windows: a Task Scheduler task "Ground Control", at logon, made with `schtasks /Create /XML`.
   - macOS: a launchd agent `com.moxie.ground-control` in `~/Library/LaunchAgents`, loaded with `launchctl bootstrap gui/<uid>`.
   - Linux: a systemd user unit, `systemctl --user enable --now`.

   Each runs `node <installed path>/dashboard/server.js` with `PORT=4477`, logs to `~/.ground-control/logs/`, and restarts on failure. When the task can't be made (no rights), `install` says so plainly and tells the person to use `ground-control start --here`, which is fully supported.
4. **Update** (`lib/update.js`). `update` asks GitHub for the latest release tag of the Ground Control repo (`gh release view --json tagName,assets`). If it is newer than the running version it downloads the package file and `SHA256SUMS` (`gh release download`), checks the hash with `crypto`, installs with `npm i -g <file>`, and restarts the service. A hash that doesn't match stops the update with "The download didn't match its checksum. Nothing was changed." `start` checks for an update first unless `--no-update` is given or the network is down; a failed check never stops the start. Tests use a local fake release (a folder with a packed file and a sums file) behind an injected `gh`; never call GitHub in a test.
5. **The release files** (`.github/workflows/release.yml`). On a tag `v*`, it runs both test suites on Windows and macOS, then `npm pack`, writes `SHA256SUMS`, and attaches both to the release. It only runs when Vignesh pushes a tag; never create or push a tag yourself. Publishing to npm under `@moxie/ground-control` is a separate, later yes from Vignesh. Until then, the install line in step 6 installs the release's package file, and the npm line is written in `docs/install.md` as the later form.
6. **Install in one line** (`install.ps1`, `install.sh` at the repo root, and `docs/install.md`):
   - The script runs `doctor --json` and, for each missing tool, prints the fix and asks before running it (yes or no).
   - It then installs Ground Control (the latest release's package file through `npm i -g`) and runs `ground-control install`.
   - It opens `http://127.0.0.1:4477/next/`.

   `install.ps1` runs in Windows PowerShell 5.1 and PowerShell 7; `install.sh` in bash and zsh. Nothing is downloaded and run without the checksum check.
7. **The state folder** (`state.js`). The default becomes `~/.ground-control`. On the first start with the new default, if `~/.feature-workshop` exists and `~/.ground-control` has no `settings.json`, the files are moved across once (`integrate.json` and `usage.jsonl` already there are kept), an audit line `state-moved` is written, and a note `MOVED.txt` is left in the old folder. `WORKSHOP_STATE_DIR` still wins, so every existing test is untouched.
8. **Package** (`package.json`): `name: "@moxie/ground-control"`, `private` removed only so `npm pack` works (publishing still needs Vignesh), `files` listing what ships (`bin`, `dashboard` without `test` and `demo`, the built `web/dist`, `service`, `install.*`), a `prepack` that builds the web app. `npm start` keeps working in the repo.
9. **Tests**, all with injected commands so nothing is installed or downloaded:
   - `cli.test.js`: each command's help and errors.
   - `doctor.test.js`: each check found and missing, the right fix per system.
   - `service.test.js`: the files written for each system, the plain no-rights message.
   - `update.test.js`: newer, same, a bad checksum, no network.
   - `state-move.test.js`: the move happens once, keeps what's there, and doesn't happen with `WORKSHOP_STATE_DIR`.

   Then by hand on this Mac: `npm pack`, install the file into a throwaway prefix (`npm i -g --prefix "$(mktemp -d)" <file>`), run `ground-control doctor` and `ground-control start --here` on port 4481 (`PORT=4481`). Never run `ground-control install` or `start` without `--here` on this Mac: the service takes 4477, which is Vignesh's live dashboard. Try the state move only with a throwaway `HOME`, never the real one.

## Acceptance
On a fresh Windows machine (a VM, then the manager's laptop as the v1.5 proof, plan §4.4): `doctor` lists the prerequisites with `winget` fixes; one install line installs Ground Control; the service starts at logon; `ground-control update` moves to the next tag after the checksum check (plan §11 I). Without admin rights, `start --here` works and `doctor` says why there is no service. The state folder moves once and nothing is lost. All tests green. The Windows run is done by Vignesh; record in the hand-back exactly what he should run.

## Verify
```
npm test && (cd web && npx vitest run)
npm pack && npm i -g --prefix "$(mktemp -d)" ./moxie-ground-control-*.tgz
PORT=4481 <prefix>/bin/ground-control start --here --no-update
<prefix>/bin/ground-control doctor
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
