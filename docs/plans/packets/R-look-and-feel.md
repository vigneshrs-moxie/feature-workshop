# Packet R · Look and feel

**Goal.** The app should feel comfortable, calm and solidly built: every button, field and card looks and responds like a tool made by an expert team, the pages use the whole Mac window, and Light is the default theme. Asked for by Vignesh on 2026-10-29, after clicking through the merged redesign: "increase the width of the panel, maybe take the full width on a mac window screen … use more real estate on both sides", "it just doesnt feel comfy and beautiful. clicks and button still seem very amateur and not expert level built, not solid … general feel isnt right", "let light theme be the default".

**Port 4493 · worktree `../ground-control-R` · branch `packet/R-look-and-feel`. Starts from `main` after P (every packet G–Q, K2 and P merged). Runs alone.**

## What is wrong today (seen at 1512 × 945, Light and Default)
Screens before the change: `/private/tmp/claude-502/-Users-moxie-Projects-feature-workshop/6544c091-ec11-4c7f-aa83-041922617dfd/scratchpad/ui/before/` (`<theme>-1512-<screen>.png`).
1. **Width.** Page content stops at about 1130 px and is centred, so a 1512 px window has about 190 px of nothing on each side, while the Job page squeezes its brief, questions and composer into one column.
2. **Buttons.**
   - The main action looks switched off: "Go: approve plan v2 and start Build" and "Read now" are pale lavender with white text.
   - Sizes are all over the place: 56 px Desk buttons, 40 px bar buttons, underlined text links ("Check now", "Try it on your computer").
   - Flat grey secondaries with no edge; no pressed state; nothing feels like it was clicked.
   - A boxed key hint on every button makes each one busy.
   - Odd spacing in Play labels ("No go : send back", "Go : approve").
3. **Fields.** The browser's own `<select>` (Foreman model) and radio buttons; inputs of different heights.
4. **Surfaces.** Grey cards on a near-white page inside grey lanes inside the page: boxes within boxes and weak hierarchy. The Needs-you bar has a heavy brown frame; brown and tan dots and fills for status.
5. **Type.** A typewriter face for labels and times ("GO / NO GO", "waiting 22m"); body text small; heading sizes jump.
6. **Empty demo Telemetry.** The demo writes no usage lines, so every dial and graph is empty.

## The bar to reach
Think Linear, Vercel, Raycast and GitHub's Primer: quiet neutrals, one accent, crisp 1 px edges, soft shadows, generous but even spacing, and controls that respond at once.

