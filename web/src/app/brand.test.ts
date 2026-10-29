// The product's name comes from one place (brand.ts). Both index.html files carry it in their
// titles, and no other source file spells the old name or the new one.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND, pageTitle } from './brand';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(here, rel), 'utf8');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe('the product name', () => {
  it('is in both index.html files', () => {
    expect(read('../../index.html')).toContain(`<title>${BRAND.name}</title>`);
    expect(read('../../../dashboard/public/index.html')).toContain(`<title>${BRAND.name} · `);
  });

  it('names a page for the browser tab', () => {
    expect(pageTitle('Jobs')).toBe(`Jobs · ${BRAND.name}`);
    expect(pageTitle()).toBe(BRAND.name);
  });

  it('is spelled only in brand.ts; the old name is gone from the app', () => {
    const src = path.resolve(here, '..');
    for (const file of sources(src)) {
      // Code only: comments may say what a line is about.
      const code = readFileSync(file, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
      if (!file.endsWith(`${path.sep}brand.ts`)) expect(code.includes(BRAND.name), file).toBe(false);
      expect(/Feature Workshop/.test(code), file).toBe(false);
    }
  });
});
