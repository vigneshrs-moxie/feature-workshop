# One prompt, PR comments in one click, a Desk that agrees (design, 18 Nov 2026)

Four changes to Starbase, asked for by the owner on 18 Nov 2026 after a day of using the job page.
The plan that builds them is `2026-11-18-one-prompt-plan.md`, beside this file.

## Why (his words)

- "what i wanted was to be able to send a message at any point, it didnt have to be answered
  immediately. it just felt like it was getting hard to know how to do that with 3 or 4 different
  inputs like one yes(go) or no(send back) from decisions, one from the conversations tab, one in the
  middle tab, i wanted that to be simpler and basically closer to the claude code on the terminal
  experience."
- "make sure addressing github comments from reviews are easy and is super simple and picked up fast.
  we want the github pull to be done easily too and should be able to see the comments, other stuff
  etc and just address them by clicking a button or something ideally. again, as close to the claude
  code on terminal experience for this too."
- "if i address something for a job inside the job, then it shouldnt still show up at my desk as a
  number or a row"
- "i have gotten admin access to the repo and no longer need raj's approval to merge to staging
  atleast."

He approved the shape of part 1 from a text sketch: "for now, this shape looks good". Parts 2 to 4
he has not seen as a design; the calls made for them are listed at the end, his to correct.

## What Starbase does today (read from the code, 18 Nov)

**Typing.** On the wide page there are three places to type and one action split across two of them:
Go, Send back and a question's `Your own answer` field sit top left (Your move); the message box sits
bottom right under the conversation, and Send back takes its words from there; the reader has the note
box and a search field that looks like an input. In the box, ⌘↵ at a go-ahead is Go, so a typed
question approves the step.

**PR comments.** Three engines read the same GitHub data after every whole-map refresh and do not
talk to each other: single-comment Desk cards (`lib/pr-feedback.js`), review rounds
(`lib/review-round.js`: fix, then one Send back that pushes, posts the replies, resolves threads and
asks for the review again) and the job page's rows with `Fix these` (`lib/pr-comments.js`: no resolve,
replies posted one by one, and no way to push a fix for PR #2). A new comment can sit for ten minutes
before Starbase reads it. Pull now refreshes every repository. Threads resolved on GitHub are never
read. The `bot` flag is read and then dropped. On a laptop the PR line shows no comment count and no
link to the comments.

**The Desk.** The top bar's number, the Desk's list and the job header's `Next · n wait` are worked
out in three places with three rules, and only the Desk screen remembers what he settled there. A job
whose Go is held for the usage limit, queued on the website, or waiting behind a running reply still
counts as waiting for him.

**PR #2.** The skills, Orbit's profile (`dashboard/profiles/orbit.md`) and the Desk's nudges all say
Raj reviews and merges PR #2.

## Approaches considered

**The prompt**
1. **One prompt block at the foot of the conversation (chosen, approved).** What the Foreman asks
   sits directly above the one box; the top-left card goes. Closest to the terminal.
2. Keep Your move top left and only remove the extra fields. Less change, but the buttons and the
   words they carry stay in opposite corners, which is what he tripped over.
3. A chat-only page with no reader. Loses the document beside the conversation, which he uses.

