# 9. The website

The team website shows your jobs from anywhere: your phone, another computer, or while your laptop is closed. It shows the same job pages, but jobs only ever run on laptops.
A decision you make on the website is queued and runs on your laptop; if the laptop is asleep, it waits until it wakes.

**The one thing to remember:** the website never runs a job, never touches your repositories and never reads GitHub. It mirrors what your laptop sends it and carries your decisions back.

## Set it up once

1. Open the website and sign in with your work Google account. Only accounts in your company's domain are let in.
2. On your laptop: `starbase login --site https://<the site's address> --name "My laptop"`.
3. Open the link it prints, check the code matches the one in your terminal, and press `Pair this laptop`. (The code runs out after 10 minutes; run `starbase login` again if it does.)
4. On the website, Settings → Orbit: paste your Orbit token. The Inbox then fills every few minutes, even while your laptop is off.

Hosting the site itself is in [docs/hosting/vercel-setup.md](../hosting/vercel-setup.md).

## What it shows

| Page | On the website |
|---|---|
| Jobs | Your jobs, from every laptop you paired, with `Laptop online` or `Laptop offline · seen …`. Only yours: nobody else sees them. |
| A job, the Desk, Stacks | The laptop's own pages, from the mirror. Every job address is the same job page as on the laptop. |
| Inbox | The tickets the website reads for you from Orbit, with your own token, every few minutes. `Start` sends the ticket to your laptop (it asks which one if you have several); if the laptop is off, the job starts when it is back. |
| Telemetry | The shared Claude account's limit, the same for everyone: how much of this week is used, by whom, and when it fills at this pace. The week starts on Wednesday at 4 pm. The graphs about your own jobs show their names to you only. |
| Lounge | Who on the team is online (active in the last 15 minutes), away (a laptop is on but quiet) or off, what is running and its stage. Never briefs, conversations, costs or decisions. Everyone sees the same page. |
| Settings | `Laptops` (your paired laptops), `People`, and `Orbit` (your token and Auto start). |

## What it can't do

- **Run anything.** No `Try it`, no terminals, no `Open the folder in a terminal`, no commits list.
- **The laptop-only menu items** are left out of the job's `⋯` menu (Mark done, Notes and options, Change model, Permissions). It keeps `Copy decisions` and `How this page works`.
- **Read GitHub.** PR lines show without buttons and without `Pull now`; `Pull PR comments` and `Mark done` are not in the asks.
- **Keep a message waiting.** On the website, `Send` while the Foreman is replying keeps your words in the box; send them when it finishes, or use `Stop it and send now`.
- **Some pages** (a job's screens, most of Settings, the flow map, the table) say "Open this on your laptop for now".

## Decisions queued for your laptop

Go, Send back, Stop, a reply, Allow, Deny, the Auto switch and Merge next all work on the website. Each is queued, and its card says where it is, in words:

| Card says | What it means |
|---|---|
| "…: waiting for your laptop. It runs when the laptop is back." | The laptop is offline. `Cancel` still works. |
| "…: sent to your laptop. It runs there in a moment." | The laptop is online and has it. |
| "…: done on your laptop." | It ran. |
| "This changed on your laptop. Look again." | The job moved on before your decision arrived, so nothing ran. Look at the new card and decide again. |
| "…: your laptop couldn't do it." | It failed there; the reason follows. |
| "…: the request ran out before your laptop was back. Nothing was sent." | A permission expired while the laptop was away. |
| "…: cancelled. Nothing was sent." | You cancelled it. |

You can cancel a decision only before the laptop has picked it up. The website refuses a second copy of a decision that is still waiting, so there is no `Try again`.

## Next

[10. Keys and ⌘K](10-keys-and-command-box.md).
