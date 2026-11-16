# Job page: the glance layout (design, 16 Nov 2026)

A change to the new job page's laptop layout (1100 px and wider). The phone and the 760–1100 px
layout stay as they are. All the page's parts, data and speed work stay; only where they sit changes.

## Why

The owner's loop with Starbase is short: look at a job, see what it did, approve what needs him,
read what changed, and get back to his own work. On the first real look (16 Nov) the new page put
everything (the gate, seven steps with sub-rows, four links, the asks and the box) in a 440 px
column and left about 800 px of the screen blank, because the reader stops its lines at ~80
characters. He liked the old page's row of phases across the top, with the picked phase's work
shown under it. Prototypes looked right; the page in use did not.

## What the research says (and what it means here)

| Finding | Source | Design rule |
|---|---|---|
| A glance lasts 2–7 s; short labels read in ~2 s | Blascheck et al. 2018/2023 (smartwatch glances); UW activity-tracker study (glances ≈ 5 s) | The top band answers "does it need me, and where is it" in one look: the job's state word and a row of seven phases with one result word each. |
| Working memory holds about 4 chunks | Cowan 2001; visual-array studies (3–4 items) | Never more than ~4 things competing in one place: header, phases, your move, what it did. Conversation sits apart. |
| People read ~20–28% of the words on a page, scanning the top and left edge (F-pattern) | Nielsen 2006, 2008 | What needs him goes top-left; every line starts with its meaning (the step, the answer), detail after. |
| Average time on one screen before switching ≈ 47 s; getting back to a task takes ~25 min | Gloria Mark (UC Irvine), 2016–2020 studies | One visit should be enough: approve without scrolling, see what changed without clicking, and nothing on the page should pull him back for no reason. |
| Silent reading ≈ 238 words a minute (non-fiction) | Brysbaert 2019 meta-analysis | A 47 s visit is ~190 words. What shows without a click stays near that: the gate, the brief's "What happened", the step's outputs. |
| Line length: reading slows past ~75–80 characters | Typography practice; the page's own 80ch rule | Keep the reader's line length; use the width for columns side by side, not longer lines. |
| Code review finds most when ≤ 200–400 lines per sitting, < 500 lines an hour | SmartBear / Cisco study | "What changed" leads with the summary (commits, files, + −) and the biggest files first; the diff is a click away, not the default. |

## Approaches considered

1. **Phases across the top, work below, conversation on the right (chosen).** The old page's
   arrangement with the new page's parts. Mostly layout and styling; every part keeps its logic.
2. **Keep the left column, widen it, put the conversation as a third column.** Less change, but the
   left column still stacks five kinds of thing and the phases stay a list.
3. **A new "since you last looked" summary card.** Best for the glance in theory, but needs new
   server data (what changed since a time) and new wording rules: not low effort. Left for later.

## The layout (1100 px and wider)

```
Widget Export · Needs you                                L2 · acme-portal · $1.97 · Auto Off · ⋯
✓ Spec  ✓ Investigate  ✓ Plan  ✓ Build  ✓ Test  ● Review  ○ Ship        Ticket · Decisions · Details
  v0.3                         3 commits         5 open    not yet
┌ Your move (only when it waits for him), options side by side ─────────┐┌ Conversation ────────┐
│ 1. Fix R-2 and R-3 now?   (a) Yes, fix both now ✓   (b) Leave them      ││ one line per item     │
│ Go · all recommended   Send back                                        ││                       │
├ Reader: the picked phase's main output ─────────┬ This step ────────────┤│                       │
│ Brief #6 · Review · waiting                     │ Review · since 6:47   ││                       │
│ What happened …                                 │ Findings      5 open  ││ asks row              │
│ (80-character lines)                            │ Review (combined)     ││ message box           │
└─────────────────────────────────────────────────┴───────────────────────┘└───────────────────────┘
```

- **Phase row.** The seven steps across the full width as equal cells: a mark, the name, and its
  result word under it. Click (or `[` `]`) picks a phase; the reader shows its main output and the
  step panel lists everything it made. The current phase and the picked one are marked. Durations
  move to the step panel. Ticket, Decisions and Details sit as small links at the row's right end.
- **Your move** spans the main column under the phases, only when the job waits for him. Each
  question's options sit side by side, so a two-question gate is about half as tall.
- **Reader** as now (one thing at a time, 80-character lines).
- **Step panel** (new, small): beside the reader, the picked phase's name, how long it took (or
  since when), its result, and every output it made as a row that opens in the reader. The Ship
  phase shows its PR lines. This is the "what was done" of the old page.
- **Conversation column** on the right, always there, with the asks row and the message box at its
  foot (as the old page had). The Conversation row and `g c` focus it instead of opening it in the
  reader.

## Not changing

The phone; 760–1100 px; the payload, store, routes and speed rules; Your move's behaviour; the
reader's views; the keys (except `g c` focusing the column on a laptop).

## Checks

The page's tests updated for the new places; `web:build`; the speed check (`jobSpeed.mjs`) and the
browser checks (noJump, themeSweep, contrast) run again; screenshots of the demo's jobs at 1906 and
1280 px for the owner.

## Calls I made (his to correct)

- Approach 1 over 2 and 3, for the reasons above.
- The 760–1100 px and phone layouts stay as built.
- The step panel is new but reuses the existing output rows and PR lines.
- The conversation column is 30% of the width, between 360 and 520 px.

Sources: [Blascheck et al. 2018, Microsoft Research](https://www.microsoft.com/en-us/research/uploads/prod/2018/08/GlanceableVis-InfoVis2018.pdf) ·
[Blascheck et al. 2023](https://tingying-he.github.io/assets/publications/papers/Blascheck_2023_Studies.pdf) ·
[Cowan 2001](https://memory.psych.missouri.edu/assets/doc/articles/2001/cowan-bbs-2001.pdf) ·
[Brysbaert 2019](https://www.Gwern.net/doc/psychology/linguistics/2019-brysbaert.pdf) ·
[Gloria Mark, UC Newsroom](https://www.universityofcalifornia.edu/news/how-sharpen-your-attention-and-meet-your-goals-2024) ·
[SmartBear code review best practices](https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/) ·
[Nielsen reading figures (secondary)](https://www.seminolestate.edu/guidelines/web-writing/reading-scanning)
