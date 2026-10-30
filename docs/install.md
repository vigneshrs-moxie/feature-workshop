# Installing Starbase

Starbase runs on your own computer: Windows, macOS or Linux. One line installs it. It then runs in the background as your own account, from the moment you sign in, at **http://127.0.0.1:4477/next/**.

## What it needs

You don't need to get these first. The install line checks each one, shows the line that gets it, and asks you before it runs anything.

- Node 22 or later
- Git
- GitHub CLI (`gh`), signed in
- Claude Code, signed in
- The Postgres tools (`psql`), for jobs that check a database
- Playwright's browser, for screenshots of a job's checks (only a warning for now)
- Your Orbit token, for the Inbox

## Install

### Windows

Open **PowerShell** (the normal one; you don't need "Run as administrator") and paste:

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object Net.WebClient).DownloadString('https://github.com/vigneshrs-moxie/feature-workshop/releases/latest/download/install.ps1'))
```

It works in Windows PowerShell 5.1 (the one that comes with Windows) and in PowerShell 7. The first half only switches on the secure connection that older Windows PowerShell leaves off.

### macOS and Linux

Open a terminal and paste:

```sh
curl -fsSL https://github.com/vigneshrs-moxie/feature-workshop/releases/latest/download/install.sh | bash
```

### What the line does

1. Checks for Node 22 or later. If it isn't there, it shows the line that gets it (`winget` on Windows, `brew` on macOS, your package manager on Linux) and asks before running it.
2. Downloads the newest release of Starbase and its checksum file, `SHA256SUMS`, and checks the one against the other. If they don't match, it stops: "The download didn't match its checksum. Nothing was changed."
3. Runs `starbase doctor` and, for each thing missing, shows the fix and asks you yes or no before running it. Anything it can't do for you (like signing in to Claude Code) it lists for you to do.
4. Installs Starbase with `npm i -g`, sets up the background service with `starbase install`, and opens http://127.0.0.1:4477/next/ in your browser.

### If you'd rather check the script before running it

The release's `SHA256SUMS` lists the install scripts too.

macOS (on Linux, use `sha256sum -c -` instead of `shasum -a 256 -c -`):

```sh
cd "$(mktemp -d)"
curl -fsSLO https://github.com/vigneshrs-moxie/feature-workshop/releases/latest/download/install.sh
curl -fsSLO https://github.com/vigneshrs-moxie/feature-workshop/releases/latest/download/SHA256SUMS
grep ' install.sh$' SHA256SUMS | shasum -a 256 -c - && less install.sh && bash install.sh
```

Windows PowerShell:

```powershell
$u = 'https://github.com/vigneshrs-moxie/feature-workshop/releases/latest/download'
$d = Join-Path $env:TEMP 'starbase-install'; New-Item -ItemType Directory -Force $d | Out-Null
Invoke-WebRequest -UseBasicParsing "$u/install.ps1" -OutFile "$d\install.ps1"
Invoke-WebRequest -UseBasicParsing "$u/SHA256SUMS" -OutFile "$d\SHA256SUMS"
(Get-FileHash "$d\install.ps1").Hash.ToLower(); Select-String 'install.ps1' "$d\SHA256SUMS"
```

If the two long numbers it prints are the same, read the script if you like, then run it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$d\install.ps1"
```

## No administrator rights?

On Windows, starting Starbase at sign-in uses a Task Scheduler task. If your account isn't allowed to make one, the install says so plainly. Starbase still works fully without it:

```
starbase start --here
```

Keep that window open while you use it. Close the window (or press Ctrl+C) to stop it. `starbase doctor` says why there is no service.

The same goes for a Linux computer without systemd user services.

## Every day

| What you want | Type |
| --- | --- |
| Is everything in place? | `starbase doctor` |
| Is it running, and what is it doing? | `starbase status` |
| Start it (the service) | `starbase start` |
| Start it in this window instead | `starbase start --here` |
| Stop it (Foremen pause, and carry on at the next start) | `starbase stop` |
| Save your Orbit token | `starbase token set` |
| Add a repository | `starbase repo add <folder>` |
| Open a job's folder in your terminal and editor | `starbase open <job>` |
| Move to the newest version | `starbase update` |
| Help with any of them | `starbase <command> --help` |

## Updates

`starbase start` checks for a newer release first. You can also run `starbase update` at any time, or `starbase update --check` to only ask.

An update downloads the new release and its `SHA256SUMS`, checks the one against the other, installs it, and restarts the service. If the check fails, nothing is changed. If there's no network, the start goes on with the version you have. `starbase start --no-update` skips the check.

## Where your files are

Everything Starbase keeps is in the folder `.starbase` in your home folder: settings, the list of repositories, the log (`logs/starbase.log`) and its record of what happened.

If you used Starbase under one of its earlier names, your folder, command, service and settings move over by themselves the first time it starts: [CHANGELOG.md](../CHANGELOG.md) says exactly what happens.

## Removing it

```
starbase uninstall
npm rm -g @moxie/starbase
```

The first line stops it and removes the background service; the second removes the program. Your files in `.starbase` stay until you delete them.

## Later: from npm

Starbase isn't on the npm registry yet; the install line installs the release's package file. Once it is published, this will also work:

```
npm i -g @moxie/starbase
starbase install
```
