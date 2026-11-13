// Reading text in the reader (job page rebuild, Task 12): a body's HTML set for reading. Body text 15 px
// on a 24 px line, at most 80 characters wide; every heading one step above it (jobpage.css .jp2-prose).
//
// The HTML is the dashboard's own render of a reply, a brief or a document (the item route; see
// panes/Foreman/ServerHtml.tsx for why it is safe to insert: markdown-it with html off and a link check).
// Before it is shown it is set for reading, once per body (kept by the body object, so a pick of a held
// body paints in the same frame):
//   - in a message, a paragraph that is only bold words is a heading (the Foreman writes his headings
//     that way; a document has real headings, and its bold lines stay bold lines);
//   - a message's own headline is its title, so the bold words that open it are not said again;
//   - the part that asks him ("Decisions for you", "Decision for you", "Questions for you") carries a
//     quiet left rule (.jp2-ask) so the eye lands on it;
//   - a document's `Key points` come first (after its title heading), and its headings make an outline;
//   - its headings sit under the reader's title (the highest an h3), each the same size on the page.
// Links: as ServerHtml's (lib/docLinks.ts), except that a link to another of the job's documents opens it
// here in the reader, and one the job does not list says so.

import { useState, type MouseEvent } from 'react';
import { findAnchor, linkAction } from '../../lib/docLinks';
import type { JobBody, ReaderTarget } from '../types';
import { useJob } from '../useJob';

export interface OutlineItem { id: string; text: string; level: 2 | 3 }
export interface Prepared { html: string; outline: OutlineItem[] }

const ASK = /^(decisions?\b|questions? for you\b|what i need from you\b|your (call|decision)\b)/i;
const KEY_POINTS = /^key points$/i;
const isHeading = (el: Element | null): el is HTMLElement => !!el && /^H[1-6]$/.test(el.tagName);
const levelOf = (el: Element) => Number(el.tagName[1]);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[.:!?…]+$/, '').toLowerCase();

function parse(html: string): DocumentFragment {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content;
}
const serialize = (root: DocumentFragment) => { const d = document.createElement('div'); d.append(root); return d.innerHTML; };

/** A paragraph that is only bold words (an optional colon after them): the words, else null. */
function boldOnly(p: Element): string | null {
  if (p.tagName !== 'P') return null;
  const parts = [...p.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()));
  if (parts.length < 1 || parts.length > 2) return null;
  const [strong, after] = parts;
  if (!(strong instanceof HTMLElement) || strong.tagName !== 'STRONG') return null;
  if (after && !(after.nodeType === Node.TEXT_NODE && after.textContent?.trim() === ':')) return null;
  const words = strong.textContent?.trim().replace(/:$/, '') ?? '';
  return words || null;
}

/** Bold-only paragraphs become headings (h4: one step above body text, as every heading is). */
function boldHeadings(root: DocumentFragment) {
  for (const p of [...root.children]) {
    const words = boldOnly(p);
    if (words === null) continue;
    const h = document.createElement('h4');
    h.textContent = words;
    p.replaceWith(h);
  }
}

/** The bold words that open a message, when they are its headline (its title): taken out, the rest kept. */
function dropLead(root: DocumentFragment, title: string | null) {
  const first = root.firstElementChild;
  if (!title || !first || first.tagName !== 'P') return;
  const strong = [...first.childNodes].find((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()));
  if (!(strong instanceof HTMLElement) || strong.tagName !== 'STRONG') return;
  const want = norm(title.replace(/…$/, ''));
  const have = norm(strong.textContent ?? '');
  if (!want || !(have === want || (title.endsWith('…') && have.startsWith(want)))) return;
  strong.remove();
  const lead = first.firstChild;
  if (lead?.nodeType === Node.TEXT_NODE) lead.textContent = (lead.textContent ?? '').replace(/^[\s·:—-]+/, '');
  if (!first.textContent?.trim() && !first.querySelector('img')) first.remove();
}

/** The heading and everything under it, up to the next heading of its level or higher. */
function sectionOf(h: HTMLElement): Element[] {
  const out: Element[] = [h];
  for (let el = h.nextElementSibling; el && !(isHeading(el) && levelOf(el) <= levelOf(h)); el = el.nextElementSibling) out.push(el);
  return out;
}

/** The part that asks him, wrapped so it carries the left rule. */
function ruleAsk(root: DocumentFragment) {
  for (const h of [...root.children]) {
    if (!isHeading(h) || !ASK.test(h.textContent?.trim() ?? '') || h.parentNode !== root) continue;
    const part = sectionOf(h);
    const box = document.createElement('div');
    box.className = 'jp2-ask';
    h.before(box);
    box.append(...part);
  }
}

