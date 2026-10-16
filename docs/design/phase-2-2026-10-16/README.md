# Phase 2 screenshots (2026-10-16)

Levels, gate cards and the job drawer, taken from the demo: a pretend Foreman, invented jobs and no Claude usage. Headless Chrome at 1440×900, 1× scale. Images 01–09 use the Default theme. Images 10–14 show the same gate card in the other five themes.

| # | File | What it shows |
|---|---|---|
| 01 | `01-new-job-sheet-levels.png` | New job sheet. The four levels each have a "what runs" line, and the rules pre-select L0 for "Fix the typo in the dispatch board header". |
| 02 | `02-level-card.png` | LevelCard on a job with no level yet. The rules say L2 and the Foreman says L3. Use L3, Use L2 or Not now. |
| 03 | `03-gate-l2-chips.png` | Gate card at an L2 plan. It has two questions with the recommended answers picked, and one "Also decided" item overridden. Ask Fable and L↑ are pressed, and the exact lines they add are shown. |
| 04 | `04-gate-stale.png` | Stale card. It was raised at plan v2 and the plan is now v3, so the card is greyed out and Approve is off. |
| 05 | `05-gate-parked.png` | Gate left 5 hours. Both the card and the job row show "parked 4h", and the row stays under Needs you. |
| 06 | `06-l0-diff-brief.png` | L0 job after its one build. The brief shows the checks and the diff, with no plan card and no questions. |
| 07 | `07-drawer-notes.png` | Job drawer, Notes tab (notes.md). |
| 08 | `08-drawer-options.png` | Job drawer, Options tab: level, stages to skip, reviewers and so on. |
| 09 | `09-settings-stale-skill.png` | Settings warns that the installed /feature skill predates levels. The demo uses its own old copy for this. |
| 10–14 | `10-gate-l2-chips-neon-arcade.png` … `14-gate-l2-chips-candy-pop.png` | Image 03's card in Neon arcade, Blueprint, Pixel crew, Sunset paper and Candy pop. |

To take them again, run the demo (`npm run web:build && PORT=4479 npm run demo`), then open http://127.0.0.1:4479/next/. Every case above is seeded except 01, where you type the description yourself.
