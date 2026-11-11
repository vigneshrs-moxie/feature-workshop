// @vitest-environment node
// Every scroll area is a containing block (spec 1.10). An element with position: absolute (a
// .sr-only label, say) inside a scroll area that is position: static is placed against some outer
// box instead, so the scroll area does not clip it and the whole page grows a long empty tail.
// So each rule that makes a scroll area (overflow, overflow-x or overflow-y: auto or scroll) also sets its
// position, in the same rule, to relative, sticky, absolute or fixed. Sideways scroll areas
// (overflow-x), two-value shorthands (overflow: hidden auto) and !important count too.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

interface Rule { file: string; selector: string; decls: Map<string, string> }

/** Every rule in a stylesheet with its declarations (inside @media too). */
function rules(file: string, css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => {
    const decls = new Map<string, string>();
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i >= 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
    }
    return { file, selector: m[1].trim().replace(/\s+/g, ' '), decls };
  });
}

const RULES = cssFiles(SRC).flatMap((path) => rules(relative(SRC, path).split('\\').join('/'), readFileSync(path, 'utf8')));

/** The value without a trailing !important, in lower case. */
const bare = (v: string | undefined) => (v ?? '').replace(/\s*!important\s*$/i, '').trim().toLowerCase();

/** A rule makes a scroll area when overflow, overflow-x or overflow-y is auto or scroll, on either
 *  axis of a two-value shorthand too (overflow: hidden auto). One axis is enough: the other then
 *  computes to auto, so the box scrolls either way. */
export function makesScrollArea(decls: Map<string, string>): boolean {
  return ['overflow', 'overflow-x', 'overflow-y'].some((p) => bare(decls.get(p)).split(/\s+/).some((v) => v === 'auto' || v === 'scroll'));
}

/** The rule sets a position that makes the box the one its absolutely placed pieces are placed in. */
export function holdsItsPieces(decls: Map<string, string>): boolean {
  return /^(relative|sticky|absolute|fixed)$/.test(bare(decls.get('position')));
}

const decl = (text: string) => new Map(text.split(';').filter((d) => d.includes(':')).map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));

describe('scroll areas', () => {
  it.each([
    ['overflow: auto', true],
    ['overflow: scroll', true],
    ['overflow-y: auto', true],
    ['overflow-x: auto', true],
    ['overflow-x: scroll', true],
    ['overflow: hidden auto', true],
    ['overflow: auto hidden', true],
    ['overflow: auto !important', true],
    ['overflow-x: auto!important', true],
    ['overflow: hidden', false],
    ['overflow: visible', false],
    ['overflow-x: hidden', false],
    ['overflow: hidden clip', false],
  ])('%s makes a scroll area: %s', (text, want) => {
    expect(makesScrollArea(decl(text))).toBe(want);
  });

  it.each([
    ['position: relative', true],
    ['position: sticky', true],
    ['position: absolute !important', true],
    ['position: fixed', true],
    ['position: static', false],
    ['', false],
  ])('"%s" holds its pieces: %s', (text, want) => {
    expect(holdsItsPieces(decl(text))).toBe(want);
  });

  it('finds the scroll areas the app has', () => {
    expect(RULES.filter((r) => makesScrollArea(r.decls)).length).toBeGreaterThan(30);
  });

  it('every scroll area holds on to what is inside it', () => {
    const loose = RULES.filter((r) => makesScrollArea(r.decls) && !holdsItsPieces(r.decls));
    expect(loose.map((r) => `${r.file}: ${r.selector}`)).toEqual([]);
  });
});
