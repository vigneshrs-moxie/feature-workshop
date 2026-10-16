// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_IDS } from './theme';

const file = (name: string) => fileURLToPath(new URL(`./themes/${name}`, import.meta.url));

describe('theme files', () => {
  it('every registered theme has its own CSS file, scoped to html[data-theme="<id>"]', () => {
    for (const id of THEME_IDS) {
      const path = file(`${id}.css`);
      expect(existsSync(path), `${id}.css is missing`).toBe(true);
      const css = readFileSync(path, 'utf8');
      expect(css, `${id}.css must scope under html[data-theme="${id}"]`).toContain(`html[data-theme="${id}"]`);
      // Nothing leaks: every rule is under the theme's own scope (a themed file may not style :root or body bare).
      const bare = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/^\s*(:root|html|body)\s*\{/m);
      expect(bare, `${id}.css styles ${bare?.[1]} without a theme scope`).toBeNull();
    }
  });

  it('themes/index.css loads every theme file', () => {
    const index = readFileSync(file('index.css'), 'utf8');
    for (const id of THEME_IDS) expect(index).toContain(`@import './${id}.css';`);
  });

  it('main.tsx loads the themes after app.css and sets the theme before the first render', () => {
    const main = readFileSync(fileURLToPath(new URL('../main.tsx', import.meta.url)), 'utf8');
    expect(main.indexOf("import './theme/themes/index.css'")).toBeGreaterThan(main.indexOf("import './app/app.css'"));
    expect(main.indexOf('initTheme()')).toBeLessThan(main.indexOf('createRoot('));
  });
});
