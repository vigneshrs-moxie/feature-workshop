// @vitest-environment node
// The easter eggs' stylesheet: what jsdom can't check. Loaded by the page, every motion under
// 1.5 s, nothing moving under reduced motion, and theme tokens only.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./eggs.css', import.meta.url)), 'utf8');
const main = readFileSync(fileURLToPath(new URL('../main.tsx', import.meta.url)), 'utf8');
const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('eggs.css', () => {
  it('is loaded by the page', () => {
    expect(main).toContain("import './play/eggs.css';");
  });

  it('keeps every animation under 1.5 s', () => {
    const times = [...uncommented.matchAll(/animation:\s*[\w-]+\s+([\d.]+)(m?s)/g)].map(([, n, unit]) => Number(n) * (unit === 's' ? 1000 : 1));
    expect(times.length).toBeGreaterThan(0);
    for (const t of times) expect(t).toBeLessThan(1500);
  });

  it('ends every staggered motion within 1.5 s, its delay included', () => {
    const delays = [...uncommented.matchAll(/([^{}]+)\{[^}]*animation-delay:\s*(\d+)ms/g)].map(([, sel, ms]) => [sel.trim().split(/\s+/)[0], Number(ms)] as const);
    expect(delays.length).toBeGreaterThan(0);
    for (const [scope, delay] of delays) {
      const rule = new RegExp(`${scope.replace('.', '\\.')}[^{]*\\{[^}]*animation:\\s*egg-[\\w-]+\\s+([\\d.]+)(m?s)`).exec(uncommented);
      expect(rule, scope).not.toBeNull();
      const duration = Number(rule![1]) * (rule![2] === 's' ? 1000 : 1);
      expect(duration + delay, scope).toBeLessThan(1500);
    }
  });

  it('never loops: no infinite animations', () => {
    expect(uncommented).not.toMatch(/infinite/);
  });

  it('holds everything still under reduced motion', () => {
    const animated = [...uncommented.matchAll(/([^{}]+)\{[^}]*animation:\s*egg-/g)].map(([, sel]) => sel.trim());
    const still = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\{\s*animation:\s*none/.exec(uncommented)?.[1] ?? '';
    for (const sel of animated) for (const part of sel.split(',')) expect(still).toContain(part.trim());
  });

  it('uses theme tokens only', () => {
    expect(uncommented).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i);
  });
});
