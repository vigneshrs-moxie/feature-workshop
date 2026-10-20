# Theming the Workshop

A theme is one CSS file, `web/src/theme/themes/<id>.css`, with every rule scoped under
`html[data-theme="<id>"]`. It is registered in `theme.ts` (`THEMES`: id, label, one-line
description) and loaded by `themes/index.css`. Which theme is on is decided at startup by
`theme.ts`: `?theme=<id>` in the address (before or after the hash: `/next/?theme=x` or
`#/?theme=x`), else localStorage `workshop.theme`, else `default`. The picker in Settings
saves to localStorage and applies live.

**Hidden themes.** Two themes are rewards from the Play layer: **CRT Terminal** (`crt`, unlocked
by the Konami code) and **Gold** (`gold`, unlocked after 10 quests done). They carry `unlock` in
`THEMES` and are listed in the picker (with an "Unlocked" tag) only once the dashboard's play
ledger says so (GET /api/play `unlocks`, handed to `setThemeUnlocks` by `play/PlayLedger.tsx`).
Until then, and always with Play mode Off, a hidden id in the address or localStorage is skipped
like an unknown one; the dashboard also refuses to record one as tried (409). They are full
themes like the others and keep every rule below.

**The rule: a theme changes looks only.** Colour, type, radii, borders, backgrounds, patterns,
shadows, decoration with pseudo-elements, and motion within the limits below. It never moves,
hides, adds or re-orders anything, never changes text, and never changes what a control does.
Layout and components are identical in every theme.

Limits every theme keeps:
- Status always has a text label next to its colour; colour only backs the words up.
- Text contrast at or above APCA Lc 60 on its background; focus rings stay visible.
- Motion is transform/opacity only, 300 ms or less, and stops under `prefers-reduced-motion`.
- The job's own hue dot (`.hue-dot`, from `hue.ts`) stays.
- Fonts are system fonts or bundled under `web/public`; no CDN. The CSP forbids inline styles
  and scripts, so everything lives in the CSS file.
- The **needs-you** colour is the loudest on screen and nothing else may use it.

## Semantic tokens

Generated into `tokens.css` from `tokens.ts` (`semanticTokens()`). Their defaults point at base
tokens so the default theme looks exactly as before; a theme overrides them under its scope.
Base tokens (`--bg-*`, `--text-*`, `--border-*`, `--accent*`, `--status-*`, `--font-*`,
`--radius-*`, `--space-*`, `--shadow-*`) may be overridden too, for a whole new palette.

### Job groups (`--group-<group>-fg` / `-bg` / `-line`)

| Group | Meaning | Shared hue family |
| --- | --- | --- |
| `needs-you` | waiting for you: a permission click, a question, a go-ahead | hot pink / magenta |
| `running` | the Foreman or its crew are working now | cyan / teal |
| `paused` | stopped by the Claude usage limit | amber |
| `idle` | nothing happening, nothing asked | lavender / blue-grey |
| `done` | finished, marked done or dropped | green |

- `-fg`: the text colour of the status glyph and label, the group header and the header pill.
- `-bg`: a tint for the group (rows, header blocks, the Needs-you count in the rail).
- `-line`: an edge colour (stripes, underlines, sticky tabs, neon outlines).

### Kinds of ask (`--ask-<kind>-fg` / `-bg` / `-line`)

| Kind | Meaning | Shared hue family |
| --- | --- | --- |
| `permission` | allow / deny a step | orange |
| `question` | the Foreman asks you to choose | violet |
| `hardline` | push, PR, rm -rf, migrations: always asks, can't be always-allowed | red |
| `blocked` | refused by auto mode or a hard line without a card | slate grey |

- `-line`: the card's border; a theme may also draw a stripe from it.
- `-bg`: the card's background. `-fg`: the label (`.ask-label` chip: "Hard line", "Auto mode").

### Stages (`--stage-<family>-fg` / `-bg`)

`spec`, `investigate`, `plan`, `build`, `test`, `review`, in workflow order: give them a walk
of distinct soft hues. `stageFamily()` in `panes/Jobs/stages.ts` maps the dashboard's ids onto
these: refine and spec-update are `spec`, implement is `build`, the PRs and staging QA are
`review`.

