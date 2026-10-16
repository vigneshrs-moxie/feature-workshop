// @vitest-environment node
// The crew's colours: every --crew-* the rig and play.css use has a default in tokens.ts, every
// themed file restyles the crew's paints, and play.css keeps motion behind .is-animated and off
// under reduced motion.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_IDS } from '../theme/theme';
import { CREW_TOKENS, tokensCss } from '../theme/tokens';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
// var(--crew-x) in CSS, and the components' v('x') / C('x') helpers for the same.
const used = (text: string) => new Set([
  ...[...text.matchAll(/var\(--(crew-[a-z0-9-]+)\)/g)].map((m) => m[1]),
  ...[...text.matchAll(/\b[vC]\('([a-z0-9-]+)'\)/g)].map((m) => `crew-${m[1]}`),
]);
// Set per member or mixed in play.css itself, not tokens.
const LOCAL = new Set(['crew-paint', 'crew-hat', 'crew-paint-shade', 'crew-paint-arm', 'crew-hat-shade']);

describe('crew tokens', () => {
  it('every --crew-* colour the rig and play.css use has a default in tokens.css', () => {
    const names = new Set([...used(read('./crewParts.tsx')), ...used(read('./CrewMember.tsx')), ...used(read('./play.css'))]);
    expect(names.size).toBeGreaterThan(20);
    for (const n of names) if (!LOCAL.has(n)) expect(CREW_TOKENS[n], n).toBeTruthy();
    for (const k of Object.keys(CREW_TOKENS)) expect(tokensCss()).toContain(`--${k}: `);
  });

  it('each theme besides Default restyles the crew’s paints, inside its own scope', () => {
    for (const id of THEME_IDS.filter((t) => t !== 'default')) {
      const css = read(`../theme/themes/${id}.css`);
      for (const k of ['crew-ink', 'crew-shadow', 'crew-c-forest', 'crew-c-clay', 'crew-c-amber']) expect(css, `${id} ${k}`).toMatch(new RegExp(`--${k}:`));
    }
  });

  it('Default keeps the crew’s ambers, golds and sparks off the needs-you hue (status-warn, 80)', () => {
    const css = read('../theme/themes/default.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toContain('html[data-theme="default"]');
    const warnHue = 80;
    for (const k of ['crew-c-amber', 'crew-c-amber-deep', 'crew-gold', 'crew-gold-dark', 'crew-spark']) {
      const m = new RegExp(`--${k}:\\s*oklch\\(\\s*[\\d.]+\\s+[\\d.]+\\s+([\\d.]+)\\s*\\)`).exec(css);
      expect(m, k).not.toBeNull();
      expect(Math.abs(Number(m![1]) - warnHue), k).toBeGreaterThanOrEqual(15);
    }
  });

  it('play.css takes its shade base and font from tokens: no literal black or font names', () => {
    const css = read('./play.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#000\b|\bblack\b/);
    expect(css).toContain('var(--crew-shade-base)');
    expect(css).toContain('var(--crew-font)');
    expect(read('./crewParts.tsx')).not.toMatch(/fontFamily=/);
  });

  it('play.css animates only .is-animated, and nothing under reduced motion', () => {
    const css = read('./play.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{[^{}]*\banimation\s*:[^{}]*\}/g)].map((m) => m[1].trim());
    expect(rules.length).toBeGreaterThan(20);
    for (const sel of rules) {
      if (sel.startsWith('.crew, .crew *')) continue; // the reduced-motion off switch
      for (const part of sel.split(',')) expect(part, part).toContain('.is-animated');
    }
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.crew, \.crew \* \{ animation: none !important; \}/);
  });
});
