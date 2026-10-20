// @vitest-environment node
// The grid's limits for the Preview pane (app.css) are the handle's (PaneResizer.tsx).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIDDLE_MIN, PREVIEW_MIN } from './PaneResizer';

const css = readFileSync(fileURLToPath(new URL('../app/app.css', import.meta.url)), 'utf8');

describe('app.css: the Preview pane’s width', () => {
  it('keeps the same limits as the handle', () => {
    expect(css).toContain(`--preview-min: ${PREVIEW_MIN}px;`);
    expect(css).toContain(`--middle-min: ${MIDDLE_MIN}px;`);
  });

  it('clamps the column, in the normal layout and the icon rail alike', () => {
    expect(css).toMatch(/--preview-col: clamp\(var\(--preview-min\), var\(--preview-w\), max\(var\(--preview-min\), 100% - var\(--jobs-reserve\) - var\(--middle-min\)\)\)/);
    expect(css).toMatch(/\.panes \{[^}]*grid-template-columns:[^;]*var\(--preview-col\)/);
    expect(css).toMatch(/\.panes-rail \{[^}]*var\(--preview-col\)[^}]*--jobs-reserve: var\(--rail-w\)/);
  });
});
