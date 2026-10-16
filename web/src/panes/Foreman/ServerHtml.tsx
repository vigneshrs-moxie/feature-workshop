// HTML the dashboard rendered from Markdown: replies, briefs, detail files, the Docs tab's documents
// (GET /api/job/:slug/doc), the notes Preview (POST /api/job/:slug/render) and a Markdown file a
// permission card shows (plain.previewHtml). Styled by `.prose` in app/app.css.
//
// Why inserting it is safe: the dashboard renders it with markdown-it in dashboard/lib/markdown.js,
// with `html: false` (raw HTML in the source comes out as text), a link check that drops unsafe
// schemes such as javascript: and "//host" links, and IDs linked only after escaping; JSON documents
// come escaped in a <pre> (lib/docs.js jsonHtml). The node tests hold it to that
// (test/actions.test.js "renderMarkdown", test/server-v2.test.js "thread and doc HTML",
// test/docs.test.js). Only strings from those dashboard fields come through here; never pass
// anything else. Text a person types is shown as plain text, or sent to the dashboard's renderer
// first (the notes Preview).
//
// Links inside (lib/docLinks.ts): "#section" scrolls to that heading here instead of changing the
// route; a link to another of the job's .md documents opens it in the Docs tab (`base` is the folder
// of this document inside the job folder, '' for the top); web links open in a new tab; anything
// else isn't followed and says why underneath.
import { useState, type MouseEvent } from 'react';
import { useUi } from '../../app/ui';
import { findAnchor, linkAction } from '../../lib/docLinks';

export function ServerHtml({ html, className = '', base = '' }: { html: string; className?: string; base?: string }) {
  const ui = useUi();
  const [hint, setHint] = useState<string | null>(null);

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const a = (e.target as Element | null)?.closest?.('a[href]');
    if (!a || !e.currentTarget.contains(a)) return;
    const action = linkAction(a.getAttribute('href'), base);
    if (action.kind === 'route' || action.kind === 'external') return;
    e.preventDefault();
    if (action.kind === 'anchor') {
      const target = findAnchor(e.currentTarget, action.id);
      if (!target) { setHint('That section isn’t on this page.'); return; }
      setHint(null);
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
      // Focus follows, so the keyboard and screen readers carry on from the section.
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      return;
    }
    if (action.kind === 'doc') {
      setHint(null);
      ui.openDocs(action.file);
      return;
    }
    setHint(action.hint);
  }

  return (
    <>
      {/* Clicks are handled for the links inside (Enter on a focused link is a click too). */}
      <div className={`prose ${className}`.trim()} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      {hint && <p className="link-hint muted" role="status">{hint}</p>}
    </>
  );
}
