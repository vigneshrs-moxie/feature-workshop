# Starbase user guide

This guide teaches you to use Starbase on your own: what it is, how to run it, and how to move a job from a ticket to a merged pull request.
Read page 1, try the demo (`npm run demo`), then dip into the rest as you need it.

**The one thing to remember:** Starbase runs jobs on your laptop and stops after each step for you. Your next move is always near the top of the page: the next-step bar on Jobs, the "Needs you" card on a job.

| # | Page | Read it when |
|---|---|---|
| 1 | [Start here](01-start-here.md) | First. What Starbase is, the 5-minute tour, the words. |
| 2 | [Install and run](02-install-and-run.md) | Setting up a laptop; the `starbase` command; the demo. |
| 3 | [The Jobs page](03-jobs.md) | Every day: lanes, the `Yours` and `Auto` tabs, the next-step bar, search, the quick look. |
| 4 | [A job](04-a-job.md) | Working one job: steps, the decision and its brief, the reader, the conversation, asks, notes and pins. |
| 5 | [Answering a decision fast](05-deciding.md) | Go, Send back, your own answer, the message box, Stop, the Desk. |
| 6 | [Auto, Auto mode and permissions](06-auto-and-permissions.md) | Deciding how much a job may do without you; hard lines; the go-ahead. |
| 7 | [Shipping](07-shipping.md) | PR #1, #2, #3; the PR lines; PR comments; what goes to GitHub. |
| 8 | [Desk, Inbox, Stacks, Telemetry, Crew-dex and Settings](08-other-pages.md) | The other pages. |
| 9 | [The website](09-the-website.md) | Using Starbase from your phone or another computer. |
| 10 | [Keys and ⌘K](10-keys-and-command-box.md) | Every key, made from the code. |
| 11 | [Troubleshooting](11-troubleshooting.md) | When Starbase says no, or nothing. |
| 12 | [Glossary](12-glossary.md) | A word you don't know. |

## About this guide

- It was written on 16 Nov 2026 from the code on the `feature/job-page-redesign` branch, and brought up to date on 17 Nov 2026 when the new job page became the only job page.
- The pictures are from the demo's made-up jobs (Widget Export, Crew schedule export, Nightly Export and others), at 1440 × 900 in the Light theme.
- Buttons are named exactly as the app shows them, in `backticks`.
- The key tables on page 10 are made by `docs/guide/keys-table.mjs` from `web/src/app/keyRegistry.ts`. Run it again when the keys change.
- Where the guide could not confirm something from the code, it says so in the text.

More detail lives in the [README](../../README.md) (what Starbase reads and changes, security, environment settings), [docs/install.md](../install.md) and [docs/hosting/vercel-setup.md](../hosting/vercel-setup.md).
