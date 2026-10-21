// The theme picker's swatches (views/Settings/ThemePicker.tsx): each theme drawn from its own tokens,
// on a page wearing another theme. A theme's tokens are scoped to html[data-theme="<id>"], which a
// small element can't be, so this re-scopes every theme's token block to .theme-swatch[data-theme="<id>"]
// (custom properties only) and its page background (html[data-theme="<id>"] body) to the swatch itself.
// The Default's tokens come from tokens.ts, since the base sheet puts them on :root, not on a theme.
// swatches.css is generated from this by the Vite plugin in vite.config.ts (like tokens.css); a test
// fails if the committed copy is out of date. Never edit swatches.css by hand.
import postcss, { type Rule } from 'postcss';
import { colorTokens, DARK, semanticTokens } from './tokens';

export const SWATCH_SELECTOR = (id: string) => `.theme-swatch[data-theme="${id}"]`;

const themeOf = (css: string) => /html\[data-theme="([\w-]+)"\]/.exec(css)?.[1] ?? null;

function block(selector: string, decls: [string, string][]): string {
  return `${selector} {\n${decls.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;
}

/**
 * The contents of swatches.css from the theme files, in the order given: one rule per theme with its
 * custom properties and page background, so a swatch's own var(--bg-0), var(--text-1), … resolve to
 * that theme's values wherever the swatch sits.
 */
export function swatchCss(files: { name: string; css: string }[]): string {
  const out: string[] = ['/* Generated from the theme files by the Vite plugin in vite.config.ts (theme/swatchSheet.ts). Do not edit by hand. */', ''];
  for (const { name, css } of files) {
    const id = themeOf(css);
    if (!id) continue;
    const tokens = new Map<string, string>();
    const page = new Map<string, string>();
    if (id === 'default') for (const [k, v] of Object.entries({ ...colorTokens(DARK), ...semanticTokens() })) tokens.set(`--${k}`, v);
    const root = postcss.parse(css, { from: name });
    root.walkRules((rule: Rule) => {
      if (rule.parent?.type === 'atrule') return; // a @media or @supports block: not the theme's resting look
      const selectors = rule.selectors.map((s) => s.trim());
      if (selectors.every((s) => s === `html[data-theme="${id}"]`)) {
        rule.walkDecls((d) => { if (d.prop.startsWith('--')) tokens.set(d.prop, d.value); });
      } else if (selectors.every((s) => s === `html[data-theme="${id}"] body`)) {
        rule.walkDecls((d) => { if (/^background(-color|-image)?$/.test(d.prop)) page.set(d.prop, d.value); });
      }
    });
    if (!tokens.size && !page.size) continue;
    out.push(block(SWATCH_SELECTOR(id), [...tokens, ...page]), '');
  }
  return out.join('\n');
}
