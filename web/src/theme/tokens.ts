// Design tokens for the new UI, the one place colours, type, spacing and motion are decided.
//
// Colours are generated in oklch from three inputs (design doc section 9, research brief section 4):
// a base hue for the neutrals, an accent hue, and a contrast factor. Only the dark theme exists in
// phase 1; light and high-contrast come from the same generator in phase 6.
//
// tokens.css is generated from this file (the Vite plugin in vite.config.ts rewrites it whenever it
// differs, and a test fails if the committed copy is out of date). Edit this file, never tokens.css.
//
// Themes (theme/themes/<id>.css, picked by theme/theme.ts) override the *semantic* tokens at the
// foot of this file under html[data-theme="<id>"]; see theme/THEMING.md.

export interface ThemeInput {
  /** Hue of the neutral greys (a hint of blue at 260). */
  baseHue: number;
  /** Hue of the single accent colour (indigo at 275). */
  accentHue: number;
  /** 1 = the standard sheet. Higher spreads text and border contrast (for high contrast later). */
  contrast: number;
}

export const DARK: ThemeInput = { baseHue: 260, accentHue: 275, contrast: 1 };

/**
 * Text size (Settings → Look, theme/textSize.ts): one factor, --ui-scale, set by html[data-text].
 * The type tokens, --row-h and --topbar-h are written as calc(<N>px * var(--ui-scale)), so the
 * whole UI's type and row heights follow it; the pane widths (--jobs-w, --preview-w, --foreman-max)
 * stay as they are. A theme that sets a type size in px writes the same calc (see THEMING.md).
 */
export const TEXT_SCALES = { s: 0.875, m: 1, l: 1.125, xl: 1.25 } as const;
export type TextSizeId = keyof typeof TEXT_SCALES;

/** `<N>px` scaled by the text size: calc(<N>px * var(--ui-scale, 1)). */
export const scaled = (px: number) => `calc(${px}px * var(--ui-scale, 1))`;

/** Status hues. Status is always shown with text as well; colour only supports it. */
export const STATUS_HUES = { ok: 155, warn: 80, error: 25, info: 235 } as const;

const num = (n: number) => String(Math.round(n * 1000) / 1000).replace(/^0\./, '.');
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function oklch(l: number, c: number, h: number, alpha?: number): string {
  const a = alpha === undefined ? '' : ` / ${num(alpha)}`;
  return `oklch(${num(clamp(l, 0, 1))} ${num(c)} ${num(h)}${a})`;
}

/** Every colour token for one theme, by CSS custom property name (without the leading --). */
export function colorTokens({ baseHue, accentHue, contrast }: ThemeInput): Record<string, string> {
  const k = clamp(contrast, 0.5, 2);
  const out: Record<string, string> = {};
  // Five background steps, darkest (the window) to lightest (raised controls).
  [0.16, 0.19, 0.22, 0.25, 0.28].forEach((l, i) => { out[`bg-${i}`] = oklch(l, 0.006, baseHue); });
  // Borders: white at 6%, 10% and 18%.
  [0.06, 0.1, 0.18].forEach((a, i) => { out[`border-${i + 1}`] = oklch(1, 0, 0, clamp(a * k, 0, 1)); });
  // Text: primary (APCA Lc 90 target), secondary (Lc 60+), and faint for hints and disabled.
  out['text-1'] = oklch(0.95, 0.004, baseHue);
  out['text-2'] = oklch(0.72 + (k - 1) * 0.12, 0.01, baseHue);
  out['text-3'] = oklch(0.58 + (k - 1) * 0.15, 0.01, baseHue);
  // The accent and its variants.
  out['accent'] = oklch(0.7, 0.15, accentHue);
  out['accent-strong'] = oklch(0.78, 0.13, accentHue);
  out['accent-soft'] = oklch(0.7, 0.15, accentHue, 0.16);
  out['on-accent'] = oklch(0.16, 0.02, accentHue);
  out['focus-ring'] = oklch(0.78, 0.13, accentHue);
  // Status: a readable foreground and a quiet background for each, plus paused grey.
  for (const [name, hue] of Object.entries(STATUS_HUES)) {
    out[`status-${name}`] = oklch(0.78, 0.14, hue);
    out[`status-${name}-bg`] = oklch(0.78, 0.14, hue, 0.14);
  }
  // Per-job hue dots (theme/hue.ts): one lightness and chroma for every job's hue.
  out['job-hue-l'] = num(0.74);
  out['job-hue-c'] = num(0.13);
  out['status-paused'] = oklch(0.7, 0, 0);
  out['status-paused-bg'] = oklch(0.7, 0, 0, 0.12);
  // Charts: eight series colours, readable on the dark page, each with its pattern (--chart-pattern-<n>).
  CHART_HUES.forEach((h, i) => { out[`chart-${i + 1}`] = oklch(0.74, 0.13, h); });
  // Two-layer translucent shadows.
  out['shadow-1'] = `0 1px 2px ${oklch(0, 0, 0, 0.3)}, 0 2px 8px ${oklch(0, 0, 0, 0.2)}`;
  out['shadow-2'] = `0 2px 4px ${oklch(0, 0, 0, 0.3)}, 0 12px 32px ${oklch(0, 0, 0, 0.35)}`;
  return out;
}

