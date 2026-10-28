# Packet J · Repositories and their profiles

**Goal.** Each runner keeps a list of repositories, and each repository has a **profile**: a short `ground-control.md` file that says how work is done there (GitHub name, remotes, base branch, worktree folder and branch names, the Try it command and port range, which files to copy into a worktree, the database, setup and cleanup, PR route, risk floors). Orbit's profile is the first one. After this packet, nothing in Ground Control guesses about a repository; it reads the profile (plan G10, §5 "Repos", §11 J).

**Port 4483 · worktree `../ground-control-J` · branch `packet/J-repo-registry`. Depends on G; start after G is merged. Runs beside H and N: `dashboard/lib/local.js` is split with H by function (see Owns).**

## What exists
- `dashboard/lib/repos.js` has `recentRepos(sessionIndex, extra)` (folders recent Claude Code sessions ran in, plus `WORKSHOP_EXTRA_REPOS`) and `checkRepo(path)`. There is no saved list and no profile. `GET /api/repos` and `POST /api/job/:slug/repo` use these (after G: in `dashboard/site/` and `dashboard/runner/`).
- Orbit's habits are written straight into the code:
  - `dashboard/lib/local.js`: `FIRST_PORT = 3001`, `APP_SUBDIRS` (a guess at where the app lives), `ENV_FILE = '.env.local'`, `URL_KEYS`, `BYPASS_KEY = 'DEV_BYPASS_AUTH'`, the `npm run dev -- -p <port> -H 127.0.0.1` command in `startServer()`, and `where()`, `portFor()`, `envStatus()`, `setupEnv()`, `envChanges()`;
  - `dashboard/lib/options.js`: the slug `orbit-<n>-<short-title>` (`ticketSlug`) and the branch `<kind>/orbit-<n>-<short-title>` (`ticketBranch`);
  - the worktree folder `orbit-<slug>` next to the repo (server.js about line 156, and in the skill's `SKILL.md` Implement notes);
  - `dashboard/lib/hard-lines.js`: `ORG_REMOTES = ['moxie']` and `ORG_URL` (the org remote that is never pushed to), used by `auto-env.js` and `flow.js`;
  - `dashboard/lib/flow.js`: the org repo name for `gh pr list`.
- Orbit's real setup: the org remote `moxie` is `https://github.com/Moxie-Pest-Control-Phoenix/moxie-portal.git`, the person's fork is `origin`, work bases on `moxie/main`, and the PR route is fork branch → same-named org branch → `dev` → `main` (the skill's `skills/ship/SKILL.md`).
- Settings has seven sections (`web/src/app/router.ts` `SETTINGS_SECTIONS`); the "Find a setting" index is `web/src/views/Settings/sections.ts`. It has no entries for the Orbit token box (shown under Workflow) or the usage-warning switch (under Notifications), both left open from v1.

## Owns
`dashboard/lib/profile.js` (new), `dashboard/profiles/orbit.md` (new), `dashboard/lib/repos.js`, in `dashboard/lib/local.js` only `FIRST_PORT`, `APP_SUBDIRS`, `ENV_FILE`, `URL_KEYS`, `BYPASS_KEY`, `where`, `portFor`, `envStatus`, `setupEnv`, `envChanges` and the command line in `startServer` (H owns the rest), `ticketSlug` and `ticketBranch` in `dashboard/lib/options.js`, `ORG_REMOTES` and `ORG_URL` in `dashboard/lib/hard-lines.js`, the org-name lookup in `dashboard/lib/flow.js`, the worktree-folder guess in the runner (moved out of server.js by G), `dashboard/site/routes-repos.js` (new) and its one line in `dashboard/site/index.js`, `web/src/views/Settings/ReposSettings.tsx` and its test (new), the `repos` entry in `SETTINGS_SECTIONS` (`web/src/app/router.ts`), `web/src/views/Settings/SettingsView.tsx` (mount the section), `web/src/views/Settings/sections.ts`, the repo types in `web/src/api/types.ts`, `dashboard/test/profile.test.js`, `dashboard/test/repos.test.js` and `dashboard/test/no-guessing.test.js` (new).

## Steps
1. **The profile file** (`lib/profile.js`). `ground-control.md` in a repo's root (or a copy in the registry) is a short Markdown file with a front-matter block at the top and free notes for people below. Read only a small, strict subset (`key: value`, nested keys by two-space indent, `- item` lists); no new dependency. Fields:
   - `name`, `github` (`org/repo`), `remotes` (`fork: origin`, `org: moxie`), `base` (`moxie/main`);
   - `worktree` (`../orbit-{slug}`), `branch` (`{kind}/orbit-{n}-{slug}`), `slug` (`orbit-{n}-{title}`);
   - `prRoute` (the list of steps), `riskFloors` (paths whose change raises the review level);
   - `tryIt`: `app` (the folder), `command` (with `{port}`), `ports` (`3001-3099`), `url` (`http://127.0.0.1:{port}`);
   - `filesToCopy` (each with `from`, `to` and the keys to rewrite, such as the URL keys to the port and `DEV_BYPASS_AUTH=true`);
   - `database` (the local copy's name and how to check it is up), `setup` and `cleanup` (commands).

   `loadProfile(dir)` returns `{ ok, profile, errors }` with each error in plain words ("ports must look like 3001-3099"). Unknown keys are kept and warned about. `fillPattern(pattern, values)` fills `{slug}`, `{n}`, `{kind}`, `{title}`, `{port}`.
2. **Orbit's profile** (`dashboard/profiles/orbit.md`), written from what the code and the skill do today, so nothing changes for Orbit. Orbit's repo doesn't carry the file yet; the registry holds this copy (plan G31: "Orbit's workflow profile lives in the runner's registry"). A `ground-control.md` in the repo itself wins over the copy once one exists.
3. **The registry** (`lib/repos.js`): `repos.json` in the state folder holds `[{ path, github, profile }]`. Add `listRepos()`, `addRepo(path, { profileFile })` (checks it is a git repo and the profile loads), `removeRepo(path)` and `repoFor(path)`, which finds the registered repo a folder belongs to, worktrees included. On first start, if Orbit is among the recent repos (its org remote matches the profile's `github`), register it with `profiles/orbit.md`. `recentRepos()` stays for the New job picker and marks which entries are registered. A profile file that changes is read again on the next use (by file time), with no restart.
4. **Use the profile everywhere it guesses today.**
   - `local.js` takes the app folder, command, port range, env file, URL keys and bypass key from the profile.
   - `ticketSlug` and `ticketBranch` fill the profile's patterns, and the runner's worktree folder comes from `worktree`.
   - `hard-lines.js` keeps `moxie` and `ORG_URL` as a floor that can never be removed, and adds each registered profile's org remote and GitHub org.
   - `flow.js` takes the org repo name from `github`.

   A job in a repo with no profile still works as today's general case (no Try it, ports from 3001), and the job page says "This repository has no profile yet: Settings → Repos".
5. **Settings → Repos** (`ReposSettings.tsx`, routes in `site/routes-repos.js`: `GET /api/repos/registry`, `POST /api/repos/registry` to add, `DELETE` to remove, `POST /api/repos/registry/check` to read a profile and show its errors). The section lists each repo with its GitHub name, profile file and port range. "Add a repository" takes a path and checks it, and a profile with errors shows them line by line. A person reads and edits the profile file in their own editor; the page only shows it and checks it.
6. **The settings search (left open from v1).** `sections.ts` gets entries for the Repos section's controls, the Orbit token box ("Orbit token", "inbox", "read-only token") and the usage-warning switch ("usage warnings", "80 %", "plan usage").
7. **Tests.**
   - `profile.test.js`: Orbit's profile loads with no errors; each field's bad shape gives its plain error; patterns fill.
   - `repos.test.js`: add, list, remove, `repoFor` from a worktree path, the first-start registration, a changed file read again.
   - `no-guessing.test.js`: no `3001`, `'moxie'`, `.env.local`, `npm run dev` or `orbit-` pattern is left in `dashboard/lib/`, `dashboard/runner/` or `dashboard/site/` outside `profile.js`, `hard-lines.js`'s floor, comments and `dashboard/profiles/`.
   - Web tests for the Repos section.
   - The existing Try it, options and hard-line tests pass unchanged.

## Acceptance
Try it, ports, files to copy and branch rules come from the profile; no repo guessing is left (plan §11 J), checked by `no-guessing.test.js`. Orbit jobs behave exactly as before. Settings → Repos lists, adds, checks and removes repositories, and "Find a setting" finds the Orbit token and the usage warnings. All tests green.

## Verify
```
PORT=4483 npm start   # Settings → Repos: Orbit is listed with its profile; a job's Try it starts on 3001 as before
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
