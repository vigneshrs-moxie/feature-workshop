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


## Review of steps 1–2 (2026-10-29): approved direction, with five more rules
Vignesh looked at Jobs, Desk and Job after step 2: "we are on the right track wrt design. i like the general feel of things but i still want a little less clutter on screens with a lot of info." He added five rules, which apply to every screen from here on.

1. **Simple by default, detail on request.** "as a developer, i am able to develop very well by just having one claude code terminal open and building on it there. if i have a ui that connects to such a terminal, i want it to make things so much simpler and only give me all these complex data and info if i want to see it."
   - Each screen shows three things first: what is happening, what needs you, and the one next action. Everything else sits one click away, behind a labelled disclosure ("Details", "History", "More graphs"), remembered per screen in this browser: history, activity, facts, tables, stop maps on every card, cost and model lines, extra graphs.
   - Settings → Look gets **Detail: Simple (default) / Full**, for people who want everything shown.
   - Per screen:
     - **Jobs cards:** the title, one status line, the state chip and the time. The stop dots show on hover, on focus and in Full.
     - **Job:** the go / no go bar, the brief's summary and questions, and the message box, close to a terminal. The conversation shows the newest message and "Earlier (n)". The crew's activity and the job's facts fold into "Details".
     - **Desk:** the decision, with the Foreman's brief folded.
     - **Stage:** the crew member at work and what it is doing now, with its log on request.
     - **Telemetry:** the dials, "Who used this week's limit" and the three graphs with the most to say, then "More graphs (7)".
     - **Settings:** each section shows its main choices first, then "More".
2. **Nothing jumps when something folds, hides or opens.** "i also dont like it when you see some chart/element and when you hide it, it moves around everthing in the screen which makes me search for elements and understand things on that screen from scratch all over again."
   - Hiding leaves a slim placeholder of fixed height in the same place ("Rework, hidden · Show"); it never reflows a grid or moves cards into other columns.
   - Folding shrinks only that item, inside its own column.
   - Details open as a drawer or popover over the page, or below the item within its own column, never by pushing the page sideways.
   - Banners, loading and empty states keep the space of what they stand for (loading skeletons are the same size as the content).
   - Lists never reorder under the pointer.
   - A Playwright check: on Telemetry, Jobs, Job, Desk and Settings, fold, hide, open and close each thing, and the positions of everything above it and in other columns must not change.
3. **No browser or Mac look anywhere.** "lets not use mac or the browsers default dropdown anywhere since it looks ugly."
   - No native select, datalist, radio, checkbox, number or date input, or `<details>` marker.
   - No native `title` tooltip on a control: one app Tooltip, after a short delay on hover and at once on keyboard focus, with the same text kept as the accessible name or description.
   - No textarea resize grip; scrollbars are thin and themed; autofill takes the theme's colours.
   - A test fails if any of these comes back.
4. **Every small part looks meticulously made.** "we want every single, minute piece of this product to have a touch of class and beauty yet maintain simplicity … every single ui element should work and look like that much work went into it."
   - A component gallery at `#/gallery`, reachable only by typing the address and never linked or named in the product. It shows every control and piece in every state, at both densities, in Light and Default: buttons, fields, select, choice rows, chips, tooltip, menus, sheet, dialog, toast, next-step bar, cards, empty, loading, error, very long text, a 99+ count.
   - Each piece is checked at 2× zoom for alignment (icons on a 4 px grid, text baselines, optical centring), and its hover, press, focus, disabled, busy, empty and error states are each looked at.
   - Motion is short and purposeful: 120–160 ms, ease-out, none with less motion.
   - Empty and error states are designed, not left as a grey line.
5. **The old leftovers go.** "the old 'fresh' bar and 'live' and other old elements are back for some reason. lets redesign those too."
   - The top bar shows connection only when it isn't fine (a quiet "Reconnecting…", nothing while live). The "Demo" chip becomes a small label beside the name.
   - Any old usage strip, freshness or "updated … ago" bars, Refresh buttons and v1 pieces still drawn on the new pages are removed or redesigned into the new pieces; GitHub's check line stays, tucked in, as Q designed it.
   - Go through every screen and list each element that predates M; keep it only if it earns its place, in the new style.

