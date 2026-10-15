// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { colorTokens, DARK, oklch, STATIC_TOKENS, tokensCss } from './tokens';

describe('design tokens', () => {
  it('the committed tokens.css matches tokens.ts (run `npm run web:build` to regenerate)', () => {
    const file = fileURLToPath(new URL('./tokens.css', import.meta.url));
    expect(readFileSync(file, 'utf8')).toBe(tokensCss());
  });

  it('formats oklch compactly', () => {
    expect(oklch(0.16, 0.006, 260)).toBe('oklch(.16 .006 260)');
    expect(oklch(1, 0, 0, 0.06)).toBe('oklch(1 0 0 / .06)');
  });

  it('the dark theme follows the research brief', () => {
    const c = colorTokens(DARK);
    expect(c['bg-0']).toBe('oklch(.16 .006 260)');
    expect(c['bg-4']).toBe('oklch(.28 .006 260)');
    expect(c['border-1']).toBe('oklch(1 0 0 / .06)');
    expect(c['border-3']).toBe('oklch(1 0 0 / .18)');
    expect(c['text-1']).toMatch(/^oklch\(\.95 /);
    expect(c['text-2']).toMatch(/^oklch\(\.72 /);
    expect(c['accent']).toBe('oklch(.7 .15 275)');
    for (const s of ['ok', 'warn', 'error', 'info', 'paused']) expect(c[`status-${s}`]).toBeTruthy();
  });

  it('higher contrast spreads text and borders', () => {
    const hi = colorTokens({ ...DARK, contrast: 1.5 });
    expect(hi['text-2']).not.toBe(colorTokens(DARK)['text-2']);
    expect(hi['border-1']).toBe('oklch(1 0 0 / .09)');
  });

  it('keeps every motion duration at or under 300ms and spacing on the 4px grid', () => {
    for (const [k, v] of Object.entries(STATIC_TOKENS)) {
      if (k.startsWith('dur-')) expect(parseInt(v, 10)).toBeLessThanOrEqual(300);
      if (k.startsWith('space-')) expect(parseInt(v, 10) % 4).toBe(0);
    }
  });

  it('turns movement off when reduced motion is asked for', () => {
    expect(tokensCss()).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n {2}:root \{\n {4}--motion-shift: 0px;/);
  });
});
