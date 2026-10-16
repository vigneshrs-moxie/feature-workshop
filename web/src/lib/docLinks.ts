// What a click on a link inside a rendered document (ServerHtml) does. The page uses hash routes
// (app/router.ts), so a plain "#section" link would change the route and close the job, and a
// relative "plan.md" link would leave the app for a page that isn't there. Instead:
//   #/…            a dashboard route (the requirement-ID links): followed as usual
//   #section       scrolls to that heading inside the same document (headings are h-<slug>)
//   https:, mailto:, vscode:  left to the browser (the dashboard already opens them in a new tab)
//   notes.md, ../findings.md  a document of the job: opened in the Docs tab (when it's in the list)
//   anything else  (another kind of file, a path on this computer, //host) not followed, with a hint

export type LinkAction =
  | { kind: 'route' }
  | { kind: 'external' }
  | { kind: 'anchor'; id: string }
  | { kind: 'doc'; file: string }
  | { kind: 'blocked'; hint: string };

const decode = (s: string) => {
  try { return decodeURIComponent(s); } catch { return s; }
};

/**
 * A relative path inside the job folder, from the folder of the document it's in (`base`, '' for the
 * top). Null when it would leave the folder or names a hidden part.
 */
export function resolveDocPath(base: string, rel: string): string | null {
  const parts = rel.startsWith('/') ? [] : base.split('/').filter(Boolean);
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    if (seg.startsWith('.')) return null;
    parts.push(seg);
  }
  return parts.length ? parts.join('/') : null;
}

export function linkAction(rawHref: string | null | undefined, base = ''): LinkAction {
  const href = String(rawHref ?? '').trim();
  if (!href || href.startsWith('#/')) return { kind: 'route' };
  if (href.startsWith('#')) return { kind: 'anchor', id: decode(href.slice(1)) };
  if (/^[\\/]{2}/.test(href)) return { kind: 'blocked', hint: `This link (${href}) points to another site without saying which, so it doesn’t open from here.` };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: 'external' };
  const pathPart = href.replace(/[?#].*$/, '');
  if (href.startsWith('/')) return { kind: 'blocked', hint: `This link (${href}) points to a file on this computer, not one of this job’s documents, so it doesn’t open here.` };
  if (/\.md$/i.test(pathPart)) {
    const file = resolveDocPath(base, decode(pathPart));
    if (file) return { kind: 'doc', file };
    return { kind: 'blocked', hint: `This link (${href}) points outside this job’s folder, so it doesn’t open here.` };
  }
  return { kind: 'blocked', hint: `This link (${href}) isn’t one of this job’s documents, so it doesn’t open here. Only links to the job’s .md documents open, in the Docs tab.` };
}

/** The element a "#section" link means inside `root`: the id as written, or the heading h-<id>. */
export function findAnchor(root: ParentNode, id: string): HTMLElement | null {
  if (!id) return null;
  const want = new Set([id, `h-${id}`, `h-${id.toLowerCase()}`]);
  for (const el of root.querySelectorAll<HTMLElement>('[id]')) if (want.has(el.id)) return el;
  return null;
}