## Design philosophy (2026-10-29)
At Vignesh's request ("look at some websites that have really nice design for such content heavy pages … update our own design philosophy"), `docs/design/design-philosophy.md` gathers what Linear, Vercel, Stripe, GitHub (Primer and its agent session logs), Sentry, Raycast, Superhuman, Apple, Nielsen Norman Group, web.dev, IBM Carbon, Grafana and Refactoring UI do with dense screens. It turns that into 14 principles and a list of changes per screen. **It is part of this brief:** where it and this file disagree, the philosophy file wins, except on the hard rules.
- **No Desk undo.** It needs a server change, so leave it out.
- **Native controls.** Vercel's guidelines recommend the browser's own controls; we deliberately don't follow them. Our own controls must match the browser's keyboard behaviour exactly.

**Stacks moved to V (2026-10-29).** Vignesh found the Stacks home "drab and boring" and asked for it to be redone for big features, with a page for each part. Packet V (`V-stacks-home.md`) does that, starting from R's branch. R leaves `web/src/views/Stack/` to V, apart from moving it onto the shared controls where they already work.

## More colour, more contrast in dark (Vignesh, 2026-10-29)
"consider adding a little more color to all the screens in light and dark mode and also adding more contrast in the dark mode. consider adding colors that make it pop a little but still have that calm and clean vibe that we talked about. it doesnt have to be purely light pastel colors, it should pop a little but still look cleanly beautiful."

This refines principle 8 of the design philosophy ("colour by rule"): it stays a rule-built system, with more colour in it.
- **Big areas stay calm; small marks carry the colour.**
  - Page backgrounds and card surfaces stay neutral.
  - Colour goes into the things the eye should find: the active stop, status dots and chip icons, progress segments, the next-step bar's left bar and icon, the main button, links, key numbers, selected rows, focus rings and chart series.
  - As a guide, saturated colour covers no more than about a tenth of a screen.
- **Colours that pop, not pastels:**
  - Each status hue gets a vivid **mark** colour (dots, icons, bars, the text of chips) and a soft **tint** (chip and row backgrounds). Light mark colours sit around OKLCH lightness 0.55–0.65 and chroma 0.16–0.22; tints around lightness 0.95–0.97 and chroma 0.03–0.06.
  - The status hues: working blue, needs-you amber, done green, stopped red, review violet and waiting slate.
  - The accent is a clear, saturated indigo-violet.
- **A hue per stop:** Spec, Investigate, Plan, Build, Test, Review and Ship each get their own hue from one even-lightness ring. It is used on the stop map, on stop icons and as a thin edge on stage-related cards, so where a job is reads at a glance.
  - The hue is never the only clue: the stop's icon and word stay.
  - Crew roles take the hue of the stop they work in.
- **Charts:**
  - Categorical charts (models, people, stages) use the stop and status hues, not greys.
  - Single-series charts use the accent, with grey for comparison lines, as the research said.
- **Dark (Default) gets real contrast:**
  - A deeper background, around lightness 0.14–0.16.
  - Surfaces step up clearly, about +0.03 per level.
  - Body text around 0.95, muted text around 0.74.
  - Borders that show, around 0.32–0.36.
  - Mark colours lifted to about lightness 0.72–0.80 with the same chroma, so they glow a little against the dark without going neon.
- **Checks:**
  - text at least 4.5:1 and UI marks at least 3:1 against what is behind them, in both themes;
  - add the new tokens to the gallery as swatches, with their contrast numbers;
  - all 11 themes still work: the bold themes keep their own palettes and take the new token names.

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
3. **The five rules on Jobs, Desk and Job first** (simple by default, nothing jumps, no browser look, the gallery, the leftovers), then **everything else**:
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
