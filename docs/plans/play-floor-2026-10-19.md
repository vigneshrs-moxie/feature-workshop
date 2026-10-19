# Feature Workshop · Play, round 2: the workshop floor · plan v0.1 (2026-10-19)

**Asked for (2026-10-19):** "I want the play parts to be slightly bigger and the theme to maybe include a glassy, modern design theme too. I also want the crew to be bigger and shown in a different way: not changing the character drawings or animations but showing them elsewhere too. We've lost the essence of the original Feature Workshop, which looked so fun to use. I want this to be fun to use too and super intuitive while building."

Built on `redesign/play-floor`, off `redesign/play`. Not pushed or merged.

## What the classic page had that the new one lost

Compared side by side in the demo (classic `/` against `/next/`):
- **The trail.** Each job had a green meadow with a wooden path and one stop per stage. The crew member for the current stage stood on it, with a "!" over their head when the job needed you. You could tell where a job was at a glance, without reading.
- **The Foreman talking to you.** A big Foreman portrait said "10 jobs need you. Longest wait first:" over buttons for those jobs.
- **Chunky, friendly cards**, a mascot by the title, and "Your crew, your features, your turn".

The new page with no job open is an empty pane ("Pick a job on the left"), and the crew are 20–30 px figures on single lines.

## Rules kept from the Play layer

- **Off is still exactly the phase 2 page.** Everything below shows only with Play on, except the Glass theme, which is a theme like the others.
- Zero model calls; everything comes from what the page already has.
- Nothing sits over, or inside, a gate card, a permission card or the composer.
- Subtle keeps the crew still and Full moves them. Reduced motion holds every one still. Motion under 1.5 s, except the crew's own existing animations in Full.
- Status is never colour alone: every picture has words.
- The character drawings and animations are not changed.

## Steps (one commit each)

1. **Bigger Play parts.** One size scale for the crew, used everywhere (`play/crewSizes.ts`), about 1.4× today's sizes. Subtle and Full both grow, and Full stays a little bigger:
   - Thread tags and handoffs: 20 → 28 (Full 32).
   - The live row: 26 → 36 (Full 44).
   - The Foreman by the title: 28 → 40.
   - Review lineups: 24 → 32.
   - Bigger toasts, Crew-dex portraits, achievement medals, the boss bar and the stamina bar.
   - The Foreman as a mascot by "Feature Workshop" in the top bar, with "Your crew, your features, your turn".
2. **Glass theme** (`glass`): frosted, translucent panes over a soft aurora gradient, thin bright edges, large radii, a calm modern type scale. Everyone has it, so it isn't hidden. The server learns its id so trying it is recorded. Explorer still counts the five themes it names.
3. **The trail in a job** (`play/JobTrail.tsx`), replacing the quest track. It shows in Subtle and Full.
   - The stages are a path of stops: done ones ticked, the current one bold, the goal a flag.
   - The crew member for the current stage stands on it, big (56 px; 64 in Full), in a mood that follows the job: waiting with a "!" when it needs you, working while running, asleep in a usage pause, celebrating when done.
   - **A "Now / Next" line under it, in plain words:** "Now: Builder is building. Next: Tester runs the checks." or "Your move: the Foreman is waiting for your go-ahead." It says what happens next and whose turn it is.
   - Full adds the difficulty stars and a field behind the path.
4. **The crew in the Jobs list.** Each row shows its job's crew member (the worker at work, or the stage's character), 30 px, in the job's mood. Rows keep their text: glyph, label, stage and time.
5. **The workshop floor** (home with no job open, Play on):
   - **The Foreman's word:** a big Foreman (96 px) with a speech bubble saying what to do next, such as "3 jobs need you. Longest wait first:", with a button for each of up to 4 jobs (name, what it needs, how long it has waited). When nothing needs you, it names who is at work on what.
   - **Waiting for your answer:** the permission and question cards, as before, kept above the floor.
   - **On the floor:** one card per open job, each with its title, its trail and its crew member, and what it is waiting on. Clicking one opens it. Done jobs are left out; the line under the floor counts them.
6. **Demo walk, screenshots in every theme, tests, the gate update** (`docs/plans/play-gate.md` gets a "Round 2" section), then an independent review and its fixes.

## Not changing

The defaults (Subtle), the quest rule, achievements, secrets, the boss fight, sounds, the Off page, the drawings and their animations.
