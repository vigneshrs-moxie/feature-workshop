# Play layer screenshots (2026-10-19)

The Play layer in the demo: a pretend Foreman, invented jobs and no Claude usage. Headless Chrome at 1440×900, 1× scale, driven by a script that clicks through the page the way a person would (it also checked 32 things along the way, with no console errors). Images 01–16 use the Default theme, except 16, which just switched to CRT Terminal.

| # | File | What it shows |
|---|---|---|
| 01 | `01-crew-dex-subtle.png` | The Crew-dex in Subtle: cards for the crew you've met (stats, rarity) and silhouettes for those you haven't. The header counts crew met and "Secrets found 2/13", never which. |
| 02 | `02-thread-subtle.png` | Widget Export's conversation in Subtle: each handoff line has its worker standing still beside it. No quest track and no stamina bar. |
| 03 | `03-thread-full.png` | The same in Full: the quest track under the title (L2 ★★★, the stages as a path, the Head inspector standing on Review), stamina ("Fresh") in the top bar and the crew moving. |
| 04 | `04-thread-off.png` | The same with Play Off: exactly the phase 2 page. No crew, no Crew-dex link, no quest track, no stamina. |
| 05 | `05-achievements.png` | Achievements: the ten you can see, with how to earn each, and the secrets found so far. |
| 06 | `06-quest-before-review.png` | Invoice Merge (L3) with its checks passed, before the review. |
| 07 | `07-boss-fight.png` | After the review: the boss fight under the review brief. "Boss: 12 of 12 hit points left · 1 blocker, 2 majors, 1 minor" (blockers 5, majors 3, minors 1). |
| 08 | `08-boss-defeated.png` | After the fix round: "Boss defeated · 1 minor left for you", with the Boss defeated toast. |
| 09 | `09-quest-done.png` | PR #1 opened (its link is in status.json): the Quest done toast, under the default rule "the first PR is created". |
| 10 | `10-quest-marked-done.png` | With Settings → Play → "I mark the job done", marking Copy link button done is a quest. Its toast says so. |
| 11 | `11-egg-rm-rf.png` | ⌘K `rm -rf /`: the Locksmith's door in place of the palette's list ("Hard line. Nice try."). The palette closes by itself. |
| 12 | `12-egg-hammertime.png` | ⌘K `hammertime`: the Builder's scene with the toasts, and the secret found. |
| 13 | `13-egg-git-blame.png` | ⌘K `git blame`: four of the crew turning to point at each other. |
| 14 | `14-egg-foreman-knocks.png` | Seven quick clicks on the Foreman by a job's title: one of the Foreman's lines. |
| 15 | `15-egg-404.png` | `#/where-did-it-go` with Play on: the Sleuth searched and found only footprints, with "Back to the Workshop". |
| 16 | `16-egg-konami-crt.png` | The Konami code: CRT Terminal unlocked and put on. |
| 20–27 | `20-theme-default.png` … `27-theme-gold.png` | Image 03 in all eight themes: Default, Neon arcade, Blueprint, Pixel crew, Sunset paper, Candy pop, CRT Terminal and Gold. Gold opens after ten quests and the demo has fewer, so for its picture alone it was put on by hand (the page's `data-theme`). |
| 30–31 | `30-crew-dex-pixel-crew.png`, `31-crew-dex-crt.png` | The Crew-dex in Pixel crew and CRT Terminal. |

Not pictured, because they depend on the date: the Friday-afternoon eyebrow on a `git push` card and the seasonal hats. Their tests set the clock instead (`web/src/play/Eggs.test.tsx`).
