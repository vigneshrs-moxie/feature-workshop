# Packet V · Stacks, redone for big features

**Goal.** Stacks becomes the place you run a large feature from: a home page that shows every stack's progress, its parts at work, what needs you, and its risks at a glance. Each stack's page shows its parts and how they depend on each other. Each part has a detail page that looks as well made as the Job page. Asked for by Vignesh on 2026-10-29: "redo the stacks main screen since we will be using it for larger features and it would not be good if the home page of stacks looked like that, it looks drab and boring. we should be able to get more visibility into sub tasks of that stack and other useful features should be implemented too. also diving deeper into each sub task should look nice too."

**What's there today:** packet K's server (`dashboard/lib/stack.js`, `site/routes-stacks.js`) and K2's screens (`web/src/views/Stack/`). Screenshot of today: `/private/tmp/claude-502/-Users-moxie-Projects-feature-workshop/6544c091-ec11-4c7f-aa83-041922617dfd/scratchpad/r/after/light-1512-stacks.png`.
- The home is one grey row per stack: a name, "21 parts · read-only", four step dots and a chip.
- A stack's page has the merge map, step lines and part cards.
- There is no page of a part's own: a part opens its job.
- The demo has no stacks except the build stack.

**Port 4499 (screens 4500) · worktree `../ground-control-V` · branch `packet/V-stacks-home`.** Starts **from R's branch** (`packet/R-look-and-feel`), so it builds on R's controls, tokens and layout, and keeps merging R's branch in as R moves. It merges into main right after R. R leaves the Stack screens alone apart from the shared controls.

## The rules it follows
The design philosophy (`docs/design/design-philosophy.md`) and R's five rules. Big features carry a lot of information, so these matter most here:
- **Lead with now, needs you, next.**
- **One layer of detail**, with labelled folds.
- **Nothing jumps.**
- **Peek before you open.**
- **One line of "now" per part.**
- **Every state designed:** a clash, failed tests after a merge, a stuck part, a part waiting on another.
- **Simple by default, Full on request.**

"More visibility" means visibility you can get to, not everything on screen at once.

## 1. Stacks home
- **A summary line** across the top, in words with numbers: "3 stacks · 9 parts at work · 2 need you · 4 merged today". Each number is a filter.
- **One card per stack, two across on a Mac window and three from 1728 px.** Each card has:
  - **the goal:** the stack's title and its ticket, plus the "why" line from `stack.md`;
  - **a progress bar split into one segment per part**, in merge order. Each segment's state is a pattern and a word on hover: merged, being merged, checks running, at work, waiting on another part, needs you, stuck. Under it: "7 of 12 merged · 3 at work · 1 needs you";
  - **who's at work:** up to three now lines ("Part 4 · Builder · editing invoice.ts · 6m"), then "and 2 more";
  - **what needs you:** the top ask, with its one action (Approve plan, Merge next, Let the Foreman fix it);
  - **risks**, only when there are some: "Clash: parts 3 and 5 both change billing.ts", "Tests failed after merging part 6 (undone)";
  - **numbers** in tabular figures: time running ("4 days"), Claude cost so far (from Telemetry's record, the parts' jobs together), and the last activity ("2m ago").
