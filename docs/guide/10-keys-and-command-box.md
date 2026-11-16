# 10. Keys and ⌘K

Almost everything in Starbase has a key, and `⌘K` (Ctrl+K on Windows and Linux) finds anything else by name.
This page has the rules every key follows, what `⌘K` holds, and every key in the app.

**The one thing to remember:** press `?` on any page to see the keys that work there, and `⌘K` when you don't know where something is.

## The rules

- Single-letter keys never fire while you type in a field, or while a dialog or menu is open.
- `g` then a letter, within 1.5 seconds, is a jump: `g j` Jobs, `g d` Desk, `g n` the next job that needs you, and so on.
- `Enter` and `Space` on a button, link or tab belong to that control.
- A held key never repeats (except the arrows in the Table).
- When the same key means different things, the most specific place wins: on the Desk its `j` and `k` win; on the new job page its keys win (so there `g t` is the ticket and goal, not the Table, and `n` adds a note, not Notes and options).
- **Settings → Keys** turns the shortcuts off. Then only what any web page has still works (`⌘K`, `⌘↵`, `Esc`, `Enter`, the arrows in a list).

## ⌘K: search or run a command

`Search or run a command` in the top bar, or `⌘K`, opens the command box. Type words: every word must appear in the action's name, its hint words or its group. `↓` `↑` move, `Enter` runs, `Esc` closes.

It lists, depending on where you are:

- **This job** (on a job's page): `Stop the reply` or `Steer the reply in progress` while the Foreman replies, else `Write to the Foreman`; `Mark done or dropped…` or `Reopen this job`; `Permissions for this job: …`; `Job notes and options`; `Open docs`.
- **Jobs:** `New job…`, and `Open <job>` for every job, the ones that need you first.
- **Go to:** `Settings`, `Crew-dex` and `Achievements` (with Play on), `Keyboard shortcuts`.

**On the new job page** (on a laptop), `⌘K` opens the page's own box instead: the asks for this step and any step, the asks you kept, the page's places, and a last row, `Every Starbase action`, which opens the box above. See [page 4](04-a-job.md#the-asks-row-and-k-everyday-requests-in-one-click).

## Every key

The tables below are made from `web/src/app/keyRegistry.ts` by `docs/guide/keys-table.mjs` (run `node docs/guide/keys-table.mjs` from the repository's root to make them again after the keys change). Keys with ⌘ are Ctrl on Windows and Linux (shown in brackets). "g then j" means press `g`, let go, then press `j`.

<!-- GENERATED from web/src/app/keyRegistry.ts by docs/guide/keys-table.mjs: do not edit by hand -->

### Everywhere

On every page, outside a text box.

| Key | What it does | Where |
|---|---|---|
| `⌘K (Ctrl+K)` | Search every action you can take right now | Everywhere, even while typing or with a sheet open. |
| `?` | Show this list |  |
| `c` | Start a new job |  |
| `g then j` or `g then h` | Go to Jobs |  |
| `g then i` | Go to the Inbox |  |
| `g then m` | Go to the flow map |  |
| `g then t` | Go to the Table |  |
| `g then d` | Go to the Desk |  |
| `g then n` | Open the next job that needs you | The one that has waited longest, other than the job you are on. |
| `g then s` | Go to Settings |  |
| `g then x` | Go to the Crew-dex (Play mode) |  |
| `u` | Check GitHub now | Where the GitHub line shows: Jobs and a job’s Ship step. |
| `Esc` | Close the menu, sheet or drawer on top |  |
| `r` | Telemetry: read the limits now | On the Telemetry page only; on the Desk, r is No go. |
| `←` or `→` | Telemetry: step through the weekly line’s readings, or the weekday map’s squares | With the focus on the weekly line or the weekday map (Tab to it). |

### Jobs

On every page but the Desk; the order is the Jobs list’s.

| Key | What it does | Where |
|---|---|---|
| `j` | Open the next job |  |
| `k` | Open the previous job |  |

### The Jobs page

On Jobs, the four lanes.

| Key | What it does | Where |
|---|---|---|
| `o` | Open the job the next-step bar names | When a job needs you. |
| `/` | Find a job | Then ↓ ↑ to pick, Enter to open, Escape to clear. |

### The new job page

On a job’s page while the new page is switched on; there its keys win over the others.

| Key | What it does | Where |
|---|---|---|
| `[` | Open the step before |  |
| `]` | Open the step after |  |
| `j` | Move to the next line | The steps and the job’s rows on the left; the conversation’s lines when you are in it. |
| `k` | Move to the line before | The steps and the job’s rows on the left; the conversation’s lines when you are in it. |
| `Enter` | Open that line in the reader | On the line j or k moved to (they move the focus). |
| `/` | Search the conversation |  |
| `g then c` | Open the conversation |  |
| `g then t` | Open the ticket and goal |  |
| `c` or `i` | Put the cursor in the message box |  |
| `n` | Add a note on the part under the pointer: Change, Drop this or Explain | In the reader, with the pointer on a block. Notes and options are in the ⋯ menu. |
| `x` | Tick or untick the PR comment under the pointer | In a PR’s view, with the pointer on a comment. |
| `⌘K (Ctrl+K)` | Asks and places: everyday requests to the Foreman, and the page’s places | On a laptop; on the phone, and on other pages, ⌘K is every action. Every action is also its last row. |
| `⌘↵ (Ctrl+Enter)` | Go: send the picks shown | While Your move waits for your yes; from anywhere on the page, the message box too. |
| `a` | Go, or Allow once | While Your move waits for your yes. Never allows a hard line or a risky step. |
| `r` | Send back: the words in the message box are the change | While Your move waits for a go-ahead. With an empty box it puts the cursor there. |
| `↓` | Move to the next option in Your move | While Your move asks questions, outside the reader. |
| `↑` | Move to the option before | While Your move asks questions, outside the reader. |
| `Space` | Pick that option | On the option ↑ or ↓ moved to. |

### The open job

On a job’s page.

| Key | What it does | Where |
|---|---|---|
| `n` | Open the job’s Notes and options | On a job. |
| `c` or `i` | Put the cursor in the message box | On a job; elsewhere c is New job. |
| `Enter` | Step into the screens (the page’s own keys then work) | With the Screens tab showing and nothing else focused. |
| `Esc` | Step out of the screens, back to the page | Inside the screens. |
| `⌘↵ (Ctrl+Enter)` | In the message box: preview and send, or steer a reply in progress |  |

### The open step

On a job’s page.

| Key | What it does | Where |
|---|---|---|
| `[` | The step before this one |  |
| `]` | The step after this one |  |

### The gate card

While a gate card waits for your decision, on the job or on the Desk.

| Key | What it does | Where |
|---|---|---|
| `a` | Approve | Only when the card asks no questions and the plan hasn’t changed. |
| `e` | Edit, then approve |  |
| `r` | Revise with feedback |  |
| `o` | Other guidance | On the job only: on the Desk, o opens the job. |
| `1` or `2` or `3` | Pick that answer to the first unanswered question |  |
| `.` | Open or close “Adjust the next step” |  |
| `v` | Open or close the decisions made for you | Only when the card has some. |

### The permission alert

While a permission waits at the top of a job.

| Key | What it does | Where |
|---|---|---|
| `a` | Allow once | Never for a hard line or a risky step. |
| `d` | Deny (you can say why) |  |

### The Desk

On the Desk, while something waits for you.

| Key | What it does | Where |
|---|---|---|
| `j` | Next decision |  |
| `k` | Previous decision |  |
| `↓` | Next decision | Inside the queue. |
| `↑` | Previous decision | Inside the queue. |
| `o` | Open the job |  |
| `a` | Approve, or Allow once | Never for a hard line, a risky step or a question. |
| `d` | Deny a permission | On a nudge: put it away. |
| `r` | No go: send back | On a go-ahead: say what to change. |
| `c` | Reply without deciding | On a go-ahead; elsewhere c is New job. |
| `b` | Show or hide the brief | On a go-ahead. |

### A review round

On a job’s Ship step while its pull request is in review.

| Key | What it does | Where |
|---|---|---|
| `a` | Go: the round’s next step (fix with the Foreman, send back, try again) | Never merges: merging asks first. |
| `r` | No go: leave it for now, or not yet |  |
| `o` | Go to the round’s items |  |
| `p` | Open the pull request on GitHub |  |
| `m` | Merge…: shows the ask first (a hard line) | When you are the one who merges. |

### Stacks

On Stacks, a stack’s page and a part’s page.

| Key | What it does | Where |
|---|---|---|
| `a` | Approve the plan: the parts start building | While the plan waits for your check. |
| `r` | Change something, or Not yet: send the Foreman a note | On the plan, or on a part that is ready to merge. |
| `m` | Merge the part that is next in order | When it is ready; on the build stack, Merge next. |
| `p` | Push: asks go / no go first | When every part is merged; in the go / no go box, p is Go. |
| `o` | Open the part that needs you, or the job once it is pushed |  |
| `f` | Let the Foreman fix it | When a part clashes, changed files that aren’t its own, or got stuck. |
| `j` | The next stack, or the next part | On Stacks and a stack’s page; the quick look follows. |
| `k` | The previous stack, or the previous part | On Stacks and a stack’s page. |
| `Space` | A quick look at the picked stack or part | On Stacks and a stack’s page. Esc closes it. |
| `Enter` | Open the picked stack, or the picked part’s page | On Stacks and a stack’s page. |
| `1` | Show the parts as a board | On a stack’s page. |
| `2` | Show the parts as a map of what waits on what | On a stack’s page. |
| `3` | Show the parts on a timeline | On a stack’s page. |
| `d` | Details: the stack’s settings, its plan and its history | On a stack’s page. |
| `[` | The part before this one | On a part’s page. |
| `]` | The part after this one | On a part’s page. |
| `o` | Open the part’s own job | On a part’s page. |

### The Inbox

On the Inbox, outside a text box.

| Key | What it does | Where |
|---|---|---|
| `s` | Start a job on the ticket | The open ticket, else the row with the focus, else the one the next-step bar names. |
| `S` | Start the ticket as a stack (for a big ticket) | Shift+S. The same ticket as s. |

### The Flow map

On the Flow map.

| Key | What it does | Where |
|---|---|---|
| `j` | Highlight the next row |  |
| `k` | Highlight the previous row |  |
| `Enter` | Open the highlighted job |  |
| `o` | Open its newest PR on GitHub |  |
| `/` | Jump to the filter chips |  |
| `1` or `2` or `3` or `4` | Pick that filter chip: All, Needs you, Shipping, the first repo |  |

### The Table

With the focus on a job in the Table.

| Key | What it does | Where |
|---|---|---|
| `↓` | The next job |  |
| `↑` | The previous job |  |
| `Enter` | Open the job |  |

### The station

On Jobs with the Station layout (Play full): each bay is a job.

| Key | What it does | Where |
|---|---|---|
| `j` | The next bay |  |
| `k` | The previous bay |  |
| `→` or `←` or `↓` or `↑` | Move between bays, row by row | With the focus on the station (Tab to it). |
| `Enter` | A quick look at the bay’s job, with Go / No go when it waits | When a bay is picked. |
| `o` | Open the picked bay’s job | When a bay is picked; otherwise o opens the job the next-step bar names. |
| `Esc` | Put the bay down (close the quick look first) |  |

### Settings

On the Settings page.

| Key | What it does | Where |
|---|---|---|
| `j` | The next section |  |
| `k` | The previous section |  |
| `/` | Find a setting |  |

### In ⌘K

While the command palette is open.

| Key | What it does | Where |
|---|---|---|
| `↓` or `↑` | Move in the list |  |
| `Enter` | Run the highlighted action |  |

<!-- END GENERATED -->

## Next

[11. Troubleshooting](11-troubleshooting.md).
