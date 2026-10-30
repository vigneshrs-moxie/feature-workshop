# Packet X · Findings before fixing (2026-10-30)

From `web/e2e/themeSweep.mjs` on main (c964804), against the demo: 11 themes, 1512 and 390 px, Play full
and off (CRT Terminal and Gold need Play on, so they are swept in Play full only), 48 visits each (every
screen, every kind of overlay, hover rows). Words are measured against the pixels really behind them.
The raw list (theme, screen, element, what, numbers) and a contact sheet per theme are in the
scratchpad of the run (`before/findings.md`, `before/sheets/<theme>-play-<mode>.png`).

No console errors, no sideways scroll, no theme failing to apply, Follow the system switches both
pairs on load and live. What breaks, grouped by cause (numbers are the measured worst cases):

## 1. See-through surfaces in Glass and Light glass (the "Glass breaks a lot" report)
- **Menus, the Select list, the Peek** paint `--surface-1`, which is 4–5% white (or ink) in both
  Glass themes. The page shows through every word: the Peek's next-step bar 1.25:1, "Open the job"
  1.2–1.9:1, menu items 2.2–3.5:1, the Select list 4.2:1 (both widths, both Play modes).
- **The job page's and part page's right column is blank in both Glass themes.** The composer's frost
  (`.composer::before`, inset 0, z-index -1) assumed a sticky composer; the side column's composer is
  `position: static`, so the frost covers the whole column: the now line, Details, the conversation,
  the level card and its "Use L2" button are drawn at 1.02–1.08:1 (Job, Job with a permission card,
  Job working, Part page; 440 "hidden" rows).
- **Tooltip words and the needs-you ink** come from `--bg-0`, 55–58% opaque in both Glass themes.
- **The top bar** over the brightest aurora: the search words, ⌘K, the Desk count and "Demo" at
  3.98–4.46:1 (Glass); quiet words straight on the aurora (Screens' version chip, the floor lab's
  theme buttons) 4.3:1.
- **Telemetry's label on the share bar** sits on `--bg-1`: 1.38:1 (Glass), 2.49:1 (Light glass).
- Light glass: the picked Map/Table chip's count 3.98:1 (`--bg-0` ink); New job in the top bar has no
  edge or fill (1.01:1).

## 2. A theme's own control rules outrank the shared ones
- **The key cap on the primary button** takes the theme's `.kbd` ink: 1.06:1 (Light glass), 1.07:1
  (Neon arcade), 1.48:1 (Blueprint), 2.68:1 (Pixel crew).
- **Disabled buttons look live** wherever a theme restyles `.btn` (Glass's "Merge part 7", seen on the
  sheets; no number, it is a state).
- **The Desk's gate card** is boxed again by the theme's `.perm-card` (Glass, Light glass, Neon arcade):
  a frame with no room inside, the words touching its edge.

## 3. Light cards in a dark theme (Blueprint)
Packet R's controls inside Blueprint's cream index cards read the page tokens (chalk on blue): unpicked
answer rows navy with navy words 1.2:1, the permission alert's detail 1.2:1, a ticked box 1.55:1, the
toast's Dismiss 1.38:1; the card-only amber warning style on the blue page in Settings 1.17:1.

## 4. Tokens the themes never got
- `--stop-*` and `--status-review` are set only by Default and the three light themes. The seven other
  dark themes fall back to Default's ring, whose pink Spec borrows their needs-you colour (the theme
  rule: needs-you is the only thing in that colour).
- `--surface-float` (anything that floats) did not exist; see 1.

## 5. Quiet marks under 3:1
- The Map's empty ship dots (`--border-3` ring): 1.64–2.31:1 in every theme.
- The Desk's queue dots (needs-you at half opacity): 1.77:1 (Light, Sunset paper), 2.23:1 (Light glass).
- The stack map's edges (`--border-3`): 1.78:1 (Sunset paper), 1.69:1 (Pixel crew).
- Sunset paper's job hue dots 2.83:1.
- The "!" bubble over a crew member (page colour on the needs-you text colour): 3.2–4.2:1 (Light,
  CRT, Sunset paper, Blueprint).

## 6. Focus rings
- **A Needs-you job card shows no focus ring at all** (every theme; the lane's stripe replaced it).
- The Telemetry limit bar's segments: the ring is the segment's own hue, 1.4–2.6:1.

## 7. Words faded or crossed by decoration
- The stack map dims every other part's whole card while one is lit: words at 2.4–3.8:1.
- Candy pop: sheets inherit the whole background, so the top stripe is drawn again through the first
  field's label (1.32–1.39:1) and the keys sheet's notes (1.3:1).
- The floor's "·" separators 4.1:1 (Light, Sunset paper); the key legend's caps 4.46:1 (Light); the
  pressed red button 4.28:1 (Light, gallery).

## 8. The classic page
Station names over the classic map's meadow: 2.5–4.2:1 in most themes (`dashboard/public/styles.css`).

## Not real (the sweep's own limits, fixed in the sweep)
- Gradient-filled words (the brand in Neon arcade, Candy pop and Gold) measured as one colour.
- Words cut with an ellipsis measured past their own box; hover states left by the previous visit's
  pointer; screenshot time-outs under load (24 visits, retried with a longer wait).

## After (the same sweep on the packet's last commit)
Every theme passes: all 11 themes at 1512 and 390 px, Play full and off (CRT Terminal and Gold in Play
full), with no console error, no words under 4.5:1 (3:1 large), no see-through overlay, no mark under
3:1, no invisible focus ring, no sideways scroll, and Follow the system switching both pairs. The
second sweep round also found and fixed: Gold's 3D floor drawn in Light's colours when the theme
arrived after the scene was made, the stack map fading its links to 1.5:1 while one part is lit, the
desk count on a hovered menu row, CRT's picked palette row's key cap, and Blueprint's flat Desk gate
card. The before and after contact sheets are in the run's scratchpad (`before/sheets`, `after/sheets`).

Also run on the last commit: `web/e2e/noJump.mjs` at 390, 1280, 1512 and 1728 px (nothing moved at any
width; at 390 the graphs start folded, so it unfolds first) and `web/e2e/contrast.mjs THEMES=all`. The
latter reads colours from styles, not pixels: its remaining rows are all marked "img" (the gradient
primaries of Neon arcade, Candy pop, Glass and Gold, and gradient-filled brand words), which it cannot
composite and the sweep measures by pixel; one real one it found (Blueprint's link buttons on a brief
card) is fixed.
