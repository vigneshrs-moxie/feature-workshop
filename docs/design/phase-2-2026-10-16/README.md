# Phase 2 screenshots (2026-10-16)

Levels, gate cards and the job drawer, taken from the demo: a pretend Foreman, invented jobs and no Claude usage. Headless Chrome at 1440×900, 1× scale. Images 01–09 and 15 use the Default theme. Images 10–14 show the same gate card in the other five themes.

| # | File | What it shows |
|---|---|---|
| 01 | `01-new-job-sheet-levels.png` | New job sheet. The four levels each have a "what runs" line, and the rules pre-select L0 for "Fix the typo in the dispatch board header". |
| 02 | `02-level-card.png` | LevelCard on a job with no level yet. The rules say L2 and the Foreman says L3. Use L3, Use L2 or Not now. |
| 03 | `03-gate-l2-chips.png` | Gate card at an L2 plan. It has two questions with the recommended answers picked, and one "Also decided" item overridden. Ask Fable and L↑ are pressed, and the exact lines they add are shown. The L2→L3 line leaves out the product interview, which is already behind the job. |
| 04 | `04-gate-stale.png` | Stale card. It was raised at plan v2 and the plan is now v3, so the card is greyed out and Approve is off. |
| 05 | `05-gate-parked.png` | Gate left 5 hours. Both the card and the job row show "parked 4h", and the row stays under Needs you. |
| 06 | `06-l0-diff-brief.png` | L0 job after its one build. The brief shows the checks and the diff, with no plan card and no questions. |
| 07 | `07-drawer-notes.png` | Job drawer, Notes tab (notes.md). |
| 08 | `08-drawer-options.png` | Job drawer, Options tab on the same job, with L3 picked: the "If you save" line names only what is still ahead. |
| 09 | `09-settings-stale-skill.png` | Settings warns that the installed /feature skill predates levels. The demo uses its own old copy for this. |
| 10–14 | `10-gate-l2-chips-neon-arcade.png` … `14-gate-l2-chips-candy-pop.png` | Image 03's card in Neon arcade, Blueprint, Pixel crew, Sunset paper and Candy pop. |
| 15 | `15-drawer-options-end.png` | The end of the Options tab: the Foreman's model shown read only with its note, and room under the last row so the Save row covers nothing. |

## Docs tab (phase 2.1)

Every document of a job as a clean page, in the Preview pane. Images 17–28 are the Preview pane alone (576 px wide), cut just under the document.

| # | File | What it shows |
|---|---|---|
| 16 | `16-docs-list.png` | Customer merge's documents, grouped: Plan & spec (with versions), Briefs (newest first), Review, Notes and Other (the two JSON files). |
| 17–22 | `17-docs-plan-default.png` … `22-docs-plan-candy-pop.png` | Customer merge's implementation plan v2 as a page: headings, the steps table, SQL and TypeScript code blocks, a task list, a quote and a rule. Default, Neon arcade, Blueprint, Pixel crew, Sunset paper, Candy pop. |
| 23–28 | `23-docs-review-default.png` … `28-docs-review-candy-pop.png` | Widget Export's review: the findings table, a code block, linked IDs (R-2, FR-002) and the open next steps. Same six themes. |
| 29 | `29-docs-plan-source.png` | The same plan with Source picked: the Markdown exactly as written. |
| 30 | `30-drawer-notes-preview.png` | Job drawer, Notes with Preview picked: unsaved notes (a heading, bold, a table) rendered by the dashboard. |
| 31 | `31-palette-open-docs.png` | ⌘K "Open docs" from the Classic view tab. Picking it brings back Docs with focus on the first document. |

To take them again, run the demo (`npm run web:build && PORT=4479 npm run demo`), then open http://127.0.0.1:4479/next/. Every case above is seeded except 01, where you type the description yourself.