### Shape, pattern, type

| Token | Meaning | Default |
| --- | --- | --- |
| `--chip-radius` | radius of every chip (`.chip`, `.stage-chip`, `.brief-state`, `.steer-state`, `.rail-needs`) | `var(--radius-sm)` |
| `--card-radius` | radius of every card in the thread (`.reply`, `.brief-card`, `.problem`, `.live-row`, `.perm-card`, `.you`) | `var(--radius-lg)` |
| `--pane-pattern` | an optional `background-image` on each pane (a grid, dither, dots) | `none` |
| `--font-heading` | the font of `h1`–`h3` (the brand, pane titles, job title, card headlines) | `var(--font-display)` |
| `--row-alt` | the faint tint on every other row of a table in a rendered document (`.prose`); keep it subtle | `var(--border-1)` |

### The crew (`--crew-*`)

The Play layer's characters (`play/CrewMember.tsx`, styled in `play/play.css`) take every colour
from `--crew-*` tokens, generated from `CREW_TOKENS` in `tokens.ts` (the original rig's palette).
The default theme moves the ambers, golds and sparks to brass (`default.css`); every other theme
restyles them in its own file.

- Materials: `--crew-skin`, `-skin-shade`, `-blush`, `-ink` (faces), `-tongue`, `-feet`, `-shadow`,
  `-shine` (highlights), `-paper`, `-line`, `-glass`, `-glass-line`, `-metal`, `-wood`; the tools'
  own colours `-blueprint`, `-blueprint-dark`, `-clay`, `-gold`, `-gold-dark`, `-ok`, `-danger`,
  `-brush`; the effects `-spark` (working sparks) and `-zzz` (asleep).
- Paints: `--crew-c-clay`, `-amber`, `-amber-deep`, `-plum`, `-plum-deep`, `-tweed`, `-tweed-deep`,
  `-blueprint`, `-blueprint-deep`, `-moss`, `-teal`, `-steel`, `-forest`, `-forest-deep`. Each member
  wears two (body `--crew-paint`, hat `--crew-hat`, set in `play.css`); shades are mixed from them
  toward `--crew-shade-base` (black by default).
- Type: `--crew-font` (the sleeping z's).
- Not met yet (the Crew-dex's silhouettes): `--crew-silhouette` (every painted part) and
  `--crew-silhouette-line` (the soft outline), mixed from the theme's `--text-1` and `--bg-2` by default.
- Keep the needs-you hue off the crew: it stays the only thing on screen in that colour.

## Hooks

Stable class names and data attributes a theme may target. Their meaning is fixed; do not rename.

### Data attributes

| Hook | On | Values |
| --- | --- | --- |
| `data-theme` | `html` | the theme id |
| `data-group` | `.job-row`, `.job-rail-item`, `.job-status`, `.job-group`, `.job-group-title`, `.rail-group`, the header `.status` pill | `needs-you` `running` `paused` `idle` `done` |
| `data-ask` | `.perm-card` (permission and question cards), `.blocked-line` | `permission` `question` `hardline` `blocked` |
| `data-stage` | `.stage-chip` | `spec` `investigate` `plan` `build` `test` `review` |
| `data-pane` | the three panes (`.pane`) | `jobs` `foreman` `preview`, `settings` when Settings fills the middle, `crew` for the Crew-dex, `achievements` for Achievements |
| `data-crew` | `.crew`, `.dex-card` | the crew member's agent type (`conductor`, `feature-tester`…) |

### Class names

| Class | What it is |
| --- | --- |
| `.app` | the whole shell |
| `.topbar` | the top bar; `.brand` its title, `.needs` the "n need you" text, `.conn` the connection state |
| `.usage-banner` | the usage-limit banner under the top bar (`.usage-limited` while paused, `.usage-warn` the heads-up) |
| `.pane`, `.pane-jobs`, `.pane-foreman`, `.pane-preview` | the three panes; `.panes-rail` on their parent when Jobs is a rail |
| `.pane-resizer` | the handle between the middle pane and the Preview pane (`components/PaneResizer.tsx`; a focusable `role="separator"`, `.is-dragging` while dragged; its line is its `::after`). The Preview pane's width is `--preview-w` on `.panes`, clamped by `--preview-min` and `--middle-min` |
| `.pane-head`, `.pane-title` | a pane's header row and its `h2` title |
| `.job-group`, `.job-group-title` | a group in the Jobs pane and its heading (glyph, label, count) |
| `.job-row`, `.job-row-title`, `.job-row-meta`, `.job-status`, `.job-status-label` | one job in the list and its parts |
| `.job-rail-item`, `.rail-group`, `.rail-needs` | the same in the icon rail |
| `.hue-dot`, `.glyph` | the job's own colour dot; a status glyph |
| `.stage-chip` | the stage chip on a job row |
| `.job-header`, `.job-title`, `.job-facts`, `.status` | the open job's header, title, facts line and status pill |
| `.thread`, `.thread-item`, `.thread-meta`, `.who`, `.thread-time` | the conversation and the parts every item shares |
| `.reply` | a reply from the Foreman |
| `.you` | your message (`.is-steer` when it joined a running reply; `.steer-state` its delivery chip) |
| `.brief-card` | a brief (`.is-answered` once answered; `.brief-head`, `.brief-headline`, `.brief-body`, `.brief-state`) |
| `.problem`, `.live-row`, `.decision`, `.blocked-line`, `.auto-fold` | a problem card, the live row, a decision line, a blocked line, the folded routine steps |
| `.perm-card` | a permission or question card (`.question-card` on questions, `.is-risky` when Claude Code flags the step); `.perm-head`, `.perm-headline`, `.perm-preview`, `.perm-actions`, `.ask-label` |
| `.level-card` | the LevelCard: also a `.perm-card` with `data-ask="question"`, so it takes the question card's look; `.level-sources`, `.level-source` (rules and Foreman side by side), `.level-chosen`, `.level-consequence`, `.level-done` |
| `.gate-card` | the gate card above the composer: also a `.perm-card` with `data-ask="question"`; `.is-stale` when the plan changed since it was raised (greyed, approvals off), `.gate-held` when your reply waits in the composer; `.gate-question`, `.gate-rec` (the "Recommended" chip), `.gate-parked` (the "parked 4h" chip), `.gate-decided`, `.gate-decision` (`.is-changed` once overridden), `.gate-actions`, `.gate-menu` (the ⋯ menu), `.gate-chips`, `.gate-chip` (`aria-pressed`, `aria-disabled`), `.gate-lines` (the lines added to your reply); `.gate-notice` (`.is-ok`, `.is-problem`) says what happened after a decision |
| `.link-button` | a button that reads as a link (Override, Check again, Pick a level first) |
| `.level-chip`, `.level-pop` | the job header's level chip (also a `.chip`) and its panel (`.level-pop-list`, the current level `aria-current`) |
| `.level-picker` | the New job sheet's level choice (`.rule-option` rows), `.level-suggested`, `.level-floor` (the under-the-floor note, a `.perm-warn`) |
| `.composer` | the message box at the foot of the Foreman pane; `.composer-input`, `.composer-bar` |
| `.palette` | the ⌘K command palette; `.palette-input`, `.palette-option` (`.is-active`), `.palette-foot` |
| `.sheet`, `.sheet-backdrop` | every sheet (New job, Mark done, keys, Always allow, Send preview); `.sheet-title`, `.sheet-actions` |
| `.drawer`, `.drawer-backdrop` | the job drawer from the right edge (`.job-drawer`: notes and options); `.drawer-head`, `.drawer-title`, `.drawer-close`, `.drawer-tabs`, `.drawer-tab` (`aria-selected`), `.drawer-body`, `.drawer-section`, `.drawer-legend`, `.drawer-check`, `.drawer-bar`, `.drawer-count` (`.is-over`), `.drawer-state` (`.is-ok`), `.drawer-foot` (the sticky Save row), `.drawer-conflict` (in the Save row: the options changed elsewhere, with Reload), `.drawer-model-value` and `.drawer-model-note` (the Foreman's model, read only), `.drawer-summary` (what was saved), `.drawer-confirm` (the unsaved-changes question) |
| `.drawer-notes-preview`, `.notes-mode` | the drawer's notes Preview (a `.prose` page) and its Edit / Preview switch (`aria-pressed`) |
| `.prose` | every page of rendered Markdown: replies, briefs, the Docs tab, the notes Preview, a Markdown file on a permission card (`.perm-preview-page`, its `.perm-md-bar` switch). Inside: headings, `.table-wrap` around each table (zebra rows from `--border-1`), `pre`, inline `code`, `blockquote`, `hr`, `.id-link`, task lists (`li.task-item`, `.task-box`), `.json-doc`. Code inside a `pre` is reset to plain, above any theme's `.prose code` |
| `.preview-tabs`, `.preview-tab` | the Preview pane's tabs (Docs, Classic view; `aria-selected`) |
| `.docs-tab` | the Docs tab: `.doc-list`, `.doc-list-head`, `.doc-group`, `.doc-group-title`, `.doc-item` (one document: `.doc-name`, `.doc-version`, `.doc-type`, `.doc-time`), `.doc-empty`; the reader `.doc-reader` with `.doc-reader-head`, `.doc-back`, `.doc-title`, `.doc-facts`, `.doc-actions`, `.doc-view-toggle` (Page / Source, `aria-pressed`), `.doc-page` (the `.prose` page), `.doc-source` (the Markdown as written) |
| `.inline-code`, `.short-line` | short Foreman text shown clean on cards and the live row (`.short-heading`, `.short-quote`) |
| `.skill-warning` | Settings' warning that the installed /feature skill predates levels (also a `.perm-warn`) |
| `.settings` | the Settings view; `.settings-heading`, `.rule-options`, `.rule-option` (`.is-picked`), `.rule-list` |
| `.theme-picker`, `.theme-option`, `.theme-hint` | the theme picker in Settings |
| `.btn`, `.btn-primary`, `.btn-danger`, `.btn-quiet`, `.chip`, `.kbd`, `.text-input`, `.text-area`, `.select` | controls |
| `.how` | a "How this works" fold |
| `.crew` | a crew member (an inline `svg`): `.crew-<agent type>`, `.is-<state>` (`working` `waiting` `idle` `asleep` `celebrating` `walking` `thinking`), `.m-<motion>` (`strike` `write` `scan` `shake`), `.is-animated` (Full mode) or `.is-still`; parts `.rig`, `.head`, `.hat`, `.arm-l`, `.arm-r`, `.tool` (`.grip` inside), `.feet`, `.shadow`, `.fx`; `.is-silhouette` when not met yet. Restyle colours through `--crew-*` only |
| `.crew-tag`, `.crew-handoff`, `.crew-lineup`, `.live-crew`, `.foreman-face` | the crew in the conversation (Play on): a character with its name on a thread line, the workers a routine-steps line handed work to, a review brief's reviewers, who is at work in the live row, the Foreman by the job title. Never inside a gate card, a permission card or the composer |
| `.crew-dex` | the Crew-dex (Play on): `.dex-counts` (crew met, secrets found, `.dex-achievements` with its link to Achievements), `.dex-grid`, `.dex-card` (`.is-met` or `.is-unmet`, `.is-flipped`, `.rarity-common` `-uncommon` `-rare` `-legendary`), `.dex-card-inner`, `.dex-face` (`.dex-front`, `.dex-back`), `.dex-card-top`, `.dex-no`, `.dex-rarity` (a `.chip`; its dot is `--dex-rarity`), `.dex-portrait`, `.dex-name`, `.dex-role`, `.dex-model`, `.dex-stats`, `.dex-unmet-note`, `.dex-bio`, `.dex-first`, `.dex-flip` (the Card back toggle, `aria-pressed`) |
| `.job-trail` | the trail (`play/trail.css`, Play on): under the job's title (`.is-header`) and on a workshop-floor card (`.is-card`); `.is-full` in Full mode, `.is-ask` when it's your move, `data-group` the job's group. Parts: `.trail-field` (the meadow), `.trail-stars` (Full), `.trail-path`, `.trail-stop` (`.is-done` `.is-current` `.is-next`, `.is-goal`, `.is-here` where the crew member stands), `.trail-dot`, `.trail-label`, `.trail-who`, `.trail-ask` (the "!"), `.trail-now` with `.trail-lead`, `.trail-next`. Optional tokens a theme may set on `html[data-theme]`: `--trail-sky`, `--trail-ground`, `--trail-road`, `--trail-road-done`, `--trail-tree`, `--trail-trunk` (defaults are mixed from its paints) |
| `.workshop-floor` | the Foreman pane with no job open, Play on (`play/floor.css`): `.floor-foreman` (the Foreman's word: `.floor-foreman-face` the portrait, `.floor-bubble`, `.floor-eyebrow`, `.floor-say`, `.floor-asks` with one `.floor-ask` link per job: `.floor-ask-arrow`, `.floor-ask-title`, `.floor-ask-what`; `.floor-more`), the `.needs-you-inbox`, then `.floor-jobs` (`.floor-hint`, `.floor-grid`, `.floor-card` with `data-group`, `.floor-card-head`, `.floor-card-title` whose link covers the card, and a `.job-trail.is-card`) |
| `.row-crew` | a job's crew member at the start of its row in the Jobs list (Play on): the row is then `.job-row.has-crew`; `.row-crew-ask` is its small "!" |
| `.brand-mascot`, `.brand-tagline` | the Foreman by "Feature Workshop" in the top bar, and "Your crew, your features, your turn" (Play on) |
| `.boss-fight`, `.stamina` | the Full-mode extras (`play/extras.css`, Play mode Full only): the boss fight under an L3 review brief (`.boss-text`, `.boss-bar`, `.boss-bar-fill`, `.is-defeated`; on a theme's light brief card give `.boss-text` and `.boss-bar` its ink, as Blueprint does); stamina in the top bar (`.stamina-bar`, `.stamina-fill`, `.stamina-label`, `.is-fresh` `.is-warning` `.is-resting`); `.sleeping-crew` in a paused live row. Status, success and accent tokens only |
| `.play-settings` | Settings → Play (`.play-options`, `.play-quest-done`, `.play-legend`, `.play-sounds` with `.is-off` outside Full mode) |
| `.achievements` | the Achievements view (Play on, `play/achievements.css`): `.ach-summary`, `.ach-grid`, `.ach-badge` (`.is-unlocked` or `.is-locked`, `.is-secret`; `data-achievement` its id), `.ach-text`, `.ach-name`, `.ach-how`, `.ach-state` (`.is-unlocked` with the date, `.is-locked` with the word "Locked"), `.ach-secrets`, `.ach-secrets-left`, `.ach-unlocks`, `.ach-unlock-list` |
| `.ach-medal` | an achievement's badge (an inline `svg`): `.is-unlocked` / `.is-locked`, `.is-secret`, `.is-quest`; parts `.ach-rim`, `.ach-face`, `.ach-glyph`, `.ach-ribbon-l`, `.ach-ribbon-r`. Colours from `--medal`, `--medal-rim`, `--medal-glyph`, `--ribbon-l`, `--ribbon-r` (default: the crew's gold and the accent) |
| `.play-toasts` | the play toasts' corner (`.at-bottom-end`: bottom right, over the Preview pane, under sheets): `.play-toast` (`.is-achievement` `.is-secret` `.is-quest`, `.has-burst` in Full mode), `.play-toast-badge`, `.play-toast-label`, `.play-toast-name`, `.play-toast-line`, `.play-toast-close`, `.play-toasts-more`; the burst `.play-burst` (`.burst-<kind>`) and its `.play-burst-piece` (`.tone-0`…`.tone-3`). Never move them over the middle pane |
| `.theme-unlocked` | the "Unlocked" chip on a hidden theme in the picker (`.theme-option.is-hidden-theme`) |
| `.toast` | the error toast |

## Adding a theme

1. Add it to `THEMES` in `theme.ts` (id, label, one-line description).
2. Create `themes/<id>.css` with a comment header, every rule under `html[data-theme="<id>"]`.
3. Add `@import './<id>.css';` to `themes/index.css`.
4. `npm run web:test` checks the file exists, is scoped, and is imported; a hidden theme (and any
   theme besides Default) must also set every token in `REQUIRED_THEME_TOKENS`
   (`themes.test.ts`: the palette, groups, asks, stages, shape, `--row-alt` and the crew's paints).
