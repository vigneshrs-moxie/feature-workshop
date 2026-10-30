// @vitest-environment node
// One set of controls (packet R), read from the files themselves:
//   - no stylesheet but components/controls.css (and the theme files, which restyle hooks) draws a
//     button: a rule aimed at .btn elsewhere may place it (flex, margin, width, order…) but never
//     set its colour, edge, height, padding, type or shadow;
//   - every <select> is the shared Select, every radio and checkbox the shared Choice;
//   - the screens packet R moved onto <Button> keep no hand-made "btn" class list.
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

const THEME_FILES = /^theme\/(tokens\.css|swatches\.css|themes\/)/;
const CONTROLS = 'components/controls.css';
const SHEETS = files(SRC, (n) => n.endsWith('.css')).map((p) => ({ name: rel(p), css: readFileSync(p, 'utf8') }))
  .filter((f) => !THEME_FILES.test(f.name) && f.name !== CONTROLS);
const CODE = files(SRC, (n) => /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n)).map((p) => ({ name: rel(p), text: readFileSync(p, 'utf8') }));

/** What a view may set on a button: where it sits, never how it looks. */
const PLACEMENT = /^(display|flex|flex-[\w-]+|order|align-self|justify-self|justify-content|margin(-[\w-]+)?|width|min-width|max-width|grid-[\w-]+|position|inset|top|right|bottom|left|z-index|visibility|white-space|text-align)$/;

/** The rules whose subject (the last compound selector) is a button: .btn or one of its kinds. */
export function buttonRules(css: string): { selector: string; prop: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) => {
    const selectors = m[1].trim().replace(/\s+/g, ' ').split(',').map((s) => s.trim());
    const aimed = selectors.filter((sel) => {
      const subject = sel.split(/\s*[\s>+~]\s*/).pop() ?? '';
      return /\.btn(-(primary|quiet|danger|lg|sm|icon))?(?![\w-])/.test(subject.replace(/:not\([^)]*\)/g, ''));
    });
    if (!aimed.length) return [];
    return m[2].split(';').flatMap((d) => {
      const i = d.indexOf(':');
      if (i < 0) return [];
      const prop = d.slice(0, i).trim();
      return PLACEMENT.test(prop) ? [] : aimed.map((selector) => ({ selector, prop }));
    });
  });
}

describe('one set of controls', () => {
  it('finds a button rule by its subject, and lets a view place a button but not draw one', () => {
    expect(buttonRules('.desk-calls .btn { min-height: 56px; flex: 1; }')).toEqual([{ selector: '.desk-calls .btn', prop: 'min-height' }]);
    expect(buttonRules('.next-actions .btn { flex: 1; }')).toEqual([]);
    expect(buttonRules('.btn-toggle .toggle-state { color: red; }')).toEqual([]);
    expect(buttonRules('.x a.btn:hover { text-decoration: none; }')).toEqual([{ selector: '.x a.btn:hover', prop: 'text-decoration' }]);
    expect(buttonRules('.topbar .btn:not(.btn-primary) { background: none; }')).toEqual([{ selector: '.topbar .btn:not(.btn-primary)', prop: 'background' }]);
  });

  it('no stylesheet but the controls’ own draws a button (themes may restyle the hooks)', () => {
    expect(SHEETS.map((f) => f.name)).toContain('app/app.css');
    expect(SHEETS.map((f) => f.name)).not.toContain(CONTROLS);
    const drawn = SHEETS.flatMap((f) => buttonRules(f.css).map((r) => `${f.name}: ${r.selector} { ${r.prop} }`));
    expect(drawn).toEqual([]);
  });

  it('every select is the shared Select, and every radio and checkbox the shared Choice', () => {
    const selects = CODE.filter((f) => f.name !== 'components/Select.tsx' && /<select[\s>]/.test(f.text)).map((f) => f.name);
    expect(selects).toEqual([]);
    const inputs = CODE.filter((f) => f.name !== 'components/Choice.tsx')
      .filter((f) => [...f.text.matchAll(/<input\b[^>]*?type=["'](radio|checkbox)["']/g)].length > 0).map((f) => f.name);
    expect(inputs).toEqual([]);
  });

  it('the screens moved onto <Button> keep no hand-made button class list', () => {
    // The rest of the app moves in packet R's step 3; until then their .btn classes draw the same.
    const MOVED = ['components/page/Page.tsx', 'app/TopBar.tsx', 'home/JobsPage.tsx', 'home/DeskView.tsx', 'job/JobPage.tsx', 'views/Review/GithubLine.tsx', 'job/StagePage.tsx', 'home/JobPeek.tsx', 'components/More.tsx', 'views/Gallery/GalleryView.tsx', 'views/Telemetry/Card.tsx'];
    const handMade = CODE.filter((f) => MOVED.includes(f.name)).filter((f) => /className=["'{`][^>]*?(?<![\w-])btn(?![\w-])/.test(f.text)).map((f) => f.name);
    expect(handMade).toEqual([]);
  });
});
