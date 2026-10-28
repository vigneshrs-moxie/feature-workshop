# Packet H · Runs on Windows and Linux too

**Goal.** Everything that today only works on a Mac gets a Windows and a Linux way, chosen in one place, so the runner runs natively on the manager's Windows laptop (plan G18, §4.4). The test suite runs on Windows and macOS in GitHub Actions. Two things left open from v1 land here as well: one test helper that gives every server test its own screens port, and the integrate test that sometimes hangs.

**Port 4481 · worktree `../ground-control-H` · branch `packet/H-cross-platform`. Skill repo: worktree `../claude-feature-workflow-H` of `~/Projects/claude-feature-workflow`, branch `packet/H-windows`. Depends on G; start after G is merged. Runs beside J and N: `dashboard/lib/local.js` is split with J by function (see Owns).**

## What exists
Plan §4.4 lists the Mac-only spots. On `main` they are:
- `dashboard/lib/plan-usage.js` `readClaudeToken()`: on macOS, the Keychain (`security find-generic-password -s 'Claude Code-credentials' -w`); otherwise `~/.claude/.credentials.json`. Whether Claude Code on Windows and Linux keeps its sign-in in that file is not checked. `dashboard/lib/orbit-token.js` `tokenStore()` already falls back to `keytar`, then the Keychain on macOS, then a file, which is the pattern to follow.
- `dashboard/lib/notify.js` `findMethod()` returns `null` when the platform is not `darwin` (no notifications at all); `commandFor()` builds `terminal-notifier` or `osascript` commands; `OPEN_TAB_SCRIPT` is AppleScript.
- `dashboard/lib/local.js`: `startServer()` and `#exec()` spawn `process.env.SHELL || '/bin/zsh'` with `-c` and `detached: true` (lines about 257 and 372); `killTree()` kills the process group with `process.kill(-pid)`; `PG_DIRS` lists Homebrew and Postgres.app folders for `pgTool()`; `open(f, what, terminalApp = 'iTerm')` uses `open -a` for iTerm, Terminal, VS Code and Finder; `view()` and `setTerminalApp()` only know iTerm and Terminal. The Try it tab (`web/src/panes/Preview/TryTab.tsx`, the iTerm/Terminal picker and the VS Code and Finder buttons) and the classic page (`dashboard/public/local.js`) show the same Mac names.
- `dashboard/lib/live.js` `parsePs()` reads `ps -axo` and `cwdOf()` reads `/proc`, then `lsof`.
- `dashboard/lib/policy.js` line 25 `TEMP_DIRS` and `dashboard/lib/history.js` line 15 `TEMP_ROOTS` add `/tmp` and `/private/tmp` beside `os.tmpdir()`.
- `dashboard/lib/lock.js` `pidAlive()` already has a Windows branch (`tasklist`).
- `dashboard/hooks/record.mjs` starts with `#!/usr/bin/env node`; `README.md` (about line 116) tells people to put the bare path in their hook command, which Windows can't run.
- No `.github/` folder: nothing runs the tests on another system.
- Tests: about fifteen files in `dashboard/test/` spawn `server.js` without `WIREFRAMES_PORT`, so each one's screens server takes PORT+1 and two can collide when they run at once (`auto-level-server`, `docs`, `gate-route`, `decisions`, `gate-server`, `home-server`, `nudges-server`, `foreman`, `server-v2`, `play`, `steer`, `rules-server`, `play-server`, `status-json`, `telemetry`). `finish-server.test.js` already passes `WIREFRAMES_PORT: String(await freePort())`, which is the pattern. `integrate.test.js` sometimes hangs the whole run (left open from v1).
- Skill repo: `install.sh` makes symlinks and is POSIX only; several `SKILL.md` files and `skills/wireframe/build.py` call `python3`; `build.py` opens files without `encoding=` (lines about 230 to 356), which on Windows reads with the local code page; `skills/ship/preflight.py` does `json.load(open(sp))` (about line 134) and tests `"/briefs/" not in f` (about line 139), which misses `\briefs\`; Chrome paths for screenshots are Mac paths (`skills/wireframe/SKILL.md` about line 205, `agents/feature-wireframer.md`).

## Owns
`dashboard/lib/platform.js` (new), `dashboard/lib/credentials.js` (new), `dashboard/lib/plan-usage.js` (`readClaudeToken` only), `dashboard/lib/notify.js` (method finding and commands), `dashboard/lib/live.js`, `dashboard/lib/policy.js` and `dashboard/lib/history.js` (the temp-folder lists only), in `dashboard/lib/local.js` only `open`, `view`, `setTerminalApp`, `pgTool` and `PG_DIRS`, `killTree`, and the two `spawn` lines in `startServer` and `#exec` (J owns the rest of that file), the terminal picker and open buttons in `web/src/panes/Preview/TryTab.tsx` and `dashboard/public/local.js`, the hook line in `README.md`, `.github/workflows/test.yml` (new), `dashboard/test/helpers/dashboard.js` (new), the `spawn` and `env` lines of the server tests named above and of `dashboard/test/integrate.test.js` (nothing else in `dashboard/test/*.test.js`), dependency lines in `package.json` (only if one is truly needed), `dashboard/test/platform.test.js` and `dashboard/test/credentials.test.js` (new). In the skill repo: `install.ps1` (new), `install.sh` (only to share the list of links), `skills/wireframe/build.py`, `skills/ship/preflight.py`, the `python3` lines in each `skills/*/SKILL.md`, the Chrome path lines in `skills/wireframe/SKILL.md` and `agents/feature-wireframer.md`.

