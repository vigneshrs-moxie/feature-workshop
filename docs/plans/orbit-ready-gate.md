# Ready for Orbit · Gate review (2026-10-21)

**In one line:** the classic view now looks and reads like the new one and has a **New view** button back, and auto mode was checked against your real permission history. Built on `redesign/orbit-ready` (off `redesign/play-floor`); not pushed or merged.

**Asked for:** a button from the classic view back to the new view; no big jump between the two; the classic view's UI issues fixed; auto mode that runs smoothly and only stops you for something actually very risky. Merge, `install.sh` and the rest wait for your yes.

## The classic view

- **Same look.** The classic page wears the theme you pick in the new view (Settings → Theme), all seven, plus CRT Terminal and Gold once unlocked. It uses the same tokens, fonts, status colours and top bar.
  - The build writes `web/dist/theme.css` from the same theme files (`web/src/theme/classicSheet.ts`). It holds the tokens, each theme's page background and its fonts.
  - `theme-boot.js` puts the theme on before the page draws. Changing the theme in the new view shows in an open classic tab at once.
  - The meadow maps and the crew stay. They are drawn from the theme like the new view's trail.
  - The day/night toggle and the LCD clock are gone: the theme comes from the new view now.
- **Back and forth.**
  - **New view** (top right, or the key **n**) opens the same page in the new view: the job you are on, the Crew-dex, or home.
  - The new view's **Classic view** now opens the job you have open, not the classic home.
  - **Settings** in the classic top bar opens the new view's Settings.
- **Same words.**
  - Job pills say what the new view's list says: Go-ahead, Question, Your turn, Permission, Working, Idle, Paused, Done, Dropped. "Resting" is gone.
  - Needs you is amber and running is blue, as in the new view. Needs you was red before.
  - Help text no longer names colours ("green light", "Gold: done").
  - The permission line names the three settings as Settings does, and can switch to Auto mode.
- **Same choices.**
  - The classic **New job** asks for the level (L0 Tweak … L3 Large, or let the Foreman suggest one), as the new view does. It no longer offers the old Quick / Small / Large flows.
  - The job page's **Change** opens that job's Notes and options in the new view (`?open=options`). So a level job is never edited with the old flow form.
- **Classic UI issues fixed.**
  - The theme setting collided with the new view's. Both pages stored `workshop.theme`; the classic wrote `light`/`dark` into it and silently reset the new view to Default.
  - The History search box had no styles and was squashed to a few characters.
  - A pixel heading font read "first" as "Arst" (the fi ligature).
  - Status colours and words differed from the new view.
  - The New job dialog offered flows the new view no longer uses.
- **Independent UI review:** see the end of this file.

## Auto mode

**What your real history shows.** Before this round you used "Routine steps automatic" on the classic page. You answered **553 permission cards and allowed 551**. Replayed through the hard lines:
- **45** were hard lines.
- **13** pushes to your fork and **19** `gh pr create`: all after you had approved the PR stage.
- **6** were org pushes, refused without a card.
- **6** were `npm run db:renumber -- --check`, a read-only file check that the database rule mistook for a migration.
- **1** was a real `npm run db:migrate`.

**Found while checking:**
- Your own `~/.claude/settings.json` asks before `git push`, `rm -rf`, `npm run db:*` and `gh pr create/merge`. The Foreman's sessions load it, so those asked in every mode, whatever the dashboard decided.
- Its auto mode trust list (`autoMode.environment`) names only the feature-workshop repo. In an Orbit job, auto mode's safety model would see a push to your fork or a PR on the Moxie repo as work leaving the trusted repo, and block or ask.
- Auto mode is available on your account (Claude Max) for every Foreman and crew model the workshop uses. This was checked without a model call.

**Done in this round (in force now):**
- `db:renumber`, `db:status`, `db:check` and other file-only `db:*` scripts are no longer database changes. `db:migrate`, `db:restore`, `prisma migrate deploy` and the like still ask, in every mode.
- `gh pr create` and `gh pr merge` are told apart even in commands the reader can't split.
- The rules for what your go-ahead covers in auto mode (`goAheadCovers` in `dashboard/lib/hard-lines.js`), with tests:
  - a push to your fork or opening the PR once the job is at PR #1 or later;
  - an `rm -rf` whose every target is written out and sits inside the job's own worktree, its record folder or a temp folder.
- The job's auto mode trust lines (`dashboard/lib/auto-env.js`), with tests: the job's repo and worktrees, your fork (`origin`) and the Moxie org repo (PRs only; the dashboard still refuses direct pushes and force pushes), and the job's record folder.

**Waiting for your yes:** two small hookups that switch those rules on. Claude Code's own auto mode safety check refused to let me make them without your explicit OK, because they let some hard lines through without a card:
1. `dashboard/lib/driver.js`: in auto mode, when a hard line is covered by your go-ahead, allow it and log it under "Handled for you" instead of showing a card.
2. `dashboard/server.js`: pass the coverage check and the job's trust lines to each Foreman session.

**With them, auto mode still stops you for:**
- merging a PR;
- database migrations and restores;
- `rm -rf` outside the job's folders, of a whole worktree, or of anything it can't read in full;
- a push or PR before you've approved the PR stage;
- anything auto mode's safety model can't decide.

Org pushes and force pushes stay refused. On your history that is **1 card** where there were 39.

## Tests (real run)

- `npm test` **299/299** and `npm run web:test` **575/575**.
- `tsc` clean.
- The build writes `theme.css` (50 kB).

## What's next (each needs your yes)

1. The two auto mode hookups above.
2. Merge `redesign/orbit-ready` into `main`. It carries phase 1, phase 2, themes, Play, the floor and this round.
3. Push the skill repo's two level commits (optional), and run `install.sh`, which backs up your current skills first.
4. Set the permission setting to **Auto mode** (Settings → Permissions).
5. One small real Orbit job, L0 or L1, as a shakedown.

## Independent UI review of the classic view

A separate reviewer checked the classic view in headless Chrome:
- 7 themes, at 390, 760, 1000 and 1440 px wide;
- APCA contrast;
- the console;
- every link between the two views.

It found no console errors, no horizontal scroll, and every link and the **n** key going to the right page. Its findings, all fixed:
- **Glass:** the New job and Alerts dialogs were see-through, content showed through the top bar when scrolled, and card text was low-contrast over the aurora. These now use Glass's own float and pane colours.
- **Status word:** "Blocked" wasn't a new-view word; it reads **Idle**, as there.
- **Colour in the help text:** "Red card with '!'" named the wrong colour.
- **Faint text:** upcoming stage names on the map (Default) and the "★ decided for you" line were below the contrast floor.
- **Try it on your computer:** the steps skipped a number (1, 3) when there is no database step.
- **"Run in":** the label broke onto two lines.
- **Candy pop:** the pane pattern repeated inside every card; it now sits on the page only.
- **Costs:** read "≈<$0.01".
- **At 1000 px:** the six numbers wrapped 5 + 1.

Left as they are:
- the demo's Code tab shows a raw git error for a pretend branch (demo data only);
- Pixel crew's heading font draws 5 and 9 much like S (the theme's font, in both views);
- at phone width the classic top bar takes three rows (the new view isn't built for phones either).

**After the fixes:**
- `npm test` 299/299 and `npm run web:test` 575/575;
- the new view's demo walk-through passes 34/34 with no console errors.
