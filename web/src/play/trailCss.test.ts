// @vitest-environment node
// The trail's stylesheet: what jsdom can't lay out. It is loaded, uses theme tokens only, keeps the
// stop names it has room for on a narrow pane, and moves nothing by itself.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./trail.css', import.meta.url)), 'utf8');
const main = readFileSync(fileURLToPath(new URL('../main.tsx', import.meta.url)), 'utf8');
const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('trail.css', () => {
  it('is loaded by the page, before the themes', () => {
    expect(main).toContain("import './play/trail.css';");
    expect(main.indexOf("import './play/trail.css'")).toBeLessThan(main.indexOf("import './theme/themes/index.css'"));
  });

  it('uses theme tokens only', () => {
    expect(uncommented).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|oklch\(|hsl\(/i);
  });

  it('on a narrow pane keeps only the current stop’s and the goal’s names (a container query)', () => {
    expect(uncommented).toMatch(/\.job-trail\s*\{[^}]*container-type:\s*inline-size/);
    expect(uncommented).toMatch(/@container \(max-width: \d+px\)\s*\{\s*\.trail-stop:not\(\.is-here, \.is-goal\) \.trail-label\s*\{\s*visibility:\s*hidden/);
  });

  it('moves nothing by itself (the crew’s own motion follows the Play mode)', () => {
    expect(uncommented).not.toMatch(/animation|transition/);
  });
});