/** How many chart series every theme colours (--chart-1 … --chart-8). */
export const CHART_SERIES = 8;
const ink = 'color-mix(in srgb, var(--bg-0) 55%, transparent)';
/**
 * One pattern per chart series, in order: plain, then stripes, dots and checks at different angles,
 * so two series side by side always differ by more than colour (--chart-pattern-<n>).
 */
export const CHART_PATTERNS: readonly string[] = [
  'none',
  `repeating-linear-gradient(45deg, ${ink} 0 2px, transparent 2px 7px)`,
  `radial-gradient(${ink} 1.2px, transparent 1.6px) 0 0 / 6px 6px`,
  `repeating-linear-gradient(-45deg, ${ink} 0 2px, transparent 2px 7px)`,
  `repeating-linear-gradient(0deg, ${ink} 0 2px, transparent 2px 6px)`,
  `repeating-linear-gradient(90deg, ${ink} 0 2px, transparent 2px 6px)`,
  `repeating-conic-gradient(${ink} 0 25%, transparent 0 50%) 0 0 / 8px 8px`,
  `repeating-linear-gradient(45deg, ${ink} 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, ${ink} 0 1px, transparent 1px 4px)`,
];

/** The default chart hues, in order: blue, orange, aqua, yellow, then violet, green, red and pink. */
export const CHART_HUES = [255, 55, 195, 95, 300, 150, 25, 345] as const;

/** Everything that doesn't depend on the theme: type, spacing, shape, motion and layout. */
export const STATIC_TOKENS: Record<string, string> = {
  // Type: Inter 13px with a line height of 1.45, mono with tabular numbers for times and counts.
  // No font files ship yet; Inter and Geist Mono are used when installed, else the system fonts.
  'font-sans': '"Inter", "Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  'font-display': '"Inter Display", "Inter", "Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif',
  'font-mono': '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  // Each type size scales with the text size setting (--ui-scale, 1 at the medium setting).
  'ui-scale': '1',
  'text-xs': scaled(11),
  'text-sm': scaled(12),
  'text-base': scaled(13),
  'text-md': scaled(15),
  'text-lg': scaled(20),
  'text-xl': scaled(28),
  'leading': '1.45',
  'weight-regular': '400',
  'weight-medium': '500',
  'weight-bold': '600',
  // 4px grid.
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '20px',
  'space-6': '24px',
  'space-8': '32px',
  'space-10': '40px',
  // Corner radii; a child is never rounder than its parent.
  'radius-sm': '4px',
  'radius-md': '6px',
  'radius-lg': '10px',
  'radius-xl': '14px',
  // Motion: transform and opacity only, nothing over 200ms (plan §7's quality bar), ease-out on entry.
  'dur-fast': '120ms',
  'dur-menu': '180ms',
  'dur-pane': '200ms',
  'ease-out': 'cubic-bezier(.16, 1, .3, 1)',
  'motion-shift': '4px',
  'motion-scale-from': '.96',
  // Layout. The two heights follow the text size; the widths do not.
  'topbar-h': scaled(56),
  'row-h': scaled(32),
  'jobs-w': '264px',
  'jobs-w-min': '240px',
  'jobs-w-max': '280px',
  'rail-w': '48px',
  'foreman-max': '760px',
  'preview-w': '40%',
  // Every clickable thing is at least 40 px tall (plan §7): buttons, rows, tabs, chips, menu items.
  // It grows with a larger text size and never shrinks under 40 px with a smaller one.
  'control-h': 'max(40px, calc(40px * var(--ui-scale, 1)))',
  // The big calls (Start, Go, Approve) and the page's one next-step button.
  'control-h-lg': 'max(44px, calc(44px * var(--ui-scale, 1)))',
  // The page column of the new screens, and the width under which they turn into their phone form.
  'page-max': '1180px',
  // Each chart series' pattern (laid over its colour, so a series is never told by colour alone):
  // drawn in the page's own background colour, so no theme needs its own copy.
  ...Object.fromEntries(CHART_PATTERNS.map((p, i) => [`chart-pattern-${i + 1}`, p])),
};

