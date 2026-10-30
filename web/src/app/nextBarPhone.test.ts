// @vitest-environment node
// The Jobs next-step bar on a phone (packet W, fix 3): the one-line bar keeps its row and its
// 56 px, so the Open button stays inside it and nothing below moves. Before, the phone rules
// wrapped the bar and stretched the button to the full width, out of a bar that stays 56 px tall.
// (Measured in a real browser at 360, 390 and 760 px too: nothing spills, the bar stays 56 px.)
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./pages.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of every rule for `selector` inside the phone media query blocks. */
function phoneRule(selector: string): string {
  const blocks = [...css.matchAll(/@media \(max-width: 760px\) \{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)].map((m) => m[1]);
  return blocks.flatMap((b) => [...b.matchAll(/([^{}]+)\{([^{}]*)\}/g)])
    .filter((m) => m[1].split(',').map((s) => s.trim()).includes(selector))
    .map((m) => m[2]).join(';');
}

describe('the one-line next-step bar on a phone', () => {
  it('keeps one fixed-height row', () => {
    expect(css).toMatch(/\.next-bar\.is-line \{[^}]*height: 56px/);
    expect(phoneRule('.next-bar.is-line')).toMatch(/flex-wrap: nowrap/);
  });

  it('lets the sentence take up to two lines beside the button, which keeps its own width', () => {
    const head = phoneRule('.next-bar.is-line .next-head');
    expect(head).toMatch(/min-width: 0/);
    expect(head).toMatch(/-webkit-line-clamp: 2/);
    expect(head).toMatch(/white-space: normal/);
    expect(phoneRule('.next-bar.is-line .next-actions')).toMatch(/width: auto/);
    expect(phoneRule('.next-bar.is-line .next-actions .btn')).toMatch(/flex: none/);
  });
});
