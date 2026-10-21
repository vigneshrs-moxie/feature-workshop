// The classic view's theme sheet (dashboard/public serves the classic page; it links /next/theme.css).
// Built from the same files as the new view, so both pages wear the theme you picked: tokens.css and,
// from each theme under themes/, only what styles the page itself (the token blocks on
// html[data-theme="…"], the page background on html[data-theme="…"] body) and its @font-face rules.
// A theme's hooks for the new view's own components (.composer, .job-row, …) are left out: the
// classic page has its own classes, and some share a name with a different meaning (.btn, .pill).
// The Vite plugin in vite.config.ts writes it to dist/theme.css on every build.
import postcss, { type AtRule, type ChildNode, type Container, type Rule } from 'postcss';

/** A selector that styles the page itself: the root, the html element, or the body, for one theme or all. */
const PAGE_SELECTOR = /^(:root|html|\[data-theme="[\w-]+"\]|html\[data-theme="[\w-]+"\])( body)?$/;

const keepRule = (rule: Rule) => rule.selectors.every((s) => PAGE_SELECTOR.test(s.trim()));

// Remove what isn't kept; at-rules (@media, @supports) stay only if something inside them is kept.
function prune(container: Container) {
  for (const node of [...(container.nodes ?? [])] as ChildNode[]) {
    if (node.type === 'rule') {
      if (!keepRule(node)) node.remove();
    } else if (node.type === 'atrule') {
      const at = node as AtRule;
      if (at.name === 'font-face') continue;
      if (at.name === 'import' || !at.nodes) { at.remove(); continue; }
      prune(at);
      if (!at.nodes.length) at.remove();
    } else if (node.type === 'comment') {
      node.remove();
    }
  }
}

/**
 * The classic view's sheet from the token sheet and the theme files, in the order given.
 * Font URLs are made absolute under the new view's base (fonts live in /next/fonts/).
 */
export function classicThemeCss(files: { name: string; css: string }[], base = '/next/'): string {
  const out: string[] = ['/* The classic view’s theme: built from web/src/theme by vite.config.ts (classicThemeCss). Do not edit. */'];
  for (const { name, css } of files) {
    const root = postcss.parse(css, { from: name });
    prune(root);
    root.walkAtRules('font-face', (at) => {
      at.walkDecls('src', (decl) => { decl.value = decl.value.replace(/url\((['"]?)\/(?!\/)/g, `url($1${base}`); });
    });
    const text = root.toString().trim();
    if (text) out.push(`/* ${name} */\n${text}`);
  }
  return `${out.join('\n\n')}\n`;
}
