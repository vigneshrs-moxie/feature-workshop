// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASK_NAMES, CHART_SERIES, colorTokens, DARK, GROUP_NAMES, LANE_NAMES, oklch, semanticTokens, STAGE_NAMES, STATIC_TOKENS, tokensCss, PHONE_TOKENS } from './tokens';

describe('design tokens', () => {
  it('the committed tokens.css matches tokens.ts (run `npm run web:build` to regenerate)', () => {
    const file = fileURLToPath(new URL('./tokens.css', import.meta.url));
    expect(readFileSync(file, 'utf8')).toBe(tokensCss());
  });

  it('gives every group, kind of ask and stage its semantic tokens, pointing at base tokens', () => {
    const s = semanticTokens();
    const base = new Set([...Object.keys(STATIC_TOKENS), ...Object.keys(colorTokens(DARK))]);
    for (const g of GROUP_NAMES) for (const v of ['fg', 'bg', 'line']) expect(s[`group-${g}-${v}`]).toBeTruthy();
    for (const k of ASK_NAMES) for (const v of ['fg', 'bg', 'line']) expect(s[`ask-${k}-${v}`]).toBeTruthy();
    for (const st of STAGE_NAMES) for (const v of ['fg', 'bg']) expect(s[`stage-${st}-${v}`]).toBeTruthy();
    for (const k of ['chip-radius', 'card-radius', 'pane-pattern', 'font-heading']) expect(s[k]).toBeTruthy();
    // The defaults keep the old look: each value is a base token (or a plain keyword), never a new colour.
    for (const [k, v] of Object.entries(s)) {
      const ref = /^var\(--([a-z0-9-]+)\)$/.exec(v);
      if (ref) expect(base.has(ref[1]), `${k} points at an unknown token ${ref[1]}`).toBe(true);
      else expect(['none', 'transparent'], `${k} = ${v}`).toContain(v);
    }
    expect(s['group-needs-you-fg']).toBe('var(--status-warn)');
    // Shipping (past the finish line, not in main): a cool blue like status-info, so .status-shipping needs no fallback.
    expect(GROUP_NAMES).toContain('shipping');
    expect(s['group-shipping-fg']).toBe('var(--status-info)');
    expect(tokensCss()).toContain('--group-shipping-line: var(--status-info);');
    expect(s['pane-pattern']).toBe('none');
    expect(tokensCss()).toContain('--group-needs-you-fg: var(--status-warn);');
  });

  it('formats oklch compactly', () => {
    expect(oklch(0.16, 0.006, 260)).toBe('oklch(.16 .006 260)');
    expect(oklch(1, 0, 0, 0.06)).toBe('oklch(1 0 0 / .06)');
  });

  it('the dark theme follows the research brief', () => {
    const c = colorTokens(DARK);
    expect(c['bg-0']).toBe('oklch(.16 .006 260)');
    expect(c['bg-4']).toBe('oklch(.28 .006 260)');
    // Packet R: borders that show on every layer.
    expect(c['border-1']).toBe('oklch(1 0 0 / .07)');
    expect(c['border-3']).toBe('oklch(1 0 0 / .2)');
    expect(c['text-1']).toMatch(/^oklch\(\.95 /);
    expect(c['text-2']).toMatch(/^oklch\(\.72 /);
    expect(c['accent']).toBe('oklch(.7 .15 275)');
    for (const s of ['ok', 'warn', 'error', 'info', 'paused']) expect(c[`status-${s}`]).toBeTruthy();
  });

  it('higher contrast spreads text and borders', () => {
    const hi = colorTokens({ ...DARK, contrast: 1.5 });
    expect(hi['text-2']).not.toBe(colorTokens(DARK)['text-2']);
    expect(hi['border-1']).toBe('oklch(1 0 0 / .105)');
  });

  it('keeps every motion duration at or under 200ms and spacing on the 4px grid', () => {
    for (const [k, v] of Object.entries(STATIC_TOKENS)) {
      if (k.startsWith('dur-')) expect(parseInt(v, 10)).toBeLessThanOrEqual(200);
      if (k.startsWith('space-')) expect(parseInt(v, 10) % 4).toBe(0);
    }
  });

  it('turns movement off when reduced motion is asked for', () => {
    expect(tokensCss()).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n {2}:root \{\n {4}--motion-shift: 0px;/);
  });

  it('controls are 28, 34 and 40 px (packet R), never smaller at any text size, and at least 40 px on a phone', () => {
    expect(STATIC_TOKENS['control-h-sm']).toBe('max(28px, calc(28px * var(--ui-scale, 1)))');
    expect(STATIC_TOKENS['control-h']).toBe('max(34px, calc(34px * var(--ui-scale, 1)))');
    expect(STATIC_TOKENS['control-h-lg']).toBe('max(40px, calc(40px * var(--ui-scale, 1)))');
    for (const k of ['control-h-sm', 'control-h', 'control-h-lg']) expect(PHONE_TOKENS[k], k).toMatch(/^max\(4[04]px, /);
    expect(tokensCss()).toMatch(/@media \(max-width: 760px\) \{\n {2}:root \{\n {4}--control-h-sm: max\(40px,/);
  });

  it('gives the charts eight colours, each with its own pattern drawn without a literal colour', () => {
    const c = colorTokens(DARK);
    const colours = Array.from({ length: CHART_SERIES }, (_, i) => c[`chart-${i + 1}`]);
    expect(colours.every(Boolean)).toBe(true);
    expect(new Set(colours).size).toBe(CHART_SERIES);
    const patterns = Array.from({ length: CHART_SERIES }, (_, i) => STATIC_TOKENS[`chart-pattern-${i + 1}`]);
    expect(new Set(patterns).size).toBe(CHART_SERIES);
    for (const p of patterns) expect(p).not.toMatch(/#[0-9a-f]{3,8}\b|oklch\(|\brgba?\(/i);
  });

  it('names a colour for each lane of Jobs, with Needs you the only tinted one', () => {
    const s = semanticTokens();
    for (const l of LANE_NAMES) for (const v of ['fg', 'bg', 'line']) expect(s[`lane-${l}-${v}`]).toBeTruthy();
    expect(LANE_NAMES.filter((l) => s[`lane-${l}-bg`] !== 'transparent')).toEqual(['needs-you']);
  });
});
