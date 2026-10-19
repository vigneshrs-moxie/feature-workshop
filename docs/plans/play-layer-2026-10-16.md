# Feature Workshop · Play layer · design doc v0.2 (2026-10-16, approved by the user)

The user asked for fun back: the crew, a Crew-dex, game-like elements and technical easter eggs, on top of the professional redesign. This reverses design-doc decision 12 ("Pixel crew and Crew-dex dropped"). Decided on 2026-10-16: **its own phase right after phase 2** (before phase 3) · **Play mode defaults to Subtle** · **personal only** (no team leaderboard; shared state is a v2 topic). v0.1 approved the same day ("these are perfect") with two changes folded in below: no XP or ranks for now, and nothing tied to the PR process except "a quest is done when the first PR is created", which is configurable. An implementation plan still needs the user's yes before building.

## 1. Rules

1. **Zero Claude usage.** Everything runs on local data the dashboard already has (audit.jsonl, status.json, briefs, review.md, options.json, git). No model calls, ever, for play.
2. **One switch.** Settings → Play mode: **Full · Subtle · Off**. Off renders the product exactly as phase 2 left it. Remembered per machine (settings.json).
3. **Never in the way.** Nothing play-related sits between you and a gate card, a permission card or the composer. No modal pop-ups; celebrations are non-blocking and under 1.5 s.
4. **Reward outcomes, never approvals.** Achievements come from finished jobs (quests), clean reviews, fixed bugs: never from clicking Approve, so the game can't nudge anyone into rubber-stamping.
5. **Accessible and themed.** `prefers-reduced-motion` turns animation into still poses; every reward has text, not only colour or sound; sounds are opt-in. All six themes style the crew through tokens.
6. **Explained, but secrets stay secret.** Each visible feature gets its one-line hint (standing rule). Easter eggs are not explained, but the Crew-dex shows "Secrets found 3/13" so teammates know there is more.

## 2. What Subtle and Full turn on

| Feature | Subtle (default) | Full |
|---|---|---|
| Crew characters on handoff lines, live row, Crew-dex | ✓ (still, small) | ✓ animated |
| Crew-dex page | ✓ | ✓ |
| Achievements + toasts | ✓ | ✓ |
| Easter eggs | ✓ | ✓ |
| Quest track (stages as a path) on the job header | — | ✓ |
| Boss fight (L3 review findings as a health bar) | — | ✓ |
| Stamina bar for the usage window; crew asleep during a usage pause | — | ✓ |
| Celebration bursts (quest done, boss defeated) | small | full |
| Sounds (chiptune blips) | — | opt-in |

## 3. The crew and the Crew-dex

