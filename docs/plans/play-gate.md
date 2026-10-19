# Play layer · Gate review (2026-10-19)

**In one line:** the crew are back. Characters on handoff lines and the live row, a Crew-dex, achievements and quests, and in Full mode a quest track, a boss fight for L3 reviews and stamina. Thirteen easter eggs are hidden around the page. All of it runs on local data only and is switched by one setting (Full · Subtle · Off). Built on `redesign/play` (off `redesign/phase-2`); not pushed or merged.

## What's built

- **Play mode** (Settings → Play): Full, Subtle (the default) or Off. Off is the phase 2 page exactly. The crew headers and the teapot are gone too, and the play ledger isn't read or written. Also in Settings → Play: "A quest counts as done when…" (*the first PR is created* by default, or *I mark the job done*) and Sounds (Full only, off by default).
- **The crew:** fifteen characters, one per worker type, on handoff and dispatch lines, the live row, review briefs (the lenses line up) and by each job's title (the Foreman). Subtle keeps them still and small; Full moves them. Reduced motion holds every one still. All eight themes style them through tokens.
- **Crew-dex** (top bar, or ⌘K): #001–#015 with rarity by model and real stats from your jobs. Anyone you haven't met yet is a silhouette, and each card has a bio on its back. The header counts "Secrets found n/13" without saying which.
- **Achievements and quests** (⌘K or the Crew-dex): ten you can see, thirteen secret. A quest is a finished job, counted once; reopening a job and finishing it again never awards twice. Achievements reward finished work, never approvals. Toasts sit bottom-right over the Preview pane, never over a gate card, a permission card or the message box. They go by themselves after about 5 s.
- **Hidden themes:** CRT Terminal (the Konami code) and Gold (ten quests). The dashboard decides when they unlock; editing the browser's storage can't open them.
- **Full-mode extras:**
  - **Quest track:** under the title, with the level as difficulty (★–★★★★) and the stages as a path. It finishes by the quest rule you picked.
  - **Boss fight:** under an L3 review brief, with findings as hit points (blocker 5, major 3, minor 1). It drains as fix rounds land and is defeated once no blockers or majors are left; minors are yours to decide.
  - **Stamina:** in the top bar, drawn from Claude's usage limit, using the measured percentage when Claude gives one.
  - **Sleeping crew:** during a usage pause, the crew sleep. They show a time to wake up only when jobs will carry on by themselves.
  - **Celebrations and sounds:** a small burst in Subtle and a bigger one in Full. Sounds are opt-in, one blip per batch of toasts.
- **Scenes:** the eggs' short scenes move once, for under 1.5 s with delays included, then hold still. Nothing moves under reduced motion.
- **Easter eggs (13):** listed under "The secrets" below; the page never explains them.

## How to try it

```sh
npm run web:build && PORT=4479 npm run demo
```

Open **http://127.0.0.1:4479/next/**. A pretend Foreman answers, the jobs are invented, and it costs no Claude usage. To see the whole quest, set Settings → Play mode to Full and open **Invoice Merge**:

1. **Approve: the review.** All eight lenses look at the change. The boss fight shows 12 of 12 hit points.
2. **Approve: the fix round.** "Boss defeated · 1 minor left for you".
3. **Approve: PR #1.**
4. **Approve: PR #1 opens.** "Quest done".

Screenshots: `docs/design/play-2026-10-19/` (README there).

## The achievement rules

A quest is done when the job's first PR is created (status.json `prs[0]` gets a link), or when you mark it done if that's your setting. Times come from the session logs. A quest whose real time isn't known never counts toward Night Owl or Speedrun.

| Achievement | How to get it |
|---|---|
| First Quest | Finish your first quest. |
| Clean Sweep | Get a job's first review round back from the lenses with zero findings. |
| Speedrun | Take an L0 job from start to done in 15 minutes or less. |
| Full Panel | Have all 8 review lenses look at one job. |
| Boss Slayer | Finish an L3 quest. |
| Bug Hunter | Finish 10 bug quests. |
| Night Owl | Finish a quest between midnight and 4am. |
| Comeback | Finish a job on the same day it carried on after a usage-limit pause. |
| Explorer | Try all five themes besides Default. |
| Collector | Meet all 15 crew members. |

## The secrets (not shown on the page)

