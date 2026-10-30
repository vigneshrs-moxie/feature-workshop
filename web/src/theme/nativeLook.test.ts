// @vitest-environment node
// No browser or Mac look anywhere (packet R), read from the files themselves. Fails if any comes back:
//   - a native select, datalist, number, date, time, colour, range or file input (the app draws its
//     own: components/Select.tsx, Field.tsx NumberInput); radios and checkboxes go through Choice
//     (theme/controlRules.test.ts);
//   - an SVG <title> (the browser shows it as a tooltip; use data-tip and aria-label);
//   - text arrows standing in for a fold's marker (▸ ▾ ▴): the app's chevron icon instead;
//   - the browser's own fold triangle, a text area's resize grip, the search field's clear button,
//     wide grey scrollbars and the browser's autofill colours (components/controls.css hides or
//     restyles each);
//   - the browser's tooltip: the app mounts its one TooltipLayer (components/Tooltip.tsx) that draws
//     every title in the app's look (components/Tooltip.test.tsx checks how).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));
function files(dir: string, test: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, test);
    return test(name) ? [path] : [];
  });
}
const rel = (p: string) => relative(SRC, p).split('\\').join('/');
const CODE = files(SRC, (n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) && n !== 'vite-env.d.ts').map((p) => ({ name: rel(p), text: readFileSync(p, 'utf8') }));
const CSS = files(SRC, (n) => n.endsWith('.css')).map((p) => ({ name: rel(p), text: readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));
const CONTROLS = readFileSync(join(SRC, 'components/controls.css'), 'utf8');
/** Code with its comments taken out, so a comment may still name what it replaced. */
const bare = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('no browser or Mac look', () => {
  it('no native select, datalist, or number, date, time, colour, range or file input', () => {
    const NATIVE = /<select[\s>]|<datalist[\s>]|<input\b[^>]*?type=["'](number|date|time|datetime-local|month|week|color|range|file)["']/;
    expect(CODE.filter((f) => f.name !== 'components/Select.tsx' && NATIVE.test(bare(f.text))).map((f) => f.name)).toEqual([]);
  });

  it('no SVG <title> (the browser would show it as a tooltip)', () => {
    expect(CODE.filter((f) => /<title>/.test(bare(f.text))).map((f) => f.name)).toEqual([]);
  });

  it('no text arrows for a fold’s marker: the app’s chevron', () => {
    expect(CODE.filter((f) => /[▸▾▴▹▿]/.test(bare(f.text))).map((f) => f.name)).toEqual([]);
    expect(CSS.filter((f) => /content:\s*['"][^'"]*[▸▾▴]/.test(f.text)).map((f) => f.name)).toEqual([]);
  });

  it('no text area can be resized by a corner grip', () => {
    const grips = CSS.flatMap((f) => [...f.text.matchAll(/resize:\s*(\w+)/g)].filter((m) => m[1] !== 'none').map(() => f.name));
    expect(grips).toEqual([]);
    expect(CONTROLS).toMatch(/textarea\s*\{\s*resize:\s*none;/);
  });

  it('the shared stylesheet hides the fold triangle and the search clear button, and themes scrollbars and autofill', () => {
    expect(CONTROLS).toMatch(/summary::-webkit-details-marker\s*\{\s*display:\s*none;/);
    expect(CONTROLS).toMatch(/summary\s*\{\s*list-style:\s*none;/);
    expect(CONTROLS).toMatch(/-webkit-search-cancel-button/);
    expect(CONTROLS).toMatch(/scrollbar-width:\s*thin;/);
    expect(CONTROLS).toMatch(/input:-webkit-autofill/);
  });

  it('the app mounts its one tooltip layer', () => {
    const app = CODE.find((f) => f.name === 'app/App.tsx')!.text;
    expect(app).toMatch(/<TooltipLayer \/>/);
  });
});
