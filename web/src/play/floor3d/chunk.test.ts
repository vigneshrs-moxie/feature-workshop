// three.js must stay in its own lazy chunk: only scene/ imports it, and the scene is only ever
// reached through loadScene()'s import(), so Play subtle and Play off never load any 3D.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?)$/.test(name) ? [p] : [];
  });
}
const code = files(SRC).filter((f) => !/\.test\.tsx?$/.test(f)).map((f) => ({ file: relative(SRC, f).replaceAll('\\', '/'), text: readFileSync(f, 'utf8') }));

describe('the three.js chunk', () => {
  it('is imported only by the scene', () => {
    const importers = code.filter((c) => /from\s+['"]three(\/[^'"]*)?['"]|import\(\s*['"]three/.test(c.text)).map((c) => c.file);
    expect(importers.length).toBeGreaterThan(0);
    for (const f of importers) expect(f.startsWith('play/floor3d/scene/')).toBe(true);
  });

  it('is reached only through loadScene’s import()', () => {
    const reach = code.filter((c) => !c.file.startsWith('play/floor3d/scene/') && /['"]\.\/scene(\/index)?['"]|['"][./]*floor3d\/scene/.test(c.text));
    expect(reach.map((c) => c.file)).toEqual(['play/floor3d/loadScene.ts']);
    const loader = reach[0].text;
    expect(loader).toMatch(/import\(\s*['"]\.\/scene\/index['"]\s*\)/);
    // A type-only static import is fine (erased); a value import is not.
    expect(loader).not.toMatch(/^import\s+(?!type)[^;]*['"]\.\/scene/m);
  });
});
