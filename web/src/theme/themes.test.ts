// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HIDDEN_THEME_IDS, THEME_IDS } from './theme';
import { CHART_SERIES, semanticTokens, FOLLOWING_TOKENS } from './tokens';

const file = (name: string) => fileURLToPath(new URL(`./themes/${name}`, import.meta.url));
const read = (id: string) => readFileSync(file(`${id}.css`), 'utf8');
const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every token a theme besides Default sets for itself, so nothing falls back to the default's
 * greys and indigo: the base palette, every semantic token (groups, asks, stages, shape, pattern,
 * heading font, --row-alt) and the crew's paints.
 */
export const REQUIRED_THEME_TOKENS: readonly string[] = [
  ...[0, 1, 2, 3, 4].map((i) => `bg-${i}`),
  'border-1', 'border-2', 'border-3', 'text-1', 'text-2', 'text-3',
  'accent', 'accent-strong', 'accent-soft', 'on-accent', 'focus-ring',
  ...['ok', 'warn', 'error', 'info', 'paused', 'review'].flatMap((s) => [`status-${s}`, `status-${s}-bg`]),
  // Packet R's stop ring (the job's seven stops, the floor's benches, Telemetry's series): every
  // theme draws it in its own colours, so the default's pink Spec never borrows a theme's needs-you.
  ...['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship'].map((s) => `stop-${s}`),
  'shadow-1', 'shadow-2',
  ...Array.from({ length: CHART_SERIES }, (_, i) => `chart-${i + 1}`),
  // Packet R's surfaces, primary fill, elevation and needs-you dot follow each theme's own base tokens.
  ...Object.keys(semanticTokens()).filter((k) => !FOLLOWING_TOKENS.includes(k)),
  'crew-ink', 'crew-shadow', 'crew-feet', 'crew-zzz',
  ...['clay', 'amber', 'amber-deep', 'plum', 'plum-deep', 'tweed', 'tweed-deep', 'blueprint', 'blueprint-deep', 'moss', 'teal', 'steel', 'forest', 'forest-deep'].map((p) => `crew-c-${p}`),
];
/** The hidden themes also set what the medals, bursts and tools are drawn with. */
const HIDDEN_EXTRA = ['crew-gold', 'crew-gold-dark', 'crew-spark', 'crew-glass', 'crew-metal'];

// Every selector of every rule, outside @keyframes, with @media unwrapped.
function selectors(css: string): string[] {
  let text = uncommented(css).replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  text = text.replace(/@media[^{]*\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g, '$1');
  return [...text.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())).filter(Boolean);
}

describe('theme files', () => {
  it('every registered theme has its own CSS file, scoped to html[data-theme="<id>"]', () => {
    for (const id of THEME_IDS) {
      const path = file(`${id}.css`);
      expect(existsSync(path), `${id}.css is missing`).toBe(true);
      const css = readFileSync(path, 'utf8');
      expect(css, `${id}.css must scope under html[data-theme="${id}"]`).toContain(`html[data-theme="${id}"]`);
      // Nothing leaks: every rule is under the theme's own scope (a themed file may not style :root or body bare).
      const bare = uncommented(css).match(/^\s*(:root|html|body)\s*\{/m);
      expect(bare, `${id}.css styles ${bare?.[1]} without a theme scope`).toBeNull();
    }
  });

  it('themes/index.css loads every theme file', () => {
    const index = readFileSync(file('index.css'), 'utf8');
    for (const id of THEME_IDS) expect(index).toContain(`@import './${id}.css';`);
  });

  it('main.tsx loads the themes after app.css and sets the theme before the first render', () => {
    const main = readFileSync(fileURLToPath(new URL('../main.tsx', import.meta.url)), 'utf8');
    expect(main.indexOf("import './theme/themes/index.css'")).toBeGreaterThan(main.indexOf("import './app/app.css'"));
    expect(main.indexOf("import './theme/themes/index.css'")).toBeGreaterThan(main.indexOf("import './play/achievements.css'"));
    expect(main.indexOf('initTheme()')).toBeLessThan(main.indexOf('createRoot('));
  });

  it('every theme besides Default sets every required token for itself', () => {
    expect(REQUIRED_THEME_TOKENS).toContain('row-alt');
    expect(REQUIRED_THEME_TOKENS).toContain('group-needs-you-fg');
    for (const id of THEME_IDS.filter((t) => t !== 'default')) {
      const css = uncommented(read(id));
      const want = HIDDEN_THEME_IDS.includes(id) ? [...REQUIRED_THEME_TOKENS, ...HIDDEN_EXTRA] : REQUIRED_THEME_TOKENS;
      const missing = want.filter((t) => !new RegExp(`--${t}:`).test(css));
      expect(missing, `${id}.css doesn’t set ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('the hidden themes (CRT Terminal, Gold) scope every rule, style the prose, cards, Crew-dex and toasts, and stop motion under reduced motion', () => {
    expect([...HIDDEN_THEME_IDS]).toEqual(['crt', 'gold']);
    for (const id of HIDDEN_THEME_IDS) {
      const css = read(id);
      const scope = `html[data-theme="${id}"]`;
      for (const sel of selectors(css)) expect(sel.startsWith(scope), `${id}.css: ${sel}`).toBe(true);
      for (const hook of ['.prose', '.reply', '.brief-card', '.perm-card', '.composer', '.palette', '.dex-face', '.ach-badge', '.play-toast', '.how', ':focus-visible']) {
        expect(css, `${id}.css styles ${hook}`).toContain(`${scope} ${hook}`);
      }
      expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
      // Every animation it starts is turned off again under reduced motion.
      const animated = selectors(css.replace(/@media \(prefers-reduced-motion: reduce\)[\s\S]*$/, ''))
        .filter((s) => new RegExp(`${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*\\banimation:`).test(css));
      const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
      for (const sel of animated) expect(reduced, `${id}.css: ${sel} keeps moving under reduced motion`).toContain(sel);
    }
  });

  it('CRT Terminal draws its scanlines as an overlay that never takes a click', () => {
    const css = uncommented(read('crt'));
    const overlay = /html\[data-theme="crt"\] \.app::after \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(overlay).toContain('repeating-linear-gradient');
    expect(overlay).toContain('pointer-events: none');
    expect(overlay).toContain('position: fixed');
    // Faint lines: the darkest stripe stays well under a fifth, so text stays readable.
    const alpha = Number(/oklch\(0 0 0 \/ ([\d.]+)\) 0 1px/.exec(overlay)?.[1]);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThanOrEqual(0.2);
    // The rolling band is the one moving part, and it is not drawn under reduced motion.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.app::before \{ display: none;/);
  });
});
