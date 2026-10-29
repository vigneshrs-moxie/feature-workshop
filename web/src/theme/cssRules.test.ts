// @vitest-environment node
// The stylesheets' quality bar (packet M, plan §7), read from the files themselves:
//   - no literal colour outside the theme files (tokens.css, swatches.css, themes/*.css): every
//     colour is a token, so a theme changes it everywhere;
//   - no transition longer than 200 ms;
//   - nothing you click is shorter than 40 px (var(--control-h) or more).
// Telemetry.css too, since packet P moved it to the --chart-* tokens.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const THEME_FILES = /^theme\/(tokens\.css|swatches\.css|themes\/)/;

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

const ALL = cssFiles(SRC).map((path) => ({ name: relative(SRC, path).split('\\').join('/'), css: readFileSync(path, 'utf8') }));
const APP = ALL.filter((f) => !THEME_FILES.test(f.name));

interface Decl { file: string; selector: string; prop: string; value: string }

/** Every declaration in a stylesheet, with the selector of the rule it sits in (inside @media too). */
function declarations(file: string, css: string): Decl[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((m) => {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    return m[2].split(';').flatMap((d) => {
      const i = d.indexOf(':');
      if (i < 0) return [];
      return [{ file, selector, prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() }];
    });
  });
}

const DECLS = APP.flatMap((f) => declarations(f.name, f.css));
const at = (d: Decl) => `${d.file}: ${d.selector} { ${d.prop}: ${d.value} }`;

/** A colour written out: hex, a colour function on numbers, or a colour name. var(--…) names don't count. */
export function literalColour(value: string): boolean {
  const v = value.replace(/var\(--[\w-]+/g, 'var(');
  return /#[0-9a-f]{3,8}\b/i.test(v)
    || /\b(rgba?|hsla?|hwb|lab|lch|oklab)\(/i.test(v)
    || /\boklch\((?!\s*var\()/i.test(v)
    || /(^|[\s,(])(white|black|red|green|blue|gr[ae]y|orange|yellow|purple|pink|silver|gold|navy|teal)\b/i.test(v);
}

/** The durations in a transition value, in ms. */
export function durations(value: string): number[] {
  return [...value.matchAll(/(?:^|[\s,])(\d*\.?\d+)(ms|s)\b/g)].map((m) => (m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1])));
}

/** Selectors for things you click: buttons, links styled as buttons, folds, selects, tabs, chips, options. */
const CLICKABLE = /(^|[\s,.#:[(>+~-])(btn|button|summary|select|tab|chip|toggle|option|menu-item|seg)([\s,.:#[)>+~-]|$)/i;

describe('the stylesheets', () => {
  it('reads the app’s stylesheets, Telemetry’s too (and leaves the theme files out)', () => {
    const names = APP.map((f) => f.name);
    for (const want of ['app/app.css', 'app/shell.css', 'app/pages.css', 'home/home.css', 'job/job.css', 'play/play.css', 'views/Telemetry.css']) expect(names).toContain(want);
    expect(names.some((n) => THEME_FILES.test(n))).toBe(false);
    expect(DECLS.length).toBeGreaterThan(500);
  });

  it('no literal colour outside the theme files: every colour is a token', () => {
    expect(literalColour('#fff')).toBe(true);
    expect(literalColour('0 6px 24px rgb(0 0 0 / .12)')).toBe(true);
    expect(literalColour('oklch(0 0 0 / .5)')).toBe(true);
    expect(literalColour('1px solid white')).toBe(true);
    expect(literalColour('oklch(var(--job-hue-l) var(--job-hue-c) var(--job-hue, 0))')).toBe(false);
    expect(literalColour('var(--crew-gold)')).toBe(false);
    expect(literalColour('color-mix(in srgb, var(--bg-0) 55%, transparent)')).toBe(false);
    expect(DECLS.filter((d) => literalColour(d.value)).map(at)).toEqual([]);
  });

  it('no transition takes longer than 200 ms', () => {
    expect(durations('transform .45s ease, color 120ms')).toEqual([450, 120]);
    const slow = DECLS.filter((d) => /^transition(-duration)?$/.test(d.prop) && durations(d.value).some((ms) => ms > 200));
    expect(slow.map(at)).toEqual([]);
  });

  it('nothing you click is shorter than 40 px', () => {
    const short = DECLS.filter((d) => /^(min-)?height$/.test(d.prop) && CLICKABLE.test(d.selector)).filter((d) => {
      const px = /^(\d+(?:\.\d+)?)px$/.exec(d.value);
      return px && Number(px[1]) < 40 && !/input\[type='radio'\]|sr-only/.test(d.selector);
    });
    expect(short.map(at)).toEqual([]);
  });

  it('every token the app’s stylesheets use is defined: in tokens.css, a theme, a stylesheet or a style the code sets', () => {
    const defined = new Set(ALL.flatMap((f) => [...f.css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])));
    const code = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return code(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [readFileSync(path, 'utf8')] : [];
    });
    for (const text of code(SRC)) for (const m of text.matchAll(/['"`](--[\w-]+)/g)) defined.add(m[1]);
    const unknown = APP.flatMap((f) => [...f.css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/var\((--[\w-]+)\s*\)/g)]
      .filter((m) => !defined.has(m[1])).map((m) => `${f.name}: ${m[1]}`));
    expect([...new Set(unknown)]).toEqual([]);
  });

  it('the control height token is 40 px at the least, at every text size', () => {
    const tokens = ALL.find((f) => f.name === 'theme/tokens.css')!.css;
    expect(tokens).toMatch(/--control-h:\s*max\(40px,/);
  });
});
