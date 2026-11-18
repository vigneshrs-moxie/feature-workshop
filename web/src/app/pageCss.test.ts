// @vitest-environment node
// Every stylesheet under web/src closes each block it opens. A lost `}` (an earlier merge dropped the
// one after the old job page's header phone rules) puts every rule after it inside that block, so
// on a laptop the page silently loses its layout. Comments are left out; braces inside strings are
// not counted (no stylesheet here has any).
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

/** Where the braces first go wrong: a `}` with nothing open, or blocks still open at the end; null when they balance. */
export function braceProblem(css: string): string | null {
  // Comments go, their line breaks stay: a line named here is the file's own line.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ''));
  let depth = 0;
  let line = 1;
  for (const ch of text) {
    if (ch === '\n') line++;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth < 0) return `a } with nothing open on line ${line}`;
  }
  return depth === 0 ? null : `${depth} block${depth === 1 ? '' : 's'} still open at the end`;
}

describe('the stylesheets’ braces', () => {
  it('braceProblem finds a lost } and a stray one', () => {
    expect(braceProblem('a { b: c; }\n@media (x) { d { e: f; } }')).toBeNull();
    expect(braceProblem('@media (x) {\n  d { e: f; }\n\ng { h: i; }')).toBe('1 block still open at the end');
    expect(braceProblem('a { b: c; }\n}')).toBe('a } with nothing open on line 2');
    expect(braceProblem('/* { */ a { b: c; }')).toBeNull();
    // A comment over several lines keeps its lines, so the line named is the file's own.
    expect(braceProblem('/* one\ntwo\nthree */\na { b: c; }\n}')).toBe('a } with nothing open on line 5');
  });

  it('every stylesheet under web/src closes each block it opens', () => {
    const files = cssFiles(SRC);
    expect(files.length).toBeGreaterThan(10);
    const problems = files.flatMap((path) => {
      const problem = braceProblem(readFileSync(path, 'utf8'));
      return problem ? [`${relative(SRC, path)}: ${problem}`] : [];
    });
    expect(problems).toEqual([]);
  });
});