- **Characters:** reuse the vector rig in `dashboard/public/crew.js` (hats, tools, moods: working, waiting, asleep, celebrating, walking), ported to a React `<CrewMember type state size>` component with the same SVG. Names and roles from `dashboard/lib/stages.js` AGENTS: Foreman, Scribe, Sleuth, Draftsman, Builder, Tester, Head inspector, Locksmith, Gauge, Stickler, Fuse, Mason, Stopwatch, Painter, Oracle (15).
- **Where they appear:** the worker's character on handoff/dispatch lines and the live row (by agentType from audit and session logs); the Foreman's glyph becomes the Foreman character; reviewers line up on review briefs.
- **Crew-dex** (a view like Settings, ⌘K "Crew-dex"): a numbered card per crew member (#001–#015) with character, name, role, model, **rarity** (Haiku common · Sonnet uncommon · Opus rare · Fable legendary), and real stats: jobs worked, times dispatched, blockers and majors raised (lenses, from review.md), average time on a stage, last seen. A member stays a **silhouette ("not met yet")** until first dispatched on your machine. Hover plays their working animation.
- **Card back:** a short fixed bio line per member (written once, in the code), e.g. Locksmith: "Has never met a door it trusted."

## 4. Game layer

- **No XP or ranks for now** (the user, 2026-10-16: not sure about the values; maybe later).
- **No PR process in play yet** (the PR stages aren't standardized). **A quest is done when the job's first PR is created** (status.json `prs[0]` gets a URL). What happens after that (a bug fix or change) the user handles by reopening the job for now; a better flow comes later. **Configurable:** Settings → Play → "A quest counts as done when…" with *the first PR is created* (default) or *I mark the job done*, so the rule can change when the PR process is standardized without touching the achievement code. A quest is counted once: reopening and finishing again never re-awards. The play ledger (achievements, crew met, secrets found) lives in `~/.feature-workshop/play.json` and is rebuilt from the audit log if lost.
- **Quests (Full):** a job's level shows as difficulty (L0 ★ … L3 ★★★★); the stages as a quest track in the job header, the current stage's crew member standing on it.
- **Boss fight (Full, L3 review only):** the review's findings as a health bar (blockers heavy, majors medium, minors light) that drains as fix rounds land; "Boss defeated" once no blockers or majors are left (decided 2026-10-19: fix rounds only take blockers and majors, so minors left over for you don't keep the boss alive; a review that never had a blocker or a major has no boss). Purely a view of review.md.
- **Stamina (Full):** the usage-limit bar drawn as stamina; during a usage pause the crew sleeps with a countdown ("back at 3:42pm").
- **Achievements (personal, local):** ("done" = quest done, per the setting above) First Quest (first quest done) · Clean Sweep (review with zero findings) · Speedrun (L0 from start to done in 15 min) · Full Panel (all 8 lenses on one job) · Boss Slayer (an L3 quest done) · Bug Hunter (10 bug quests done) · Night Owl (a quest done 00:00–04:00) · Comeback (a job resumed after a usage pause, finished the same day) · Explorer (all five themes tried) · Collector (all 15 crew met) · plus the secret ones in section 5. Unlocks: two hidden themes (CRT Terminal via Konami code, Gold after 10 quests done).

## 5. Technical easter eggs (13)

1. **Konami code** (↑↑↓↓←→←→BA) anywhere outside a text field: unlocks the CRT Terminal theme (scanlines, phosphor green).
2. **⌘K `hammertime`:** the Builder does a short Hammer Time dance (a nod to phase 2's start keyword).
3. **⌘K `sudo make me a sandwich`:** "Okay." (xkcd 149).
4. **⌘K `rm -rf /`:** Locksmith slams a door over the palette: "Hard line. Nice try."
5. **⌘K `git blame`:** the crew line up and point at each other.
6. **`GET /api/teapot`:** a real HTTP 418 I'm a teapot, with a tiny JSON body.
7. **DevTools console:** ASCII crew art and one hidden hint.
8. **Response headers:** `X-Crew: Foreman, Scribe, Sleuth, …` and `X-Clacks-Overhead: GNU Terry Pratchett`.
9. **404 in /next:** Sleuth searches for your page with the magnifier.
10. **Hex Sommelier badge:** a commit on a job's branch whose short hash starts with `c0ffee`, `dead`, `beef` or `f00d`.
11. **Foreman glyph clicked 7 times:** a one-liner from a fixed local list.
12. **Friday after 4pm:** Locksmith raises an eyebrow on a `git push` permission card (look only; never changes the decision).
13. **Seasonal hats and nightcaps:** crew wear seasonal hats on a few dates; nightcaps between midnight and 5am.

Held: PR-number badges (#404, #500, #1337), until the PR process is standardized.

How they are found (step 7, 2026-10-19). The page reports only the ten it sees; the dashboard finds the teapot, the headers and the Hex Sommelier itself, and refuses those three from the page.
- **Palette phrases** run on Enter when typed exactly (any case); they are never listed. `rm -rf /` shows the door in place of the list, then closes the palette.
- **Teapot:** visiting `/api/teapot` counts from this browser or a terminal, never from another site's page (`Sec-Fetch-Site`).
- **Headers:** the headers carry `X-Crew-Note`, pointing at `/api/teapot?from=headers`. Following it is how "read the headers" is found.
- **Console:** the console art ends with a hint to type `crew.hello()`. Calling it counts.
- **404:** only an unknown `#/…` address. An in-page `#section` link still shows home. With Play Off, both show home as before.
- **Hex Sommelier:** read from each job's branch on the full job read, again only when the branch has moved.
- **Seasonal hats:** Halloween (Oct 31), Christmas (Dec 24–26), New Year (Dec 31–Jan 1). Nightcaps from midnight to 5am don't count as the secret.
- **Scenes** (hammer time, the sandwich, git blame, the Foreman's line, CRT unlocked) show with the toasts. Their motion is under 1.5 s, and they stay still under reduced motion.
- **Konami:** picks CRT Terminal, which goes on once the ledger confirms the unlock.
- **Off:** with Play Off, none of the eggs do anything: no headers, no teapot (404), no `crew` in the console.

## 6. Steps (one commit each, branch `redesign/play` off `redesign/phase-2`)

1. Play settings and ledger: Play mode setting, the quest-done setting, `play.json`, achievement engine from the audit log (pure, node-tested, no model).
2. Crew component: port the rig to React + tokens, reduced-motion stills, all themes.
3. Crew in the thread: characters on handoff lines, live row, review briefs, Foreman glyph.
4. Crew-dex view with stats, rarity, silhouettes, secrets counter.
5. Achievements, toasts, hidden themes.
6. Full-mode extras: quest track, boss fight, stamina and sleeping crew, celebrations, opt-in sounds.
7. Easter eggs (section 5) and the 404 page.
8. Demo pass (the fake Foreman dispatches crew, finishes an L3 review, a job's first PR is recorded so the quest completes; also the "I mark the job done" setting), screenshots in every theme, `docs/plans/play-gate.md`.

Independent review after steps 2, 4, 6 and 8. Costs no usage: npm test, Vitest, the demo.

## 7. Phase gate (what you'll review)

Screenshots: Crew-dex (met and not met), thread with crew, achievements, Subtle vs Full vs Off side by side, boss fight, one easter egg. The achievement rules.
