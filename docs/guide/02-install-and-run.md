# 2. Install and run

Starbase runs on your own laptop as a background service and opens at http://127.0.0.1:4477/next/.
The install steps live in [docs/install.md](../install.md) and the [README](../../README.md#install); this page is the short version and the everyday commands.

**The one thing to remember:** `starbase doctor` tells you what is missing and how to get it. Run it first whenever something is off.

## Install, in short

- **What you need:** Node.js 22 or later, Git, the GitHub CLI (`gh`) signed in, and Claude Code signed in. For some jobs also the Postgres tools (`psql`) and Playwright's browser. `starbase doctor` checks all of them.
- **From a release:** one line for Windows, macOS or Linux. It checks the download against its checksum, asks before it installs anything, and sets up the service. The lines are in [docs/install.md](../install.md#install).
- **From the code:** `npm ci`, `npm run web:build`, `npm link`, `starbase doctor`, `starbase install`. Run `npm run web:build` again after you pull changes.
- **No right to install a service?** Use `starbase start --here` and keep that window open.

## Every day

| What you want | Type |
|---|---|
| Is everything in place? | `starbase doctor` |
| Is it running, and what is it doing? | `starbase status` |
| Start or stop it | `starbase start` / `starbase stop` (stopping pauses replies in progress; they carry on at the next start) |
| Start it in this window instead | `starbase start --here` |
| Add a repository | `starbase repo add <folder>` |
| Save your Orbit token (for the Inbox) | `starbase token set` |
| Open a job's folder in your terminal and editor | `starbase open <job>` |
| Pair this laptop with the team website | `starbase login --site <address>` |
| Move to the newest release | `starbase update` |
| Help with any of them | `starbase <command> --help` |

## Try it safely: the demo

`npm run demo` starts Starbase on made-up jobs (Widget Export, Crew schedule export, Nightly Export and others) with a pretend Foreman. It writes only inside your system's temp folder and never touches your real jobs. Every button works and nothing costs anything.

- If Starbase already runs, give the demo its own port: `PORT=4479 npm run demo`, then open http://127.0.0.1:4479/next/.
- The demo's screens page uses the next port (`WIREFRAMES_PORT`, by default `PORT` + 1).

## Where things are

- **Your jobs** are in `~/.claude/feature-work/`. Starbase reads them; the Foreman writes them.
- **Starbase's own folder** is `.starbase` in your home folder: settings, the list of repositories, rules, the log (`logs/starbase.log`) and `audit.jsonl`, which records every message sent and every permission decided, word for word.
- **Environment settings** (the port, the folders, extra repositories) are listed in the [README](../../README.md#settings-environment-variables).

## Next

[3. The Jobs page](03-jobs.md).
