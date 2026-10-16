// @vitest-environment node
// The Full-mode extras' stylesheet: what jsdom can't lay out. The quest track collapses to its
// stars on a narrow pane, and nothing moves under reduced motion.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./extras.css', import.meta.url)), 'utf8');
const main = readFileSync(fileURLToPath(new URL('../main.tsx', import.meta.url)), 'utf8');

describe('extras.css', () => {
  it('is loaded by the page', () => {
    expect(main).toContain("import './play/extras.css';");
  });

  it('collapses the quest track to its stars on a narrow pane (a container query hides the path)', () => {
    expect(css).toMatch(/\.quest-track\s*\{[^}]*container-type:\s*inline-size/);
    expect(css).toMatch(/@container \(max-width: \d+px\)\s*\{\s*\.quest-path\s*\{\s*display:\s*none/);
  });

  it('holds the boss bar still under reduced motion, and uses theme tokens only', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.boss-bar-fill\s*\{\s*transition:\s*none/);
    const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(uncommented).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i);
  });
});
