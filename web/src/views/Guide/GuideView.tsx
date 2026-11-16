// The Guide page (#/guide, #/guide/<page>, #/guide/<page>/<section>): the user guide (docs/guide),
// built into the app (vite.config.ts's starbase-guide plugin), on the laptop and on the website alike.
// On the left the contents, the page open marked, with "Find in the guide" over every page's words;
// on the right the page at reading width, each heading with a # link to its own address, and
// Previous / Next at its foot. The pages and their words come in this page's own chunk
// (app/pages.tsx), so nothing of the guide loads before it is opened.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import pages from 'virtual:starbase-guide';
import { guideHref } from '../../app/router';
import { Button } from '../../components/Button';
import { TextInput } from '../../components/Field';
import { Page } from '../../components/page/Page';
import type { GuidePage } from './guideBuild';
import './guide.css';

const CONTENTS = 'contents';

/** A page's address: the contents is #/guide. */
const hrefOf = (p: GuidePage, section?: string) => guideHref(p.id === CONTENTS ? undefined : p.id, section);

/** "3. The Jobs page", or the contents' own title. */
const nameOf = (p: GuidePage) => (p.n === null ? 'Contents' : `${p.n}. ${p.title}`);

/** Each page's words, block by block with the section they are in, read once when Find is first used. */
type Block = { section?: string; text: string };
let blocksCache: Map<string, Block[]> | null = null;
function blocksOf(list: readonly GuidePage[]): Map<string, Block[]> {
  if (blocksCache) return blocksCache;
  const parser = new DOMParser();
  blocksCache = new Map(list.map((p) => {
    const body = parser.parseFromString(p.html, 'text/html').body;
    let section: string | undefined;
    const blocks: Block[] = [];
    for (const el of Array.from(body.children)) {
      if (/^H[2-6]$/.test(el.tagName) && el.id.startsWith('h-')) section = el.id.slice(2);
      blocks.push({ section, text: (el.textContent ?? '').replace(/\s+/g, ' ') });
    }
    return [p.id, blocks];
  }));
  return blocksCache;
}

/** The page shown last in this visit of the app: coming back to it keeps its scroll (components/page/Page), another opens at its top. */
let lastShown: string | null = null;

interface Hit { page: GuidePage; count: number; section?: string; snippet: string }

/** The pages whose words hold `query` (any case), with how often, where first, and the words around it. */
export function findInGuide(list: readonly GuidePage[], query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const all = blocksOf(list);
  const hits: Hit[] = [];
  for (const page of list) {
    let count = 0;
    let first: { block: Block; at: number } | null = null;
    for (const block of all.get(page.id) ?? []) {
      const lower = block.text.toLowerCase();
      for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, at + q.length)) {
        count++;
        first ??= { block, at };
      }
    }
    if (!first) continue;
    const from = Math.max(0, first.at - 40);
    const snippet = `${from > 0 ? '…' : ''}${first.block.text.slice(from, first.at + q.length + 60).trim()}…`;
    hits.push({ page, count, section: first.block.section, snippet });
  }
  return hits;
}

export function GuideView({ page, section }: { page?: string; section?: string }) {
  const found = page ? pages.find((p) => p.id === page) : pages[0];
  const current = found ?? pages[0];
  const at = pages.indexOf(current);
  const prev = at > 0 ? pages[at - 1] : null;
  const next = at < pages.length - 1 ? pages[at + 1] : null;
  const [query, setQuery] = useState('');
  const hits = useMemo(() => findInGuide(pages, query), [query]);
  const text = useRef<HTMLDivElement>(null);
  const shown = useRef<string | null>(null);

  // A new page opens at its top, or at the section its address names (Back, Forward and a reload
  // alike); the keyboard carries on from there.
  useLayoutEffect(() => {
    const box = text.current;
    const main = box?.closest('main');
    if (!box || !main) return;
    const target = section ? box.querySelector<HTMLElement>(`#${CSS.escape(`h-${section}`)}`) : null;
    const lostFocus = !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected;
    if (target) {
      target.scrollIntoView?.({ block: 'start' });
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    } else if (lastShown !== current.id) {
      main.scrollTop = 0;
      // A link inside the text that opened another page took the focus with it.
      if (shown.current !== null && lostFocus) box.focus({ preventScroll: true });
    }
    shown.current = current.id;
    lastShown = current.id;
  }, [current.id, section]);

  const searching = query.trim().length >= 2;
  return (
    <Page label="Guide" title={current.n === null ? current.title : `${current.n}. ${current.title}`} className="page-guide">
      <div className="ug-layout">
        <nav className="ug-rail" aria-label="Guide pages">
          <TextInput
            type="search"
            className="ug-find"
            aria-label="Find in the guide"
            placeholder="Find in the guide"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
            title="Find words on every page of the guide."
          />
          {searching ? (
            <ul className="ug-list" aria-label="Pages with these words">
              {hits.length ? hits.map((h) => (
                <li key={h.page.id}>
                  <a className="ug-row" href={hrefOf(h.page, h.section)} title={`Open ${nameOf(h.page)} where the words first appear.`}>
                    <span className="ug-row-name">{nameOf(h.page)} <span className="muted">· {h.count}</span></span>
                    <span className="ug-row-snippet muted">{h.snippet}</span>
                  </a>
                </li>
              )) : <li className="muted ug-none">No page has “{query.trim()}”.</li>}
            </ul>
          ) : (
            <ol className="ug-list">
              {pages.map((p) => (
                <li key={p.id}>
                  <a className={`ug-row${p === current ? ' is-current' : ''}`} href={hrefOf(p)} aria-current={p === current ? 'page' : undefined}>
                    <span className="ug-row-name">{nameOf(p)}</span>
                  </a>
                </li>
              ))}
            </ol>
          )}
        </nav>
        <div className="ug-body">
          {page && !found && <p className="ug-missing" role="status">There is no guide page called “{page}”. Here are the contents.</p>}
          <div ref={text} className="prose ug-text" tabIndex={-1} dangerouslySetInnerHTML={{ __html: current.html }} />
          <nav className="ug-foot" aria-label="Previous and next page">
            {prev ? <Button kind="quiet" icon="chevron-left" href={hrefOf(prev)} className="ug-prev" title={`Previous page: ${nameOf(prev)}`}>{nameOf(prev)}</Button> : <span />}
            {next ? <Button kind="quiet" href={hrefOf(next)} className="ug-next" title={`Next page: ${nameOf(next)}`}>{nameOf(next)} ›</Button> : null}
          </nav>
        </div>
      </div>
    </Page>
  );
}
