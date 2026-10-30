// @vitest-environment node
// Every token the app reads is set in every theme (packet X): by the theme itself, or by a fallback
// in tokens.css (:root, which every theme inherits), or locally by the component that reads it
// (an element's own custom property, like --job-hue). A token read but set nowhere would draw
// nothing in some theme: an invisible mark, a transparent menu. This lists them, theme by theme.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_IDS } from './theme';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const THEMES_DIR = path.join(SRC, 'theme', 'themes');
const uncommented = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** App code: every stylesheet and script outside the theme files, the generated sheets and the tests. */
const APP_FILES = walk(SRC).filter((f) => /\.(css|tsx?)$/.test(f)
  && !f.startsWith(THEMES_DIR)
  && !/\.test\.tsx?$/.test(f)
  && !f.endsWith('swatches.css')
  && !f.endsWith(path.join('theme', 'tokens.css')));

/** Every token tokens.css declares (to expand names built in a template). */
const KNOWN = [...uncommented(readFileSync(path.join(SRC, 'theme', 'tokens.css'), 'utf8')).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);

/** The tokens the app reads: var(--x) without a fallback of its own, and the names it reads from script. */
export function tokensRead(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const note = (t: string, f: string) => { if (!out.has(t)) out.set(t, new Set()); out.get(t)!.add(path.relative(SRC, f)); };
  for (const f of APP_FILES) {
    const text = uncommented(readFileSync(f, 'utf8'));
    // var(--x) and var(--x, fallback): only the first has no fallback of its own.
    for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) if (m[2] === ')') note(m[1], f);
    // getPropertyValue('--x') and the floor's token lists: a quoted '--x' in a script.
    if (/\.tsx?$/.test(f)) for (const m of text.matchAll(/['"](--[a-z][\w-]*)['"]/g)) note(m[1], f);
    // A name built in a template, var(--chart-${n}): every token with that start that tokens.css knows.
    for (const m of text.matchAll(/var\(\s*(--[\w-]*-)\$\{/g)) for (const t of KNOWN) if (t.startsWith(m[1])) note(t, f);
  }
  return out;
}

/** The custom properties set by app code itself (a component's own --x, set in its CSS or its style). */
function setLocally(): Set<string> {
  const out = new Set<string>();
  for (const f of APP_FILES) {
    const text = uncommented(readFileSync(f, 'utf8'));
    for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) out.add(m[1]);
    for (const m of text.matchAll(/['"](--[\w-]+)['"]\s*[:,]/g)) out.add(m[1]);
  }
  return out;
}

/** What a stylesheet sets: every custom property declared in it. */
const declared = (css: string) => new Set([...uncommented(css).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

describe('token coverage', () => {
  const read = tokensRead();
  const local = setLocally();
  const tokensCss = readFileSync(path.join(SRC, 'theme', 'tokens.css'), 'utf8');
  // The fallbacks: the :root block (every theme inherits it), not the text-size blocks.
  const rootBlock = /:root[^{]*\{([^}]*)\}/.exec(tokensCss)?.[1] ?? '';
  const fallback = declared(rootBlock);

  it('finds the tokens the app reads (a sanity check on the scan)', () => {
    for (const t of ['--surface-1', '--text-1', '--status-ok', '--stop-build', '--focus-ring', '--needs-solid']) expect(read.has(t), t).toBe(true);
    expect(read.size).toBeGreaterThan(150);
  });

  it('every theme sets every token the app reads, or tokens.css gives it a fallback', () => {
    const problems: string[] = [];
    for (const id of THEME_IDS) {
      const own = declared(readFileSync(path.join(THEMES_DIR, `${id}.css`), 'utf8'));
      const missing = [...read.keys()].filter((t) => !own.has(t) && !fallback.has(t) && !local.has(t));
      for (const t of missing) problems.push(`${id}: ${t} (read in ${[...read.get(t)!].slice(0, 2).join(', ')})`);
    }
    expect(problems, `tokens read but set nowhere:\n${problems.join('\n')}`).toEqual([]);
  });
});

// ---------- Tokens that must be solid ----------

/** A theme's custom properties: tokens.css's :root, then the theme file's own (later wins). */
function themeTokens(id: string): Map<string, string> {
  const map = new Map<string, string>();
  const tokensCss = uncommented(readFileSync(path.join(SRC, 'theme', 'tokens.css'), 'utf8'));
  const root = /:root[^{]*\{([^}]*)\}/.exec(tokensCss)?.[1] ?? '';
  for (const m of root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  const css = uncommented(readFileSync(path.join(THEMES_DIR, `${id}.css`), 'utf8'));
  // Only the theme's token blocks (html[data-theme="<id>"] { … } with no descendant selector).
  for (const block of css.matchAll(new RegExp(`html\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`, 'g'))) {
    for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  }
  return map;
}

/** A token's value with every plain var(--x) (the whole value) followed; null if it can't be followed. */
function resolve(map: Map<string, string>, name: string, depth = 0): string | null {
  const v = map.get(name);
  if (v === undefined || depth > 12) return null;
  const only = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
  return only ? resolve(map, only[1], depth + 1) : v;
}

/** The alpha a colour is written with: 1 unless it says "/ a" (or is transparent). */
function alphaOf(v: string): number {
  if (/^transparent$/i.test(v)) return 0;
  const m = /\/\s*([\d.]+)(%?)\s*\)\s*$/.exec(v);
  if (!m) return 1;
  return m[2] ? Number(m[1]) / 100 : Number(m[1]);
}

/**
 * Paints that must hide what is under them: what floats over the page, the tooltip and its words,
 * the ink on the needs-you dot and on the primary button. A see-through one lets the aurora or the
 * page's words show through (packet X found Glass's menus at 5%).
 */
export const SOLID_TOKENS = ['--surface-float', '--tooltip-bg', '--tooltip-fg', '--on-needs', '--btn-primary-fg', '--on-accent', '--needs-solid'];

describe('solid tokens', () => {
  it('every theme paints its floating surfaces, tooltip and ink on fills at 90% or more', () => {
    const problems: string[] = [];
    for (const id of THEME_IDS) {
      const map = themeTokens(id);
      for (const t of SOLID_TOKENS) {
        const v = resolve(map, t);
        if (v === null) { problems.push(`${id}: ${t} can't be followed (${map.get(t)})`); continue; }
        if (/var\(/.test(v)) continue; // a mix of tokens: the browser sweep measures it
        const a = alphaOf(v);
        if (a < 0.9) problems.push(`${id}: ${t} is ${v} (${Math.round(a * 100)}% opaque)`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