/** The four lanes of Jobs (dashboard/lib/snapshot.js laneFor), and the two folded under the board. */
export const LANE_NAMES = ['working', 'needs-you', 'in-review', 'ready', 'resting', 'done'] as const;

/** The six job groups (dashboard/lib/snapshot.js), the four kinds of ask, and the six stage families. */
export const GROUP_NAMES = ['needs-you', 'running', 'paused', 'idle', 'shipping', 'done'] as const;
export const ASK_NAMES = ['permission', 'question', 'hardline', 'blocked'] as const;
export const STAGE_NAMES = ['spec', 'investigate', 'plan', 'build', 'test', 'review'] as const;

/**
 * Semantic tokens: what a theme restyles (theme/THEMING.md). Each points at a base token, so the
 * default look is exactly what it was before themes existed; a theme overrides these under its
 * html[data-theme="<id>"] and the components follow, since app.css reads only these.
 *   --group-<g>-fg/-bg/-line   a job group's text (glyph + label), tint and edge colour
 *   --ask-<k>-fg/-bg/-line     a card's label, background and border/stripe, per kind of ask
 *   --stage-<s>-fg/-bg         a stage chip's text and background
 *   --chip-radius, --card-radius, --pane-pattern (a background image or none), --font-heading
 */
export function semanticTokens(): Record<string, string> {
  const out: Record<string, string> = {};
  const groups: Record<(typeof GROUP_NAMES)[number], [string, string, string]> = {
    'needs-you': ['var(--status-warn)', 'var(--status-warn-bg)', 'var(--status-warn)'],
    running: ['var(--status-info)', 'var(--status-info-bg)', 'var(--status-info)'],
    paused: ['var(--status-paused)', 'var(--status-paused-bg)', 'var(--status-paused)'],
    idle: ['var(--text-2)', 'var(--bg-3)', 'var(--border-2)'],
    // Past the finish line, not in main yet: a cool blue, like Running, since both mean "moving".
    shipping: ['var(--status-info)', 'var(--status-info-bg)', 'var(--status-info)'],
    done: ['var(--status-ok)', 'var(--status-ok-bg)', 'var(--status-ok)'],
  };
  for (const g of GROUP_NAMES) {
    const [fg, bg, line] = groups[g];
    out[`group-${g}-fg`] = fg;
    out[`group-${g}-bg`] = bg;
    out[`group-${g}-line`] = line;
  }
  // Today every card has the accent border and a text-2 label; a blocked line is dim.
  const asks: Record<(typeof ASK_NAMES)[number], [string, string, string]> = {
    permission: ['var(--text-2)', 'var(--bg-2)', 'var(--accent)'],
    question: ['var(--text-2)', 'var(--bg-2)', 'var(--accent)'],
    hardline: ['var(--text-2)', 'var(--bg-2)', 'var(--accent)'],
    blocked: ['var(--text-3)', 'transparent', 'var(--border-2)'],
  };
  for (const k of ASK_NAMES) {
    const [fg, bg, line] = asks[k];
    out[`ask-${k}-fg`] = fg;
    out[`ask-${k}-bg`] = bg;
    out[`ask-${k}-line`] = line;
  }
  // Today every stage chip is the same quiet outline.
  for (const s of STAGE_NAMES) {
    out[`stage-${s}-fg`] = 'var(--text-2)';
    out[`stage-${s}-bg`] = 'transparent';
  }
  out['chip-radius'] = 'var(--radius-sm)';
  out['card-radius'] = 'var(--radius-lg)';
  out['pane-pattern'] = 'none';
  out['font-heading'] = 'var(--font-display)';
  // Every other row of a table in a rendered document: a faint tint (the default's border-1 is one).
  out['row-alt'] = 'var(--border-1)';
  // The lanes of Jobs: each lane's word and icon colour, its tint and its edge. Needs you is the only
  // tinted lane; a lane is always named in words and with its icon, never by colour alone.
  const lanes: Record<(typeof LANE_NAMES)[number], [string, string, string]> = {
    working: ['var(--status-info)', 'transparent', 'var(--border-2)'],
    'needs-you': ['var(--status-warn)', 'var(--status-warn-bg)', 'var(--status-warn)'],
    'in-review': ['var(--text-2)', 'transparent', 'var(--border-2)'],
    ready: ['var(--status-ok)', 'transparent', 'var(--border-2)'],
    resting: ['var(--text-3)', 'transparent', 'var(--border-1)'],
    done: ['var(--status-ok)', 'transparent', 'var(--border-1)'],
  };
  for (const l of LANE_NAMES) {
    const [fg, bg, line] = lanes[l];
    out[`lane-${l}-fg`] = fg;
    out[`lane-${l}-bg`] = bg;
    out[`lane-${l}-line`] = line;
  }
  // Hover on a row, tab or menu item; the faint grid behind the go / no go console (Play full);
  // the small tooltip on a stop dot.
  out['hover-bg'] = 'var(--bg-3)';
  out['grid-line'] = 'var(--border-1)';
  out['tooltip-bg'] = 'var(--text-1)';
  out['tooltip-fg'] = 'var(--bg-0)';
  return out;
}

