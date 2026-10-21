// @vitest-environment node
// The classic page (dashboard/public) keeps hand-written copies of the theme lists, the dark/light
// pairs and the text sizes, in ui.js (for app.js) and theme-boot.js (run before the page draws). They
// must agree with theme.ts and textSize.ts, or a theme picked here is lost there.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEXT_SIZES } from './textSize';
import { HIDDEN_THEME_IDS, ORIGINAL_THEME_IDS, THEME_PAIRS, THEMES } from './theme';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../dashboard/public/${rel}`, import.meta.url)), 'utf8');
const list = (src: string, name: string): string[] => {
  const m = new RegExp(`${name} = \\[([^\\]]*)\\]`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
};
const pairs = (src: string, name: string): string[][] => {
  const m = new RegExp(`${name} = \\[((?:\\s*\\[[^\\]]*\\],?)*)\\s*\\]`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return [...m[1].matchAll(/\[([^\]]*)\]/g)].map((p) => p[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')));
};

describe('the classic page’s copies of the theme lists', () => {
  const ui = read('ui.js');
  const boot = read('theme-boot.js');

  it('ui.js lists every theme, the hidden ones apart, the same pairs and the same text sizes', () => {
    expect(list(ui, 'export const THEMES')).toEqual([...ORIGINAL_THEME_IDS]);
    expect(list(ui, 'export const HIDDEN_THEMES')).toEqual([...HIDDEN_THEME_IDS]);
    expect(pairs(ui, 'export const THEME_PAIRS')).toEqual(THEME_PAIRS.map((p) => [...p]));
    expect(list(ui, 'export const TEXT_SIZES')).toEqual([...TEXT_SIZES]);
    for (const t of THEMES) expect(ui, t.id).toContain(`'${t.id}'`);
  });

  it('theme-boot.js has the same lists, so the first paint is already right', () => {
    expect(list(boot, 'var THEMES')).toEqual([...ORIGINAL_THEME_IDS]);
    expect(pairs(boot, 'var PAIRS')).toEqual(THEME_PAIRS.map((p) => [...p]));
    expect(list(boot, 'var TEXT_SIZES')).toEqual([...TEXT_SIZES]);
    expect(boot).toContain("'workshop.textSize'");
    expect(boot).toContain("'workshop.themeFollow'");
    expect(boot).toContain("setAttribute('data-text'");
  });

  it('every pair is a dark theme and a light one, both registered and not hidden', () => {
    for (const [dark, light] of THEME_PAIRS) {
      expect(THEMES.find((t) => t.id === dark)?.scheme, dark).toBe('dark');
      expect(THEMES.find((t) => t.id === light)?.scheme, light).toBe('light');
      expect(ORIGINAL_THEME_IDS).toContain(dark);
      expect(ORIGINAL_THEME_IDS).toContain(light);
    }
  });
});
