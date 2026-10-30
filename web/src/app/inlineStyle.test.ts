// @vitest-environment node
// No inline style the CSP refuses (packet W, fix 7). The dashboard sends style-src 'self'
// (dashboard/site/index.js), so an inline <style> or style="…" in the page's HTML is blocked and
// logs "Applying inline style violates … style-src 'self'" on every page. The first paint's light
// background (packet R) is a file of its own instead, linked before anything else.
// (React's style={} props set CSSOM properties, which the CSP allows.)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const html = readFileSync(at('../../index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

describe('index.html', () => {
  it('has no inline <style> and no style attribute', () => {
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
  });

  it('paints Light first from its own stylesheet, linked before the app', () => {
    const link = html.indexOf('<link rel="stylesheet" href="/first-paint.css" />');
    expect(link).toBeGreaterThan(-1);
    expect(link).toBeLessThan(html.indexOf('<script'));
    const css = readFileSync(at('../../public/first-paint.css'), 'utf8');
    expect(css).toMatch(/html\[data-theme="light"\] \{ background: #fff; color-scheme: light; \}/);
    expect(existsSync(at('../../public/first-paint.css'))).toBe(true);
  });
});
