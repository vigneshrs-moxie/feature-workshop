# Light screenshots (2026-10-21)

The demo (a pretend Foreman, invented jobs and invented branch and PR data), run fresh and on its own (its own port, temp folder and state folder), so nothing touched a real dashboard. Headless Chrome at 1440×900, 1× scale, unless a file says otherwise. A script walked through every control of the Light plan (`docs/plans/light-2026-10-21.md` §1–§12) the way a person would and checked 48 things on the way, with no console errors or warnings on any page. The Default theme is used except where a file names another.

Two things were set up for the pictures: "With recently closed" is on for the map shots, and one demo job (Invoice footer typo) was marked done through the API first, so the Done group has a row. The gate card shots use Customer merge (two questions, one decision made for you); CRT Terminal and Gold are rewards the fresh demo hasn't earned, so for their pictures alone they were put on by hand (the page's `data-theme`).

| File | What it shows |
|---|---|
| `01-map.png` | Home → Map. The Foreman's "11 jobs need you" band and the card waiting for an answer, then the filter chips with counts (All · Needs you · Shipping · one per repo), "With recently closed", the Show layers, and the acme-portal header with its release line ("staging: 14 commits waiting · release #160 open · last release…"). One row per job: crew member, title, the ship track with the finish-line flag, one line of words (where it is, the PR, main ↑↓), and the hint on the right. The first row is highlighted by `j`. |
| `02-map-shipping.png` | The same map scrolled to its end: the end of Needs you, Running ("Nothing to do: the Foreman is working"), the folded "▸ Done 1", then field-app with Idle (PR #1 checks failing) and Shipping (Dark Mode Toggle waiting for Raj's review on PR #2; Report Scheduler in staging, waiting for release #184). The keys line at the foot comes from the registry. |
| `03-table.png` | The Table: the chips now include Shipping and Done; the Where column says it in words, PR #1 and PR #2 as links. |
| `04-desk.png` | The Desk's three columns: the queue (every item with what it asks and how long it has waited), the item with its brief open above the gate card (Hide the brief `b`), and on the right Decided today and This job. Keys are printed on the buttons. |
| `05-desk-nudge.png` | A hand-off nudge on the Desk: "Self-review and merge PR #1 on GitHub", with Open on GitHub `o` and Not now `d`. The dashboard never merges. |
| `06-job-header-still.png` | A job (Customer merge) with the thread scrolled 600 px: the title row, the trail and the "Your move / Then / facts" lines stay put while the brief scrolls under them. |
| `07-gate-card.png` | The gate card: the two questions with their recommendations picked, "1 decision made for you · review `v`" folded, one primary Approve, the three link-buttons with their keys (`e` `r` `o`), the ⋯ menu, and "Adjust the next step (Build) ▾ `.`" closed. |
| `08-gate-adjust-open.png` | After `.`: the disclosure open with the chips (Skip next, Lighter, Heavier, Ask Fable, I'll do this part, L↑, L↓). |
| `09-clarify.png` | Office hours at its Clarify gate: each option with its consequence line under it ("A new Settings section and a permission check", "The portal shows the usual hours only"). |
| `10-screens-tab.png` | Tag filter screens at its Screens gate: the card's screen chips (Tickets with the tag filter · Where the tag picker opens · No tickets match), and the Preview pane's Screens tab framing the job's wireframes page from the screens server (port + 1), with the bar: the section in view, v1, Copy feedback, Open full screen, Step in `Enter`. |
| `11-screens-full.png` | The same page full width (`#/job/<slug>/screens`), with Back to the job. |
| `12-keys-sheet.png` | The `?` sheet, generated from the key registry: every scope with "Where it works", the groups not on this page marked so. |
| `13-settings-workflow.png` | Settings → Workflow: the rail with a value line per section, the finish line as five radios (PR #1 merged, the default, chosen), and the Screens and Clarify defaults for new jobs. |
| `14-settings-look.png` | Settings → Look: the swatch grid in its Dark and Light groups (Default chosen); text size and Follow the system are further down. |
| `15-settings-search.png` | `/` then "quiet": the one hit, Quiet hours under Notifications. |
| `16-text-xl-map.png` | The map at text size XL: everything scales with `--ui-scale`, the top bar stays on one row, no sideways scroll. |
| `20-map-<theme>.png` | The map in all eleven themes: Default, Neon arcade, Blueprint, Pixel crew, Sunset paper, Candy pop, Glass, **Light** and **Light glass** (new), CRT Terminal and Gold. |
| `30-map-1000.png` | The map at 1000×800: the Foreman band and the waiting card stack, the chips wrap, nothing scrolls sideways. |
| `31-settings-1000.png` | Settings at 1000×800 with all three panes: the rail folds above the section as one wrapped line, so the section keeps the width. |
| `32-desk-1000.png` | The Desk at 1000×800: the queue and the item side by side; the third column folds under the item. |
| `33-classic-light.png` | The classic view (`/`) wearing the Light theme (the text size, set in the new view, carries over the same way). |

## The walk-through

48 of 48 checks passed; 0 console errors or warnings across every page visited (Map, Table, Desk, four job pages, the full-width screens page, the `?` sheet, each Settings section, the map with keys off, the map at XL, every theme, the three 1000 px pages and the classic view).

1. Map: the five groups, the repo header with the release line, a ship track and flag on every row, the chips with counts, the Done fold, the pane (not the window) scrolling, a fresh scroll position after `g d`, `j`/`k`/`Enter`, `g h`, `g t` (Shipping chip present), `g d`.
2. Desk: three columns, the brief open and `b` toggling it, the nudge card under its heading, `a` on a plain go-ahead sending it (the queue shrinks by one, Decided today fills), no empty-state sentence while items remain.
3. Job: the header still after 600 px of scrolling, one primary Approve and the link-buttons, Adjust closed and `.` opening it, `v` opening the decisions, `a` doing nothing while a question is unanswered (with "Approve is off: Question 1 has no answer…") and `1` answering it, `n` with the Options tab's Screens and Clarify skip boxes, `[`/`]`, the Screens tab (iframe from the screens server, the bar's section, a chip jumping the frame, Copy feedback appending to the draft), the clarify card's consequences.
4. The `?` sheet opening at its top with every scope's "where it works"; Keys Off (`j` does nothing, ⌘K still opens the palette) and back On.
5. Settings: the rail's value lines, `#/settings/workflow`, a finish-line radio saving (one POST to `/api/settings`, the rail line and the server's setting both updated, then put back), `/` focusing the search, "quiet" jumping to Notifications, `j`/`k` moving sections, the swatch grid's Dark and Light groups, XL applying (`html[data-text=xl]`, the top bar 40 → 50 px) and back to M, Follow the system toggling, the 1000 px layout.
6. The classic view wearing the theme and text size (`--ui-scale` 1.25).

## Bugs found and fixed on the way

- `dashboard/demo/wireframes.html`: a jump to a section (the strip, or the gate card's chips) was overridden a moment later by the in-view observer, which marked the *next* section for a short target; the jumped-to section is now pinned for 600 ms.
- `web/src/home/home.css`: the Home pane is now `position: relative`, so the rows' absolutely placed bits (the flag, the screen-reader words) anchor to the pane; before, they stretched the window's own scroll range by ~620 px, so the page scrolled twice (the pane and the window).
- `web/src/home/HomeView.tsx`: Map, Table and Desk share one scroller, which kept its position across a switch (scroll the Map, press `g d`, and the Desk opened scrolled down with its top cut off); it now starts each view at the top.
- `web/src/components/Sheet.tsx`: a sheet focused its first control with a scroll, so the long `?` list opened scrolled to its Close button at the bottom; the focus no longer scrolls.
- `web/src/app/app.css`: with all three panes at 1000 px the Settings section was 80 px wide beside the rail and its content cut off under the Preview pane; under 480 px of pane width the rail now folds above the section.
