// Design tokens for the new UI, the one place colours, type, spacing and motion are decided.
//
// Colours are generated in oklch from three inputs (design doc section 9, research brief section 4):
// a base hue for the neutrals, an accent hue, and a contrast factor. Only the dark theme exists in
// phase 1; light and high-contrast come from the same generator in phase 6.
//
// tokens.css is generated from this file (the Vite plugin in vite.config.ts rewrites it whenever it
// differs, and a test fails if the committed copy is out of date). Edit this file, never tokens.css.

export interface ThemeInput {
  /** Hue of the neutral greys (a hint of blue at 260). */
  baseHue: number;
  /** Hue of the single accent colour (indigo at 275). */
  accentHue: number;
  /** 1 = the standard sheet. Higher spreads text and border contrast (for high contrast later). */
  contrast: number;
}

export const DARK: ThemeInput = { baseHue: 260, accentHue: 275, contrast: 1 };

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
  // Two-layer translucent shadows.
  out['shadow-1'] = `0 1px 2px ${oklch(0, 0, 0, 0.3)}, 0 2px 8px ${oklch(0, 0, 0, 0.2)}`;
  out['shadow-2'] = `0 2px 4px ${oklch(0, 0, 0, 0.3)}, 0 12px 32px ${oklch(0, 0, 0, 0.35)}`;
  return out;
}

/** Everything that doesn't depend on the theme: type, spacing, shape, motion and layout. */
export const STATIC_TOKENS: Record<string, string> = {
  // Type: Inter 13px with a line height of 1.45, mono with tabular numbers for times and counts.
  // No font files ship yet; Inter and Geist Mono are used when installed, else the system fonts.
  'font-sans': '"Inter", "Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  'font-display': '"Inter Display", "Inter", "Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif',
  'font-mono': '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  'text-xs': '11px',
  'text-sm': '12px',
  'text-base': '13px',
  'text-md': '15px',
  'text-lg': '20px',
  'text-xl': '28px',
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
  // Motion: transform and opacity only, nothing over 300ms, ease-out on entry.
  'dur-fast': '120ms',
  'dur-menu': '180ms',
  'dur-pane': '240ms',
  'ease-out': 'cubic-bezier(.16, 1, .3, 1)',
  'motion-shift': '4px',
  'motion-scale-from': '.96',
  // Layout.
  'topbar-h': '40px',
  'row-h': '32px',
  'jobs-w': '264px',
  'jobs-w-min': '240px',
  'jobs-w-max': '280px',
  'rail-w': '48px',
  'foreman-max': '760px',
  'preview-w': '40%',
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
    block(':root, [data-theme="dark"]', { ...STATIC_TOKENS, ...colorTokens(DARK) }).replace('{\n', '{\n  color-scheme: dark;\n'),
    '',
    '@media (prefers-reduced-motion: reduce) {',
    block(':root', REDUCED_MOTION_TOKENS, '  '),
    '}',
    '',
  ].join('\n');
}
