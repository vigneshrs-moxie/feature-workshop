# 12. Glossary

Every word Starbase uses that a newcomer might not know, in alphabetical order.

**The one thing to remember:** "Auto" (a switch on a job) and "Auto mode" (a permission setting) are different things.

| Word | Meaning |
|---|---|
| **Approver** | The read-only agent (on Fable) that answers for you on a job with Auto on. In the conversation its messages say `Auto`. |
| **Asks** | One-click requests to the Foreman, fitted to the open step, in the row above the message box and in `⌘K` on the new job page. Hovering one shows the exact words it sends. |
| **Auto** | A switch on a job: "Auto: run to PR #1 without asking me." The Approver answers each step and takes the recommended answers up to PR #1. It never merges. [Page 6](06-auto-and-permissions.md#auto-run-to-pr-1-without-asking). |
| **Auto mode** | One of the three permission settings: Claude Code's safety model judges each step. [Page 6](06-auto-and-permissions.md#the-permission-setting). |
| **Auto start** | Settings → Workflow: tickets with your chosen Orbit tag start by themselves as Auto jobs, up to a number at a time. |
| **Brief** | What the Foreman writes at the end of a step: what happened, the decisions for you, and what comes next. Numbered (`Brief #6`). |
| **Crew** | The worker agents: Scribe (spec), Sleuth (investigation), Draftsman (plan), Builder (build), Tester (checks), Head inspector, Locksmith, Gauge, Stickler, Fuse, Mason, Stopwatch and Painter (reviews; Painter also draws the screens), Oracle (Fable second looks). |
| **Crew-dex** | A card per crew member, with Play on. |
| **Decided for you** | Small calls the Foreman (or Auto) made without asking. Counted under Your move; Go confirms them. Listed under `Decisions`. |
| **Desk** | The page with every waiting decision from every job, one at a time. |
| **Finish line** | When a job counts as finished (Settings → Workflow): PR #1 open, PR #1 merged (the default), in staging, in main, or when you mark it done. |
| **Foreman** | The Claude session that runs a job and talks to you (the `/feature` or `/bugfix` conductor). |
| **Gate, go-ahead** | The point at the end of a step where the job waits for your Go or Send back. |
| **Go-ahead (for hard lines)** | In Auto mode only: your approval of the PR stage also covers the push and opening PR #1, and `rm -rf` inside the job's folders. |
| **Hard line** | A command that always asks you (a push, a pull request, a merge, `rm -rf`, a database change) or is always refused (a force push, a push to the org repository), whatever the setting. |
| **Inbox** | Your Orbit tickets, with `Start` to make one a job. |
| **Job** | One feature or bug fix, with its own folder (in `~/.claude/feature-work/`), branch and worktree. |
| **Lane** | Where a job sits on Jobs: Working, Needs you, In review, Ready to merge (and Resting, Done folded below). |
| **Level** | How much process a job gets: L0 Tweak, L1 Small, L2 Standard, L3 Large. |
| **Lounge** | The website page that shows who on the team is online and what is running. |
| **Mirror** | The website's copy of your jobs, sent up by your laptop. |
| **Next-step bar** | The bar at the top of Jobs, the Desk and other pages that names the one next thing to do, with one button. |
| **Notes** | Points you leave on blocks in the reader (`Change`, `Drop this`, `Explain`); they gather as chips in the message box and go with your next Send, Send back or Go. |
| **Orbit** | The ticket system the Inbox reads (read-only). |
| **Permission** | A crew member's request to run something that needs your yes: `Allow once`, `Allow for this run`, `Deny`, `Always allow…`. |
| **Pin** | A numbered note on a spot of a recording frame or a pasted picture. |
| **Play** | Settings → Play: Off, Subtle or Full. Adds the crew characters, achievements and (Full) the 3D Station. |
| **PR #1, PR #2, PR #3** | Your fork → the same-named org branch; the org branch → staging; staging → main. [Page 7](07-shipping.md). |
| **PR lines** | The Ship step's three lines, one per pull request, each with at most one button. |
| **Quick look** | The panel on Jobs that shows a job without leaving the page (`Space` or a click on a card). |
| **Reader** | The part of the new job page that shows one thing at a time: a brief, a document, the changes, the checks, the PR lines. |
| **Risky call** | A step where Auto took the safer option because it was unsure. Listed under `What Auto decided` and in PR #1's description. |
| **Rules** | `Always allow` rules you saved from permission cards (Settings → Rules). |
| **Send back** | No go: the words in the message box are the change you want. |
| **Stack** | A big ticket split into parts built side by side and merged one after another. Each part is its own job. |
| **Staging QA** | Checking the feature on staging, between PR #2 and PR #3. |
| **Station** | The 3D layout of Jobs, with Play set to Full. |
| **Step** | One of the seven columns every job shows: Spec, Investigate, Plan, Build, Test, Review, Ship. Older screens call them stops. The workflow's own stages (Clarify, Refine, Screens, Spec update, Triage, Reproduce, Diagnose, PR #1…) fold into them. |
| **Step panel** | Beside the reader on a laptop: what the picked step made. |
| **Team site, website** | The optional hosted copy of Starbase (Vercel, Google sign-in). [Page 9](09-the-website.md). |
| **Try it** | Running a job's branch on your laptop: its app on its own port, your settings file copied, your local database switched to the job's branch. |
| **What Auto decided** | The list of an Auto job's risky calls and refusals. |
| **Worktree** | The job's own copy of the repository, on its own branch, where the crew builds. |
| **Your move** | The card on the job page that says what the job needs from you: a go-ahead, an answer or a permission. |

## Back to the start

[Guide index](README.md).
