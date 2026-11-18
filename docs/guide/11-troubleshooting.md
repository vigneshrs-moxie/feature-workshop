# 11. Troubleshooting

What to do when Starbase says no, or says nothing. The quoted lines are Starbase's own words, so you can search this page for the message you see.

**The one thing to remember:** when Starbase refuses something, it says "Nothing was sent" or "Nothing was changed" and puts your words back. Read the line, fix the one thing it names, and try again.

## Starbase itself

| What you see | What to do |
|---|---|
| The page doesn't open at http://127.0.0.1:4477/next/ | `starbase status`, then `starbase start`. `starbase doctor` lists anything missing. The first request after a start can be slow (the plan measured about 25 seconds). |
| The page looks old or broken after you pulled new code | `npm run web:build`, then reload. |
| The demo won't start because the port is taken | `PORT=4479 npm run demo`. |
| The top bar says `Reconnecting…` | "The connection to Starbase dropped. This page catches up by itself when it's back." If it stays, check `starbase status`. |
| "Couldn't reach Starbase. Try again." / "Not sent: Starbase didn't answer. Try again." | Starbase is stopped or restarting. Start it, then press the button again. |
| The job page says why it can't load the job, with `Try again` | Press `Try again`. If it keeps failing, tell the team. |
| You want to know what happened | Starbase's log is `logs/starbase.log` in the `.starbase` folder in your home folder; `audit.jsonl` there has every message sent and every permission decided, word for word. |

## Sending and deciding

| Message | What it means |
|---|---|
| "Paused: the Claude usage limit was reached. The job carries on after it resets." | Claude's 5-hour or weekly limit is reached. Replies in progress pause and carry on by themselves after the reset. Telemetry shows when. |
| "Claude Code is open on this job in a terminal. Close it (type /exit there) and try again. Nothing was changed." | Only one Claude session can drive a job. Close the terminal's session, or keep working there. |
| "The Foreman is still working on your last message. Wait for it, or pause it first." | Send while it works: your message then waits for the reply to end. |
| "A message is already waiting for the Foreman: “…” Replace it, or cancel it first." | One message can wait per job. Use `Replace it` or `Cancel`. |
| "The spec or plan changed since this card was shown. Nothing was sent; read the new version, then decide." | The page reloads the decision. Look again and decide on the new version. |
| "The Foreman has moved on to brief N since this card was shown. Nothing was sent; decide on the new brief." | Same: decide on the newer brief. |
| "That request was already answered or has expired." | Someone (you, on another tab, the Desk or the website) already answered it. |
| "This step is a hard line: it asks you every time, whatever your rules say. Use Allow once instead." | Hard lines can't be saved as `Always allow` rules. See [page 6](06-auto-and-permissions.md#hard-lines). |
| "Claude Code flagged this step as risky, so it can't be always allowed. Use Allow once instead." | Same rule for steps Claude Code marks as risky. |
| "Stop the reply first." | Mark done, Change model and a few others wait until the Foreman isn't replying. |
| "Not marked yet: …" | Mark done waits for something named in the line: a crew member still working, a command from the page still running, or Claude Code open in the worktree. |

## GitHub and pull requests

| What you see | What to do |
|---|---|
| A PR line with no button, saying GitHub can't be read | Sign in with `gh auth login`, check your network, then `Pull now`. |
| "That comment moved on since you looked: read the PR again. Nothing was posted." | `Pull now`, then act on the fresh rows. |
| "That check isn't failing any more: read the PR again. Nothing was sent." | Same: read the PR again. |
| "Starbase can't write to GitHub here. Copy the reply and post it on GitHub." | Use `Copy` and `Open on GitHub`. |

## Inbox, Try it and recordings

| Message | What to do |
|---|---|
| "Connect Orbit to see your tickets" | Make a read-only token on Orbit's API tokens page and paste it in Settings → Workflow (or `starbase token set`). |
| "This laptop doesn't know which repository a ticket's job goes in. Add the repository in Settings → Repos on the laptop, then press Start again." | Add it with Settings → Repos or `starbase repo add <folder>`. |
| "The app didn't answer within 3 minutes, so nothing was recorded. Its output is in Try it." | Open Try it on the job and read the app's output. |
| "Evidence for this job is being recorded now." | Recordings run one at a time; wait for it to finish. |

## The website

| What you see | What to do |
|---|---|
| "…: waiting for your laptop. It runs when the laptop is back." | Wake the laptop, or `Cancel`. |
| "Nothing has moved yet." beside a waiting decision | The laptop hasn't picked it up. Check it is on and Starbase is running. |
| "This changed on your laptop. Look again." | The job moved on; nothing ran. Decide on the new card. |
| "Nobody pressed “Pair this laptop” within 10 minutes, so the code has run out. Run starbase login again." | Run `starbase login --site …` again. |

## Known limits

From the [README](../../README.md#known-limits):

- **Jobs run only on laptops.** A closed laptop's decisions wait for it to wake.
- **Some terminal sessions keep no log** (for example ones started from inside another Claude Code session), so Starbase shows them only as open terminals. The optional live link hook, `dashboard/hooks/record.mjs`, shows them as they happen.
- **A quiet session isn't always a stuck one.** A long command and a permission prompt in a terminal look the same in the logs, so the card says "maybe" and points you to the terminal.
- **Claude Code's session log format can change.** Lines Starbase doesn't recognise are skipped.

## Next

[12. Glossary](12-glossary.md).