/**
 * The crew's colours (play/CrewMember.tsx, play/play.css), the palette of the original rig
 * (dashboard/public/crew.js). A theme restyles any of them under html[data-theme="<id>"].
 *   materials: skin, ink (faces), feet, shadow, glass, metal, wood, paper, shine, the tools' own colours
 *   --crew-c-*: the 14 paint colours the crew wear (each member's body and hat pick two, play.css)
 *   --crew-shade-base: what the paints' shades are mixed toward; --crew-font: the sleeping z's
 *   --crew-silhouette, --crew-silhouette-line: a member not met yet (the Crew-dex), mixed from the
 *     theme's own text and card colours so it reads in every theme
 */
export const CREW_TOKENS: Record<string, string> = {
  'crew-shade-base': '#000000',
  'crew-silhouette': 'color-mix(in srgb, var(--text-1) 24%, var(--bg-2))',
  'crew-silhouette-line': 'color-mix(in srgb, var(--text-1) 42%, var(--bg-2))',
  'crew-font': 'ui-rounded, system-ui, sans-serif',
  'crew-skin': '#f6d6ae',
  'crew-skin-shade': '#dcae7c',
  'crew-blush': '#f59a8b',
  'crew-ink': '#2a2440',
  'crew-tongue': '#f08080',
  'crew-feet': '#3b3456',
  'crew-shadow': 'rgb(0 0 0 / .32)',
  'crew-shine': '#ffffff',
  'crew-paper': '#ffffff',
  'crew-line': '#9aa3b8',
  'crew-glass': '#c9eeff',
  'crew-glass-line': '#7fb8d6',
  'crew-metal': '#a9b2c6',
  'crew-wood': '#9a6232',
  'crew-blueprint': '#3a72d8',
  'crew-blueprint-dark': '#22467a',
  'crew-clay': '#d9643a',
  'crew-gold': '#f2b415',
  'crew-gold-dark': '#b97b06',
  'crew-ok': '#2fae4a',
  'crew-danger': '#e2453f',
  'crew-brush': '#e8554f',
  'crew-spark': '#ffd23a',
  'crew-zzz': '#8fa6ff',
  'crew-c-clay': '#ea6a3a',
  'crew-c-amber': '#f8b830',
  'crew-c-amber-deep': '#d48a10',
  'crew-c-plum': '#a256c4',
  'crew-c-plum-deep': '#763799',
  'crew-c-tweed': '#b38a50',
  'crew-c-tweed-deep': '#7f5f30',
  'crew-c-blueprint': '#3a72d8',
  'crew-c-blueprint-deep': '#2850a8',
  'crew-c-moss': '#4fb04a',
  'crew-c-teal': '#22aaa2',
  'crew-c-steel': '#8890a8',
  'crew-c-forest': '#2f9a5c',
  'crew-c-forest-deep': '#1f7044',
};

/** With reduced motion, only fades remain: no movement or scaling, and pulses stop (see app.css). */
export const REDUCED_MOTION_TOKENS: Record<string, string> = {
  'motion-shift': '0px',
  'motion-scale-from': '1',
};

function block(selector: string, vars: Record<string, string>, indent = ''): string {
  const lines = Object.entries(vars).map(([k, v]) => `${indent}  --${k}: ${v};`);
  return `${indent}${selector} {\n${lines.join('\n')}\n${indent}}`;
}

/** The contents of tokens.css. */
export function tokensCss(): string {
  return [
    '/* Generated from tokens.ts by the Vite plugin in vite.config.ts. Do not edit by hand. */',
    '',
    block(':root, [data-theme="dark"]', { ...STATIC_TOKENS, ...colorTokens(DARK), ...semanticTokens(), ...CREW_TOKENS }).replace('{\n', '{\n  color-scheme: dark;\n'),
    '',
    '/* Text size (theme/textSize.ts): html[data-text] sets the one factor every type token reads. */',
    ...Object.entries(TEXT_SCALES).map(([id, scale]) => block(`html[data-text="${id}"]`, { 'ui-scale': num(scale) })),
    '',
    '@media (prefers-reduced-motion: reduce) {',
    block(':root', REDUCED_MOTION_TOKENS, '  '),
    '}',
    '',
  ].join('\n');
}
