// @vitest-environment node
// The app's CSS is one stylesheet in one order, though each page's code is a chunk of its own
// (app/pages.tsx): main.tsx imports every stylesheet a source file imports, so its order is the
// order (a page loaded later never moves its rules after the theme's), and the build keeps every
// CSS module in one chunk (vite.config.ts, codeSplitting group "styles").
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const cssImports = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/^import\s+['"]([^'"]+\.css)['"];?$/gm)].map((m) => path.resolve(path.dirname(file), m[1]));

describe('the stylesheet order', () => {
  it('main.tsx imports every stylesheet any source file imports', () => {
    const main = new Set(cssImports(path.join(src, 'main.tsx')));
    const missing = sources(src).flatMap((f) => cssImports(f).filter((c) => !main.has(c)).map((c) => `${path.relative(src, c)} (from ${path.relative(src, f)})`));
    expect(missing).toEqual([]);
  });

  it('the build keeps the CSS in one chunk', () => {
    const config = readFileSync(path.join(src, '../vite.config.ts'), 'utf8');
    expect(config).toMatch(/codeSplitting: \{ groups: \[\{ name: 'styles', test: \/\\\.css\$\/ \}\] \}/);
  });
});