### Layout: the whole window
- Pages fill the window with even side gutters (24 px, 32 px from 1280 px wide). The top bar lines up with the same gutters. Only running text (a brief's paragraphs, help text) keeps a readable line length (about 75 characters).
- Wide windows (≥ 1280 px) get more columns, not wider ones:
  - **Jobs:** the four lanes share the width; with a lot of room, cards inside a lane can sit two across.
  - **Job:** the stop map across the top. Under it, the main column (the go / no go bar, the brief, questions) and a right column, sticky, with the conversation and composer, the crew's activity and the job's details.
  - **Desk:** the queue as a left column (about 300 px), the card in the middle, the job's context (stops, brief, recent activity) on the right from 1440 px.
  - **Stage:** the crew and their work side by side.
  - **Telemetry:** graph cards three across from 1600 px.
  - **Stacks, Inbox, Settings:** a list or rail on the left and the detail on the right where they have one.
- Phone width (390 px) stays as it is today: one column, no sideways scroll.

### One set of controls, used everywhere
- **Button** (one component; every button and button-like link uses it):
  - Sizes: 28 px (small), 34 px (default), 40 px (large, at most one per screen). No 56 px buttons.
  - Radius 8 px; weight medium; text 13–14 px.
  - Kinds:
    - **primary:** solid accent, full-contrast text (4.5:1 at least), a 1 px inner highlight and a small shadow;
    - **secondary:** surface colour, 1 px border, extra-small shadow;
    - **quiet:** no edge until hover;
    - **danger.**
  - States:
    - **hover:** a shade darker;
    - **pressed:** a touch darker, the shadow drops and it moves down half a pixel;
    - **focus:** a 2 px ring with a 2 px gap, for the keyboard only;
    - **disabled:** clearly off (lower contrast, not-allowed cursor), and never mistakable for primary;
    - **busy:** a small spinner in place, same width.
  - 120 ms transitions, none when the system asks for less motion.
- **Key hints.** The main action of a next-step bar keeps its key shown, small and low-contrast inside the button. Every other key shows on hover or focus and in the button's tooltip, and all keys show while `?` is held. Settings → Keys gets "Show keys on every button" for anyone who wants them always. Keys are never removed, only quieter.
- **Fields:**
  - inputs, text areas and selects are 34 px high, with the same border, radius and focus ring;
  - selects are drawn by the app (chevron, the same menu look as the command box), not the browser's;
  - radios and checkboxes are 16 px, in the accent colour, and their whole label is clickable;
  - option rows (the brief's a/b/Other) are full-width rows that highlight on hover and show a selected state.
- **Chips and badges:** one shape (radius 6, 22 px high, icon + word), with tinted backgrounds from the status tokens. The status still has a word and an icon, never colour alone.
- **Links** in text look like links; links that do something ("Check now", "Try it on your computer") become quiet buttons.
- **Labels:** "No go: send back", "Go: approve and start Test". Fix whatever puts a space before the colon.

### Surfaces, colour and type
- **Light (default):** a white page with cards in white, 1 px neutral border, a soft extra-small shadow, radius 12. Lanes and groups are columns with a heading, not boxes. Never more than one framed box inside another; inner groups use a divider or a subtle tint.
- **Elevation scale:** none / xs (cards) / sm (raised on hover) / md (menus, popovers) / lg (dialogs, sheets). Menus and dialogs fade and scale in from 98% in 120–160 ms.
- **The next-step bar:** a soft tint of its tone with a 3 px bar on the left, no heavy frame.
- **Colour:**
  - neutrals from one grey family;
  - one accent (the current indigo, a touch deeper so white text reads on it);
  - status colours only in chips, dots and the stop map, from tokens;
  - the brown and tan go: Needs you uses a soft amber tint with the hand icon.
- **Type:**
  - the UI font at 14 px body, line height 1.5;
  - a scale of 12, 13, 14, 16, 20, 24 and 30 px; weights 400, 500 and 600;
  - page titles 24 px semibold;
  - eyebrows ("Go / no go") in 11 px semibold small capitals with letter spacing, in the UI font;
  - monospace only for code, branch names, ids and tabular numbers;
  - times and counts use tabular figures.
- **Every theme** follows the same controls and spacing; themes change colour and texture only. The Default (dark) theme gets the same care as Light: no washed-out primaries, borders that show.

### Light is the default
- `DEFAULT_THEME` is `light`. A new browser with nothing saved opens in Light, whatever the system says.
- Follow the system stays an option, off by default; anyone who picked a theme keeps it.
- The classic page (the ⌘K `classic` easter egg) opens in its light look too.

### Demo data
The demo writes about three weeks of made-up usage lines (two people, several jobs, Opus and Sonnet, meter readings every few turns, a stretch of outside use) into its own temporary folder. That way Telemetry's dials, the "Who used this week's limit" line and the graphs show something real in the demo. Never in `~/.ground-control`.

## Owns
Everything under `web/src/` that is styling or a shared control:
- the CSS files: tokens, theme files, `app/*.css`, `home/*.css`, `job/*.css`, each view's CSS;
- the shared components: `components/`, `components/page/`, and new ones such as `Button.tsx`, `Field.tsx`, `Select.tsx`, `Choice.tsx`, `Chip.tsx`;
- the layout parts of each view's `.tsx`, plus the button, field and chip markup in every view, moved to the shared components;
- `web/src/theme/theme.ts` and its tests (the default);
- `dashboard/public/` (the classic page's default look);
- `dashboard/demo/run-demo.js` (the usage lines);
- every web test that has to follow a change of markup.

No server behaviour, no wording changes beyond the label punctuation and link-to-button changes above, no new features. Wording stays plain, status is never colour alone, keys work as before.

## Steps
1. **Foundations.**
   - Tokens: spacing, radius, elevation, type scale, the deeper accent, the neutral family and the status tints.
   - The shared controls: Button, Field, Select, Choice, Chip, Kbd's quiet mode.
   - Light as the default theme.
   - The full-width page frame.
   - A test that no view styles its own buttons outside the Button component (a stylesheet rule, like M's `cssRules.test.ts`), and that every `<select>` and `<input type=radio|checkbox>` goes through the shared ones.
2. **Jobs, Desk and Job** on the new controls and the wide layouts.
   - Then **stop**: screenshots before and after, at 1512 and 1728 px wide in Light and Default, plus 390 px, side by side (montage). Hand back for Vignesh to look at the feel before the rest is done.
3. **Everything else:**
   - the Stage, Inbox, Stacks and a stack, Telemetry, Settings (every section), the review panel and Desk card, the permission alert;
   - sheets and dialogs (New job, close, keys), the command box, the Map and Table, Crew-dex and Achievements;
   - the classic page's light default.
4. **Demo usage lines**, so Telemetry shows data in the demo.
5. **Checks:**
   - M's style tests;
   - every screen at 390, 1280, 1512, 1728 and 1920 px, in Light and Default, with Play full and off: no sideways scroll, no page errors, nothing clickable under 28 px high (40 px on a phone);
   - text contrast at least 4.5:1 for body text and buttons, checked in the Playwright run;
   - a before/after montage for every screen.

## Acceptance
- At 1512 px wide, no page leaves more than its gutters empty on either side.
- Every button is the shared Button, with hover, pressed, focus, disabled and busy states.
- No native-looking select or radio is left.
- The main action never looks disabled.
- Key hints are quieter but every key still works and is listed.
- Light opens by default.
- Cards are never boxed more than one deep.
- Telemetry in the demo shows data.
- Every theme still works.
- All tests are green, with no model calls.

## Verify
```
PORT=4493 npm start   # or the demo with a temp HOME: every screen at 1512 and 1728 wide, Light and Default; 390 on a phone
npm test && (cd web && npx vitest run) && (cd web && npx tsc --noEmit -p .)
```

## Rules that apply to every packet (read once, obey always)
- **Base:** `main` of the dashboard repo.
- **Worktree and branch:** `git worktree add ../ground-control-R -b packet/R-look-and-feel main` from the main checkout. Work only there.
- **Port:** 4493 (screens server 4494). **Never use 4477 (Vignesh's live dashboard), 4479 (his demo) or 4485 (his test server);** 4481, 4483, 4487, 4489 and 4491 are demos left running for him; leave them alone.
- **Owned files only.** If you need a change elsewhere, write it under "Needs from others" in your hand-back.
- **Tests:** `npm test` and `cd web && npx vitest run`, both green before each commit. **No model calls in tests.**
- **Never push, never open a PR, never merge.** Commit locally, one commit per step, plain messages.
- **Status is never shown by colour alone; themes change looks only; keys never fire while typing or with a dialog open.** Use the theme tokens, not literal colours.
- **Plain words** in every string a person reads. The product's name isn't decided: never write one; use `BRAND`/`PRODUCT` or "the app".
- **Hand-back format:** packet id, branch, last SHA, what was done per step, test output tail, anything not done and why, "Needs from others".