- **Order is fixed:** stacks that need you first, then working, then done. Done stacks fold into "Finished (n)". Cards never reorder under the pointer.
- **Peek:** Space or a click on the card's body opens a side sheet with the stack's next step and its parts list; Enter opens the stack.
- **Empty state:** what a stack is, when to use one, "Start a stack from a ticket" (the Inbox) and "How stacks work".
- **The build stack** (this app's own packets) shows as one card like the others, marked "This app's build".

## 2. A stack's page
- **A header** with the goal and "why" line, the progress bar from the home card (larger), and one next-step bar with the one action.
- **A parts view with two ways to look**, both remembered:
  - **Board** (the default): parts in columns by state. Waiting on another part / Ready to start / At work / Checks / Ready to merge / Merged (folded) / Needs you (first, when not empty). Each part card has its number, name, one now line, its stop, and its one problem if it has one.
  - **Map:** the merge order and what each part waits on, drawn as a graph left to right. A part's arrows light up on hover. This is the K2 merge map, grown up.
- **Full detail** (or "Timeline" from the view switch) adds a **timeline**: one row per part, from start to merge, with now marked. It answers "what's taking long".
- **Details** (a sheet): the stack's settings (parts at once, merge on its own), the plan as written, and the history of merges and undos with times.
- Every problem state keeps its own designed state with one next action, as K2 built: the clash names both parts and the file, a failed merge says it was undone, nothing to merge, and so on.

## 3. A part's own page (`#/stack/<slug>/part/<n>`)
It looks and works like the Job page, which it is underneath, with the part's place in the stack around it:
- **The header:** "Part 4 of 12 · Invoice export", a breadcrumb back to the stack, the part's state chip, previous and next part (`[` and `]`), and "Open the job".
- **A context strip:** what this part is for (from its section in `stack.md`), what it waits on and what waits on it (links), its files ("Owns: 6 files"), its branch and its port.
- **The main column:** the go / no go bar if it needs you, the now line, and the activity grouped by kind and folded, as the philosophy asks.
- **The right column:**
  - the conversation with the part's Foreman and the message box;
  - **Changes:** files changed with +/- counts, from `git diff --stat` against the stack's branch, read-only, with one click to see a file's diff;
  - **Checks:** its tests and the result after the last merge attempt;
  - **Ready to merge:** a short checklist (checks passed, no clash, the parts it waits on merged), each item in words with an icon.
- **Merge** asks first, as K2's does. The push of the whole stack stays on the stack's page.

## 4. Demo stacks
The demo gets three stacks in their own temp folder:
- one at Plan, waiting for your approval;
- one mid-build with 12 parts in every state, including a clash and a failed merge undone;
- one finished.

That way every state can be seen and screenshotted. Never touch real folders.

## Server work it needs
- **Per part:**
  - its now line (from the part job's crew activity, as the Stage gets it);
  - its time started and merged (from the stack's log);
  - its Claude cost (from the usage record by job slug);
  - its changed files with counts (`git diff --stat`, read-only, cached by the branch's head);
  - its blockers and dependents (from the plan).
- **Per stack:** the summary counts, risks, cost and time running.
- **Routes:** `GET /api/stacks` and `/api/stacks/:slug` gain these fields. They add, never change. Add `GET /api/stacks/:slug/part/:n` for the part page, and `GET /api/stacks/:slug/part/:n/diff?file=` for one file's diff.

## Owns
- `dashboard/lib/stack.js`, `dashboard/site/routes-stacks.js`, a new `dashboard/lib/stack-parts.js`, and their tests;
- the Stacks shapes in `web/src/api/types.ts`;
- `web/src/views/Stack/` (all of it), and the router entry for the part page;
- the demo stacks in `dashboard/demo/` (a new file, plus the line that calls it in `run-demo.js`; R owns the rest of `run-demo.js`, so coordinate by keeping it to one line);
- Stacks' entries in `keyRegistry.ts`.

## Steps
1. **Server and demo stacks:** the new fields and routes, with tests (fixture stacks, a fake git for the diff stat), and the three demo stacks.
2. **Stacks home**, as above.
3. **A stack's page:** board, map and timeline.
4. **A part's page.**
5. **Checks:**
   - screenshots at 390, 1280, 1512, 1728 and 1920 px, in Light and Default, with Play full and off;
   - the no-jump check (switching views and folding Merged moves nothing else);
   - keys in Settings → Keys;
   - before/after montages.
   Stop and hand back with the montages, so Vignesh can look.

## Acceptance
- The Stacks home shows, without clicking: every stack's progress by part, who's at work, what needs you and its risks. Each stack is one card with a peek.
- A stack's page shows its parts as a board (default), a dependency map and a timeline.
- Each part has a page of its own that reads like the Job page, with its place in the stack, its changes, its checks and a merge checklist.
- All of it is in R's controls and style, and nothing jumps.
- Status is always in words.
- The demo shows every state.
- All tests are green, with no model calls.

## Rules that apply to every packet (read once, obey always)
- **Base:** `packet/R-look-and-feel` (R's branch); merge R's branch in again before handing back. **Worktree:** `git worktree add ../ground-control-V -b packet/V-stacks-home packet/R-look-and-feel`.
- **Port:** 4499 (screens 4500). **Never use 4477, 4479 or 4485.** Leave the other demos' ports alone (4481–4497).
- **Owned files only.** Anything else goes under "Needs from others". R is restyling the rest of web/src, S is building the 3D floor, and U is changing Telemetry's server side.
- **Tests:** `npm test`, `cd web && npx vitest run` and `npx tsc --noEmit -p .`, green before each commit. **No model calls in tests.**
- **Never push, never open a PR, never merge.** One commit per step, plain messages.
- **Status is never shown by colour alone; themes change looks only; keys never fire while typing or with a dialog open.** Theme tokens only.
- **Plain words; no product name** (use `BRAND`/`PRODUCT`; the build stack says "This app's build").
- **Hand-back format:** packet id, branch, last SHA, what was done per step, test output tail, anything not done and why, "Needs from others".