**PR comments**
1. **Every address is a review round (chosen).** A round already has the whole finish (push, the
   follow-up PR #1 for a PR #2 change, replies, resolve, ask again) behind one Send back. A round opens
   by his click when a reviewer's own review did not open one. One engine, one finish.
2. One button over the three engines, picking the path. Keeps the gaps (PR #2 fixes with no push,
   replies one by one) and adds a fourth set of rules.
3. Rewrite the three readers into one. Right in the long run, too large for this round; the plan only
   makes them share one read.

**The Desk**
1. **The server says whose turn it is, and the web has one function for the queue (chosen).** Works
   across tabs, reloads and the website.
2. A browser list of what he settled, shared by the screens. Fails with the Desk in one tab and the
   job in another.

## The design

### 1. One prompt

```
 Conversation
 …
 Foreman: review done, 1 open finding.
 ─────────────────────────────────────────────
 [ Fix the open findings ] [ Go faster ]   ⌘K      quick asks, as today
 Waiting for you · since 3:27 PM                    the status line, as built 18 Nov
 PR #2 · 3 comments to address  [Address them] [Look]   only when a PR needs him (part 2)
 Open PR #1?                                         the Foreman's ask, only when it asks
 [ Go · open PR #1 ]  [ Send back ]
 ┌─────────────────────────────────────────┐
 │ Write to the Foreman…                   │  [Send ↵]   the only box
 └─────────────────────────────────────────┘
```

- **One box.** Enter sends its words as a message, at any time: while the Foreman works (read at its
  next step), while it waits, at a go-ahead. Shift+Enter is a new line. A message never approves.
- **What the Foreman asks sits directly above the box**, only when it asks: the ask, each question's
  options, Go and Send back; a permission's Allow once and Deny. Send back carries the box's words as
  the change; Go carries them as its note.
- **Your own answer is the box.** A question keeps its `Your own answer` row, with no field of its
  own: picking it puts the cursor in the box.
- **The top-left card goes** on a laptop. The page is the steps across the top, the document on the
  left, the conversation with its prompt on the right.
- **One text box on the page.** The conversation's search folds to an icon (`/` opens it).
- **One status, one Stop**, both on the status line.
- The phone keeps its order (one column, the ask at the top) and takes the same rules.

### 2. PR comments: fast, visible, one click

- **Picked up fast.** Starbase asks GitHub one cheap question per open PR (has it changed?) every
  30 seconds for a job whose page is open and every 3 minutes for the rest, and reads the comments only
  when the answer is yes. Pull now reads just that job's repository.
- **Visible where he types.** One PR line in the prompt whenever a PR needs him, with a count; the
  laptop's PR lines and the Ship step show the count and open the comments; the notification names the
  PR and the job.
- **One click to address.** `Address them` sends every unanswered comment and failed check to the
  Foreman as a review round. `Address this` on one comment does the same for that one.
- **One click to finish.** When the Foreman is done: `Send back…` lists what will go (push, the
  follow-up PR #1 when the change was asked on PR #2, the replies, the threads to resolve, the review
  request) and sends it all after one yes.
- **Truer rows.** A thread resolved on GitHub is answered. A reviewer that is a bot is marked so, and
  is never asked for a review again.

### 3. A Desk that agrees with the job page

- A job is on the Desk only while it is his turn: it waits for him and nothing he sent is on its way
  (no reply running, no reply held for the usage limit, no message waiting behind a reply; on the
  website, no decision of his still waiting for the laptop).
- A job with a review round counts once, as its round. Today the top bar also counts the PR nudges
  the Desk's list hides for such a job.
- One function works out the queue; the Desk, the top bar's number, the header's `Next · n wait`, the
  Jobs page's Desk count and the tab title all use it.
- A PR that needs him is one Desk entry per PR, the same round the job page shows, so addressing it in
  either place settles it in both.

### 4. PR #2 without Raj's approval

- Orbit's route becomes: PR #2, the moxie branch into staging, he merges it. No reviewer is named.
- The Desk no longer asks "Ask Raj for a review?" for PR #2. With the checks passing it offers the
  merge. A review can still be asked for in words: the Foreman requests it with his yes.
- The skills say the same (written 18 Nov on the skills branch `feature/pr2-you-merge`, not merged).
- PR #3 is unchanged.

## Not changing

The phone's layout; the reader's views; the payload's speed rules; how a message, a Go and a Send
back reach the Foreman; what a review round's Send back does; PR #3; the hard lines and every "nothing
goes to GitHub without his yes" rule; the hosting, storage and compute work (a later session).

## Calls I made (his to correct)

1. Enter sends and Shift+Enter is a new line on a laptop; on the phone Enter stays a new line and the
   Send button sends.
2. ⌘↵ sends when the box has words. With an empty box at a go-ahead it is still Go, so the fast yes
   from the keyboard stays. A plain Enter never approves.
3. At a go-ahead, notes pinned in the reader go with whichever button he presses (Send: a message;
   Send back: the change; Go: done as part of the go). The Send button no longer turns into Send back.
4. A question's `Your own answer` row stays (so the pick is clear) and uses the box for its words.
5. Every address runs as a review round, also for one comment and for a bot's comments.
6. The quick asks row stays above the status line.
7. The watch's times: 30 seconds for the open job, 3 minutes for the others.
8. When GitHub refuses the PR #2 merge because a review is still required there, Starbase offers
   `Merge as admin` as its own button with its own yes. It never uses the admin right silently.
9. The `/feature` paragraph "A message at any time" (skills branch `feature/talk-anytime`) is
   rewritten to the smaller rule he described: read at the next step, answered in a few lines, the
   step carries on; a change waits for the step's end unless he says now. It stays unmerged until he
   says.