## Steps
1. **One place for the system** (`lib/platform.js`). Every function takes `platform` (default `process.platform`) so tests can ask for any system:
   - `shellFor(command)`: `{ file, args }` (macOS and Linux: `$SHELL`, else `/bin/zsh` or `/bin/sh`, with `-c`; Windows: `cmd.exe /d /s /c`).
   - `killTree(pid)`: process group on macOS and Linux, `taskkill /pid <pid> /T /F` on Windows.
   - `openIn(what, dir, { terminalApp })`: what is `terminal`, `editor` or `folder`. macOS: as today. Windows: Windows Terminal (`wt.exe -d`, else `cmd`), `code`, `explorer.exe`. Linux: `x-terminal-emulator` or `gnome-terminal`, `code`, `xdg-open`.
   - `terminalApps()`: the names this system offers (macOS iTerm and Terminal; Windows Windows Terminal and Command Prompt; Linux Terminal).
   - `findOnPath(name)` (with `PATHEXT` on Windows), `tempDirs()` (`os.tmpdir()` always, plus `/tmp` and `/private/tmp` only on macOS and Linux), and `processList()` (macOS and Linux: `ps`; Windows: `tasklist /fo csv`, with folders unknown).
2. **Use it.** `local.js` spawns with `shellFor` (keep `detached` off on Windows, which has no process groups), kills with `killTree`, opens with `openIn`; `pgTool()` also looks in `C:\Program Files\PostgreSQL\<n>\bin` and on `PATH`. The Try it tab and the classic page show the names from `terminalApps()` (sent with the job's local view) and say "Open folder" instead of "Finder" on Windows and Linux. `live.js` uses `processList()`; on Windows a terminal whose folder can't be read is left out, never guessed. `policy.js` and `history.js` take their temp folders from `tempDirs()`.
3. **Sign-ins** (`lib/credentials.js`). `readSecret({ service, account, file })`: `keytar` if it loads, else the macOS Keychain, else Windows Credential Manager (read through PowerShell's `Get-StoredCredential` only if it is there; otherwise skip), else the file. `readClaudeToken()` uses it with the Keychain name it has today and `~/.claude/.credentials.json`. Find out where Claude Code keeps its sign-in on Windows and Linux (its docs, or a look on a Windows machine if one is at hand) and write the answer in the hand-back. When nothing is found, the usage meters say "Plan usage can't be read on this computer", as they do today when the token is missing.
4. **Notifications.** `findMethod()`: macOS as today; Windows a PowerShell toast (`New-BurntToastNotification` when installed, else a balloon tip through `System.Windows.Forms`); Linux `notify-send`; else `null` (the page still shows its own notices). Clicking a notification on Windows or Linux does nothing extra (`OPEN_TAB_SCRIPT` stays macOS only).
5. **The live link hook.** The README tells people to put `node "<path to dashboard/hooks/record.mjs>"` in their hook command, which works on all three systems; the page's live link panel shows the same line (`liveLink.script`, with `node` in front).
6. **Tests that don't collide (left open from v1).** `dashboard/test/helpers/dashboard.js` exports `startDashboard({ env, stateDir })`: picks free ports for `PORT` and `WIREFRAMES_PORT`, sets `WORKSHOP_DEMO=1` and the state folders, waits for the first line, and gives back `{ port, base, token, stop() }`, with `stop()` killing the whole tree. Change only the spawn and environment lines of the fifteen tests named under What exists to use it; don't touch what they check. Find why `integrate.test.js` hangs (likely a child process or a stream left open; run it alone with `--test-reporter=spec` and `--test-timeout`), fix the cause, and give each server test a timeout (`{ timeout: 60_000 }`) so a hang fails one test instead of stopping the run.
7. **Windows and macOS in CI.** `.github/workflows/test.yml`: on push and pull request, `windows-latest` and `macos-latest`, Node 22, `npm ci`, `npm test`, then `cd web && npx vitest run`. It runs only when Vignesh pushes; never push to try it. Before hand-back, run every new path check with `platform: 'win32'` and `'linux'` in `platform.test.js` and `credentials.test.js` (commands built, never run).
8. **Skill repo.**
   - `install.ps1`, the Windows twin of `install.sh`, makes the same links into `%USERPROFILE%\.claude` (a folder junction for folders, a copy for files when links aren't allowed) and prints what it did. Both scripts read one list of links so they can't drift.
   - Every `python3` in a `SKILL.md` becomes "Python 3 (`python3`, or `py -3` on Windows)".
   - `build.py` and `preflight.py` open every text file with `encoding="utf-8"`; `preflight.py` tests the path with `os.sep` or normalises it first (`"/briefs/" in f.replace(os.sep, "/")`).
   - Paths in the Python scripts are built with `os.path.expanduser` and `os.path.join`, never a written `~/` or `/`.
   - The Chrome path lines also give the Windows paths (`C:\Program Files\Google\Chrome\Application\chrome.exe` and Edge's `msedge.exe`).

## Acceptance
`npm test` is green on `windows-latest` and `macos-latest` (plan §11 H), checked by the workflow once Vignesh pushes; locally on the Mac both suites are green and the new Windows and Linux branches are covered by tests. On a Mac nothing a person sees changes. Server tests no longer share screens ports, and the integrate test can't stop the whole run. The skill installs on Windows with `install.ps1`, and its Python scripts read and write UTF-8.

## Verify
```
PORT=4481 npm start   # Try it tab, Open terminal, the live link panel: same as before on the Mac
npm test && (cd web && npx vitest run)
node --test --test-concurrency=8 "dashboard/test/*.test.js"   # no port collisions, no hang
# skill repo worktree:
python3 skills/ship/preflight.py --help
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
