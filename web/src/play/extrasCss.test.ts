// @vitest-environment node
// The Full-mode extras' stylesheet: what jsdom can't lay out. Nothing moves under reduced motion.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./extras.css', import.meta.url)), 'utf8');
const main = readFileSync(fileURLToPath(new URL('../main.tsx', import.meta.url)), 'utf8');

describe('extras.css', () => {
  it('is loaded by the page', () => {
    expect(main).toContain("import './play/extras.css';");
  });

  it('holds the boss bar still under reduced motion, and uses theme tokens only', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.boss-bar-fill\s*\{\s*transition:\s*none/);
    const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(uncommented).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i);
  });
});
