// The classic view's theme sheet (classicSheet.ts, written to dist/theme.css by vite.config.ts): it
// keeps what styles the page itself and drops the new view's component hooks.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classicThemeCss } from './classicSheet';
import { THEMES } from './theme';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('classicThemeCss', () => {
  it('keeps tokens, page backgrounds and fonts; drops component hooks and comments', () => {
    const css = classicThemeCss([{
      name: 'x.css',
      css: `/* note */
        @font-face { font-family: 'P'; src: url('/fonts/P.ttf') format('truetype'); }
        html[data-theme="x"] { --bg-0: red; }
        html[data-theme="x"] body { background: var(--bg-0); }
        html[data-theme="x"] .composer { color: blue; }
        html[data-theme="x"] .btn, html[data-theme="x"] { color: green; }
        @media (prefers-reduced-motion: reduce) { html[data-theme="x"] .row { animation: none; } }
        @media (prefers-color-scheme: dark) { :root { --bg-1: black; } }`,
    }]);
    expect(css).toContain('--bg-0: red');
    expect(css).toContain('html[data-theme="x"] body');
    expect(css).toContain("url('/next/fonts/P.ttf')");
    expect(css).toContain('--bg-1: black');
    expect(css).not.toMatch(/composer|\.btn|\.row|note|reduced-motion/);
  });

  it('keeps the text size rules (html[data-text]), which set --ui-scale for the classic page too', () => {
    const css = classicThemeCss([{ name: 't.css', css: 'html[data-text="xl"] { --ui-scale: 1.25; }\nhtml[data-text="xl"] .btn { color: red; }' }]);
    expect(css).toContain('html[data-text="xl"] { --ui-scale: 1.25; }');
    expect(css).not.toContain('.btn');
    const real = classicThemeCss([{ name: 'tokens.css', css: read('./tokens.css') }]);
    for (const size of ['s', 'm', 'l', 'xl']) expect(real).toContain(`html[data-text="${size}"]`);
    expect(real).toContain('--text-base: calc(13px * var(--ui-scale, 1));');
    expect(real).toContain('--row-h: calc(32px * var(--ui-scale, 1));');
  });

  it('builds from the real theme files with every theme in it', () => {
    const themes = [...read('./themes/index.css').matchAll(/@import\s+'\.\/([\w-]+\.css)'/g)].map((m) => m[1]);
    const css = classicThemeCss([{ name: 'tokens.css', css: read('./tokens.css') }, ...themes.map((f) => ({ name: f, css: read(`./themes/${f}`) }))]);
    for (const t of THEMES.filter((x) => x.id !== 'default')) expect(css, t.id).toContain(`html[data-theme="${t.id}"]`);
    expect(css).toContain('--crew-c-amber');
    expect(css).not.toMatch(/\.job-row|\.composer|\.trail-/);
  });
});
