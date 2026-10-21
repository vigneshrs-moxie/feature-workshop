// @vitest-environment node
// The picker's swatches (swatchSheet.ts → swatches.css): every theme's tokens re-scoped onto
// .theme-swatch[data-theme="<id>"], so a swatch wears its own theme on any page.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SWATCH_SELECTOR, swatchCss } from './swatchSheet';
import { THEMES } from './theme';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const themeFiles = () => [...read('./themes/index.css').matchAll(/@import\s+'\.\/([\w-]+\.css)'/g)].map((m) => ({ name: `themes/${m[1]}`, css: read(`./themes/${m[1]}`) }));

describe('swatchCss', () => {
  it('re-scopes a theme’s custom properties and page background to its swatch, and nothing else', () => {
    const css = swatchCss([{
      name: 'x.css',
      css: `html[data-theme="x"] { color-scheme: light; --bg-0: red; --text-1: blue; }
        html[data-theme="x"] body { background-color: var(--bg-0); background-image: url(a.png); background-attachment: fixed; color: red; }
        html[data-theme="x"] .composer { --bg-0: green; color: blue; }
        html[data-theme="x"] .btn, html[data-theme="x"] { --bg-4: pink; }
        @media (prefers-reduced-motion: reduce) { html[data-theme="x"] { --motion-shift: 0; } }`,
    }]);
    expect(css).toContain('.theme-swatch[data-theme="x"] {\n  --bg-0: red;\n  --text-1: blue;\n  background-color: var(--bg-0);\n  background-image: url(a.png);\n}');
    expect(css).not.toMatch(/color-scheme|green|pink|attachment|motion-shift|composer/);
  });

  it('the committed swatches.css matches the theme files (run `npm run web:build` to regenerate)', () => {
    expect(read('./swatches.css')).toBe(swatchCss(themeFiles()));
  });

  it('gives every registered theme a swatch with its own palette; the Default’s comes from tokens.ts', () => {
    const css = swatchCss(themeFiles());
    for (const t of THEMES) {
      const block = new RegExp(`${SWATCH_SELECTOR(t.id).replace(/[.[\]"]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      expect(block, `${t.id} has a swatch`).not.toBe('');
      for (const token of ['--bg-0', '--bg-1', '--bg-2', '--text-1', '--text-3', '--accent', '--group-needs-you-fg', '--group-running-fg', '--group-done-fg']) {
        expect(block, `${t.id} swatch sets ${token}`).toContain(`${token}:`);
      }
    }
    // The two Glass themes paint their aurora on the swatch itself.
    for (const id of ['glass', 'light-glass']) expect(css).toMatch(new RegExp(`${SWATCH_SELECTOR(id).replace(/[.[\]"]/g, '\\$&')} \\{[^}]*background-image: var\\(--glass-aurora\\)`));
  });
});
