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

  it('puts the mark on the browser tab, on the laptop and on the site', () => {
    expect(read('../../index.html')).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(read('../../index.html')).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(read('../../../dashboard/public/index.html')).toContain('<link rel="icon" href="favicon.svg"');
    // The tab's picture is the top bar's mark: the radar, on the Light theme's accent.
    const mark = read('../../public/favicon.svg');
    expect(mark).toContain('fill="#594ddc"');
    expect(mark).toContain('<path d="m13.41 10.59 5.66-5.66"/>');
    expect(read('../../../dashboard/public/favicon.svg')).toBe(mark);
  });

  it('names a page for the browser tab', () => {
    expect(pageTitle('Jobs')).toBe(`Jobs · ${BRAND.name}`);
    expect(pageTitle()).toBe(BRAND.name);
  });

  it('is spelled only in brand.ts; the old names are gone from the app', () => {
    const src = path.resolve(here, '..');
    for (const file of sources(src)) {
      // Code only: comments may say what a line is about.
      // The token header's name (X-Starbase-Token) is part of the protocol, not the name a person reads.
      const code = readFileSync(file, 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '').replace(/X-Starbase-Token/g, '');
      if (!file.endsWith(`${path.sep}brand.ts`)) expect(code.includes(BRAND.name), file).toBe(false);
      expect(/Feature Workshop|Ground Control/.test(code), file).toBe(false); // the old names
    }
  });
});
