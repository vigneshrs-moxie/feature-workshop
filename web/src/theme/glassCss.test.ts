// @vitest-environment node
// The Glass theme's blur: what jsdom can't check. A backdrop-filter makes its element the box that
// position:fixed children are placed in, so it may only go where nothing can hold a sheet (the
// composer's Send preview is a fixed sheet inside the composer). And it must survive the build's
// minifier (lightningcss), which drops an unprefixed backdrop-filter written before a -webkit- one.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transform } from 'lightningcss';
import { describe, expect, it } from 'vitest';

const read = (id: string) => readFileSync(fileURLToPath(new URL(`./themes/${id}.css`, import.meta.url)), 'utf8');
const uncomment = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every selector of a rule that sets backdrop-filter. */
function blurred(text: string, scope: string): string[] {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /(^|[;\s])backdrop-filter\s*:/.test(m[2]))
    .flatMap((m) => m[1].split(',').map((s) => s.trim().replace(scope, '')));
}

/** Every selector of every rule outside @media, without the theme scope. */
function hooks(text: string, scope: string): string[] {
  const flat = text.replace(/@media[^{]*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g, '');
  return [...flat.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().replace(scope.trim(), '').trim())).filter(Boolean);
}

describe.each(['glass', 'light-glass'])('%s.css blur', (id) => {
  const css = read(id);
  const uncommented = uncomment(css);
  const scope = `html[data-theme="${id}"] `;

  it('blurs only the backdrops, the toasts and the composer’s ::before, never a box that can hold a sheet', () => {
    expect(blurred(uncommented, scope).sort()).toEqual(['.composer::before', '.drawer-backdrop', '.play-toast', '.sheet-backdrop', '.toast'].sort());
  });

  it('writes only the unprefixed property (the build adds -webkit-)', () => {
    expect(uncommented).not.toContain('-webkit-backdrop-filter');
  });

  it('keeps the unprefixed blur through the build’s minifier, for Chrome and Safari alike', () => {
    const { code } = transform({
      filename: `${id}.css`,
      code: Buffer.from(css),
      minify: true,
      // Chrome 120 and Safari 16, as lightningcss encodes versions (major << 16).
      targets: { chrome: 120 << 16, safari: 16 << 16 },
    });
    const out = code.toString();
    expect(out).toMatch(/[;{]backdrop-filter:/);
    expect(out).toContain('-webkit-backdrop-filter');
  });
});

describe('light-glass.css mirrors glass.css', () => {
  it('styles every hook Glass styles (and no other), sets the same --glass-* tokens, and is light', () => {
    const glass = uncomment(read('glass'));
    const light = uncomment(read('light-glass'));
    expect(new Set(hooks(light, 'html[data-theme="light-glass"] '))).toEqual(new Set(hooks(glass, 'html[data-theme="glass"] ')));
    for (const token of ['--glass-float', '--glass-pane', '--glass-pane-side', '--glass-aurora', '--glass-edge', '--glass-edge-bright', '--glass-highlight', '--glass-blur', '--glass-blur-strong', '--glass-gradient']) {
      expect(light, token).toContain(`${token}:`);
    }
    expect(light).toContain('color-scheme: light;');
    expect(glass).toContain('color-scheme: dark;');
    // Every floating surface takes --glass-float in both.
    for (const css of [glass, light]) {
      for (const hook of ['.sheet', '.palette', '.drawer', '.toast', '.drawer-foot', '.home-head', '.play-toast']) expect(css, hook).toContain(hook);
      expect(css.match(/var\(--glass-float\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    }
  });
});
