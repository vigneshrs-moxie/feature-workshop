// @vitest-environment node
// The Glass theme's blur: what jsdom can't check. A backdrop-filter makes its element the box that
// position:fixed children are placed in, so it may only go where nothing can hold a sheet (the
// composer's Send preview is a fixed sheet inside the composer). And it must survive the build's
// minifier (lightningcss), which drops an unprefixed backdrop-filter written before a -webkit- one.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transform } from 'lightningcss';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./themes/glass.css', import.meta.url)), 'utf8');
const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
const scope = 'html[data-theme="glass"] ';

/** Every selector of a rule that sets backdrop-filter. */
function blurred(text: string): string[] {
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /(^|[;\s])backdrop-filter\s*:/.test(m[2]))
    .flatMap((m) => m[1].split(',').map((s) => s.trim().replace(scope, '')));
}

describe('glass.css blur', () => {
  it('blurs only the backdrops, the toasts and the composer’s ::before, never a box that can hold a sheet', () => {
    expect(blurred(uncommented).sort()).toEqual(['.composer::before', '.drawer-backdrop', '.play-toast', '.sheet-backdrop', '.toast'].sort());
  });

  it('writes only the unprefixed property (the build adds -webkit-)', () => {
    expect(uncommented).not.toContain('-webkit-backdrop-filter');
  });

  it('keeps the unprefixed blur through the build’s minifier, for Chrome and Safari alike', () => {
    const { code } = transform({
      filename: 'glass.css',
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