/** `Key points` first: right after a title heading that opens the document, else at the top. */
function keyPointsFirst(root: DocumentFragment) {
  const h = [...root.children].find((el) => isHeading(el) && KEY_POINTS.test(el.textContent?.trim() ?? '')) ?? null;
  if (!isHeading(h)) return;
  const part = sectionOf(h);
  const first = root.firstElementChild;
  const after = first && first !== h && first.tagName === 'H1' ? first : null;
  if (after) after.after(...part);
  else root.prepend(...part);
}

/** The document's h2 and h3 headings, each with an id to scroll to. */
function outlineOf(root: DocumentFragment): OutlineItem[] {
  const out: OutlineItem[] = [];
  let n = 0;
  for (const h of root.querySelectorAll<HTMLElement>('h2, h3')) {
    const text = h.textContent?.trim() ?? '';
    if (!text) continue;
    if (!h.id) h.id = `jp2-h-${++n}`;
    out.push({ id: h.id, text, level: h.tagName === 'H2' ? 2 : 3 });
  }
  return out;
}

/**
 * The body's headings sit under the reader's title (an h2): the highest becomes an h3 and the rest
 * keep their steps below it (to h6 at most). Only the tag moves; they all look the same size.
 */
function underTitle(root: DocumentFragment) {
  const all = [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
  if (!all.length) return;
  const by = 3 - Math.min(...all.map(levelOf));
  if (by <= 0) return;
  for (const h of all) {
    const to = document.createElement(`h${Math.min(6, levelOf(h) + by)}`);
    for (const a of [...h.attributes]) to.setAttribute(a.name, a.value);
    to.append(...h.childNodes);
    h.replaceWith(to);
  }
}

const prepared = new WeakMap<JobBody, Map<string, Prepared>>();
function kept(body: JobBody, key: string, make: () => Prepared): Prepared {
  let byKey = prepared.get(body);
  if (!byKey) { byKey = new Map(); prepared.set(body, byKey); }
  let p = byKey.get(key);
  if (!p) { p = make(); byKey.set(key, p); }
  return p;
}

/** A reply, his message or a brief, set for reading: the headline (its title) not said twice, the ask ruled. */
export function prepareMessage(body: JobBody, title: string | null): Prepared {
  return kept(body, `m|${title ?? ''}`, () => {
    const root = parse(body.html ?? '');
    dropLead(root, title);
    boldHeadings(root);
    ruleAsk(root);
    underTitle(root);
    return { html: serialize(root), outline: [] };
  });
}

/** A document set for reading: Key points first, the ask ruled, an outline of its headings. */
export function prepareDoc(body: JobBody): Prepared {
  return kept(body, 'd', () => {
    const root = parse(body.html ?? '');
    keyPointsFirst(root);
    ruleAsk(root);
    const outline = outlineOf(root);
    underTitle(root);
    return { html: serialize(root), outline };
  });
}

/** Whether the job lists a document by this file (a step's outputs or its reader-only `more`). */
function useListed() {
  return useJob((s) => s.payload?.steps ?? null);
}

export interface ProseProps {
  prepared: Prepared;
  /** The folder of the document it is in, '' for the top (relative links resolve from it). */
  base?: string;
  className?: string;
  onOpen?(t: ReaderTarget, from?: HTMLElement | null): void;
}

export function Prose({ prepared: p, base = '', className = '', onOpen }: ProseProps) {
  const steps = useListed();
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
      goTo(target);
      return;
    }
    if (action.kind === 'doc') {
      const listed = (steps ?? []).some((s) => [...s.outputs, ...(s.more ?? [])].some((o) => o.kind === 'doc' && o.id === action.file));
      if (!listed || !onOpen) { setHint('That document isn’t listed for this job, so it doesn’t open here.'); return; }
      setHint(null);
      onOpen({ kind: 'doc', id: action.file }, a as HTMLElement);
      return;
    }
    setHint(action.hint);
  }

  return (
    <>
      {/* Clicks are handled for the links inside (Enter on a focused link is a click too). */}
      <div className={`jp2-prose ${className}`.trim()} onClick={onClick} dangerouslySetInnerHTML={{ __html: p.html }} />
      {hint && <p className="jp2-prose-hint" role="status">{hint}</p>}
    </>
  );
}

/** Scroll the reader to a heading and give it the focus, so the keyboard carries on from there. */
export function goTo(target: HTMLElement) {
  // At once: no smooth scroll (no animation on this page is longer than 120 ms, speed rule 7).
  target.scrollIntoView?.({ block: 'start' });
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}