| Secret | How it's found |
|---|---|
| Up, Up, Down, Down | ↑↑↓↓←→←→BA anywhere outside a text field. Unlocks CRT Terminal and puts it on. |
| Stop! Hammer Time | ⌘K `hammertime`: the Builder dances. |
| Okay. | ⌘K `sudo make me a sandwich`. |
| Nice Try | ⌘K `rm -rf /`: the Locksmith's door, "Hard line. Nice try." |
| Not It | ⌘K `git blame`: the crew point at each other. |
| Short and Stout | `GET /api/teapot`: a real 418. Counts from this browser or a terminal, never from another site's page. |
| Clacks Overhead | Every ordinary response (not the live event stream) has `X-Crew`, `X-Clacks-Overhead: GNU Terry Pratchett` and an `X-Crew-Note` pointing at `/api/teapot?from=headers`. Following it finds this one. |
| Behind the Curtain | The DevTools console shows the crew and a hint; `crew.hello()` answers. |
| Lost and Found | A `#/` address that isn't a page: the Sleuth looks for it. |
| Hex Sommelier | A commit on a job's branch (its own commits, base..branch) whose hash starts with `c0ffee`, `dead`, `beef` or `f00d`. The dashboard looks on its full job read, about once a minute, one job at a time, and stops once it has been found. |
| Seven Knocks | Seven quick clicks on the Foreman by a job's title: a one-liner. |
| Friday Deploy | A `git push` permission card on a Friday from 4pm: the Locksmith raises an eyebrow under the buttons. It never changes the decision. |
| Hat Season | Seasonal hats on Halloween, Christmas and New Year. Nightcaps from midnight to 5am don't count. |

The page can report only the ten it sees: a POST for the teapot, the headers or the Hex Sommelier is refused. The teapot and the headers are found by visiting the address, which any page of the dashboard could do too. Another site's page can't (`Sec-Fetch-Site`), except in browsers too old to send that header. For two joke secrets that's acceptable.

## Tests (real run, 2026-10-19)

- `npm test`: 283 / 283
- `npm run web:test`: 525 / 525
- `npx tsc --noEmit -p web`: clean
- `npm run web:build`: builds (504 kB, see below)
- No test calls Claude.

**Demo walk:** headless Chrome clicked through the demo and checked 32 things, all passing, with no console errors. It covered:
- Subtle, Full and Off;
- the Crew-dex;
- the L3 review, fix round and PR #1 to a finished quest;
- the "I mark the job done" rule;
- each ⌘K phrase, the Foreman's knocks, the 404, the teapot, the console and the Konami code;
- all eight themes.

**Reviews:** an independent review after steps 2, 4, 6 and 8.
- **Step 6:** two major problems (old toasts came back after a restart; the boss fight rarely drained) and seven minor ones. All are fixed except the hidden-theme flash (below).
- **Step 8**, covering steps 7 and 8: two major problems (scenes kept moving past 1.5 s, even in Subtle; the Hex Sommelier ran git for every job on every refresh) and seven minor ones. All are fixed, or worded more exactly here.

## Known gaps

- **Hidden-theme flash:** a stored CRT or Gold theme paints Default for a moment on load, until the ledger says it's unlocked. This is on purpose, so the browser alone can never unlock it.
- **Gold screenshot:** Gold needs ten quests, which the demo doesn't have, so its screenshot was taken with the theme put on by hand.
- **Date-bound eggs:** the Friday eyebrow and the seasonal hats aren't pictured. Tests cover them.
- **Bundle size:** the bundle is 504 kB, just over Vite's 500 kB warning. It's one local bundle, so nothing is split.
- **Boss Slayer in the demo:** the demo's Report Scheduler is a finished L3 job, so Boss Slayer is already earned when the demo starts. Finishing Invoice Merge shows only "Quest done".
- **Push prompts in the demo:** the pretend Foreman reads "push" in the PR #1 approval as a request to push, so that step also asks before a push and shows a refused force push. That behaviour is from phase 2.
- **Test gaps:**
  - From the step 6 review: no server test that boss events reach the live stream, and no server test of a reopened job.
  - From the step 8 review: no server test of the Hex Sommelier's git reading (the pure part is tested).
  - The demo walk covers Off across the whole page.
- **Real jobs:** no real job has run with Play on yet.

## Appendix: choices made while building

- **Boss defeat** (your call, 2026-10-19): the boss falls once no blockers or majors are left. A review that never had either has no boss.
- **Mutes:** turning Play back on, or changing the quest rule, celebrates nothing from before. That holds even if a refresh is already reading when you change it. Something that happens a moment later, like a job marked done right after the rule changes, still gets its toast.
- **Konami:** it picks CRT Terminal, which goes on once the ledger confirms the unlock, so the page never decides an unlock by itself.
- **404:** only an unknown `#/…` address shows the Sleuth's page. An in-page `#section` link still shows home.
- **The demo:** the pretend Foreman now hands work over with an Agent step the dashboard allows as routine, so the crew are met live. If you deny that step, nothing runs and the job stays as it was. It writes `review.md` and records PR #1's link.
