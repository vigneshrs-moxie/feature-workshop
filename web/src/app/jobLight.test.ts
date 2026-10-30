// @vitest-environment node
// A job card's light that is off is still a mark you can see (packet W, fix 2): it measured 1.6:1
// in Light and 2.3:1 in Default on --border-3. It takes R's quiet mark, the colour the empty
// checkbox edge measures 3.6:1 and 3.9:1 with (components/controls.css) and a stack card's light uses.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const QUIET = /border:\s*1px solid (color-mix\(in oklab, var\(--text-3\) 80%, var\(--surface-1\)\))/;

describe('.job-light', () => {
  it('is drawn in the quiet mark when off, the same colour as the empty checkbox edge', () => {
    const quiet = QUIET.exec(read('../components/controls.css'))?.[1];
    expect(quiet).toBeTruthy();
    const rule = /\.job-light\s*\{([^}]*)\}/.exec(read('./pages.css'))?.[1] ?? '';
    expect(rule).toContain(`background: ${quiet}`);
    expect(rule).not.toMatch(/--border-\d/);
  });
});
