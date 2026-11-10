// @vitest-environment node
// Every scroll area is a containing block (spec 1.10). An element with position: absolute (a
// .sr-only label, say) inside a scroll area that is position: static is placed against some outer
// box instead, so the scroll area does not clip it and the whole page grows a long empty tail.
// So each rule that makes a scroll area (overflow or overflow-y: auto or scroll) also sets its
// position, in the same rule, to relative, sticky, absolute or fixed.
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

const SCROLLS = /^(auto|scroll)$/;
const HOLDS = /^(relative|sticky|absolute|fixed)$/;
const scrolls = (r: Rule) => ['overflow', 'overflow-y'].some((p) => SCROLLS.test(r.decls.get(p) ?? ''));

describe('scroll areas', () => {
  it('finds the scroll areas the app has', () => {
    expect(RULES.filter(scrolls).length).toBeGreaterThan(25);
  });

  it('every scroll area holds on to what is inside it', () => {
    const loose = RULES.filter(scrolls).filter((r) => !HOLDS.test(r.decls.get('position') ?? ''));
    expect(loose.map((r) => `${r.file}: ${r.selector}`)).toEqual([]);
  });
});
