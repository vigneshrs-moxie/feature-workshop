// @vitest-environment node
// The sticky job header (app.css) never covers the keyboard focus: the Foreman pane scrolls clear
// of it (scroll-padding-top) and so does anything focusable in the thread (scroll-margin-top), both
// by the header's height, a variable the pane sets from theme tokens.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../../app/app.css', import.meta.url)), 'utf8');
const block = (selector: string) => {
  const m = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  return [...css.matchAll(m)].map((x) => x[1]).join('\n');
};

describe('app.css: the sticky job header and the focus', () => {
  it('the header sticks to the top of the Foreman pane', () => {
    const header = block('.pane-foreman .job-header');
    expect(header).toMatch(/position:\s*sticky/);
    expect(header, 'flush with the pane edge, over its top padding').toMatch(/top:\s*calc\(-1 \* var\(--space-3\)\)/);
  });

  it('the pane sets the header’s height from tokens and scrolls clear of it', () => {
    const pane = block('.pane-foreman');
    expect(pane).toMatch(/--job-header-h:\s*calc\([^;]*var\(--text-md\)[^;]*var\(--text-sm\)[^;]*\)/);
    expect(pane).toMatch(/scroll-padding-top:\s*var\(--job-header-h\)/);
  });

  it('everything focusable in the thread keeps the same margin above it', () => {
    const focusables = block('.pane-foreman .thread :is(a, button, summary, input, textarea, select, [tabindex])');
    expect(focusables).toMatch(/scroll-margin-top:\s*var\(--job-header-h\)/);
  });
});
