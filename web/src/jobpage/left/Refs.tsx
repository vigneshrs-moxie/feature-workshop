// The ids in a decision explain themselves (the glance layout, 16 Nov: "if it refers to things like
// R-01, FR-004, I can't understand it … I lose attention"). The payload's waiting decision carries what
// each id it mentions means (dashboard/lib/doc-refs.js mentionedRefs), so from the first paint:
//   - every known id is followed by its meaning in brackets: `R-2 (the file name's date)`, unless the
//     Foreman already wrote one there;
//   - in a question an id is a button: it opens the id's words under the question, with `Open in
//     Findings` (the reader, beside the decision); a second click, or Close, folds it. The decision
//     never moves out of view, so he answers where he read.
// Options (whole rows are their radio's label) and the ask show the meaning only.

import type { ReactNode } from 'react';
import { DECISIONS } from '../targets';
import type { ReaderTarget, RefMeaning } from '../types';

const ID = /\b(?:R|FR|NFR|AC|D|Q|TC|US)-\d{1,4}\b/g;
const GIST_MAX = 56;

/** The meaning in brackets: short, and lower-case unless it starts with a name or an acronym (`FR-003`, `CSV`). */
export function gistOf(title: string): string {
  const t = /^[A-Z][a-z]/.test(title) ? `${title[0].toLowerCase()}${title.slice(1)}` : title;
  return t.length > GIST_MAX ? `${t.slice(0, GIST_MAX - 1).trimEnd()}…` : t;
}

/** Where an id's words live, for `Open in …`. */
export function refTarget(r: RefMeaning): ReaderTarget {
  if (r.where.kind === 'decisions') return DECISIONS;
  if (r.where.kind === 'findings') return { kind: 'findings', id: 'findings' };
  return { kind: 'doc', id: r.where.id };
}

export interface RefTextProps {
  text: string;
  refs: Record<string, RefMeaning> | null | undefined;
  /** The id whose words are open (its button reads pressed). */
  open?: string | null;
  /** Ids are buttons that open their words (a question); without it they are plain (an option, the ask). */
  onPick?(id: string): void;
  /** The ids mentioned higher up in the same card (firstMentions): an id's meaning shows at its first mention only. */
  told?: ReadonlySet<string>;
}

/**
 * For texts in reading order, the ids each one's earlier texts mention, so RefText explains an id at its
 * first mention only (pure: the same answer on every draw).
 */
export function firstMentions(texts: readonly string[]): ReadonlySet<string>[] {
  const seen = new Set<string>();
  return texts.map((t) => {
    const before = new Set(seen);
    for (const m of t.matchAll(ID)) seen.add(m[0]);
    return before;
  });
}

export function RefText({ text, refs, open = null, onPick, told }: RefTextProps) {
  if (!refs) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(ID)) {
    const id = m[0];
    const r = refs[id];
    const start = m.index ?? 0;
    if (!r) continue;
    parts.push(text.slice(at, start));
    at = start + id.length;
    parts.push(onPick ? (
      <button
        key={`b${start}`}
        type="button"
        className={`jp2-ref${open === id ? ' is-open' : ''}`}
        aria-expanded={open === id}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPick(id); }}
        title={`What ${id} says, here under the question.`}
      >
        {id}
      </button>
    ) : <span key={`i${start}`} className="jp2-ref-id">{id}</span>);
    // The Foreman wrote its meaning already: `R-2 (the date)`.
    const already = told?.has(id) || text.slice(0, start).includes(id);
    if (r.title && !already && !/^\s*\(/.test(text.slice(at))) parts.push(<span key={`g${start}`} className="jp2-ref-gist">{` (${gistOf(r.title)})`}</span>);
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

export interface RefOpenProps {
  meaning: RefMeaning;
  onOpen?(t: ReaderTarget, from?: HTMLElement | null): void;
  /** Fold the words; `from` is the control pressed (Close). */
  onClose(from: HTMLElement): void;
}

/** An id's words, under the question that mentions it. */
export function RefOpen({ meaning: r, onOpen, onClose }: RefOpenProps) {
  return (
    <div className="jp2-ref-open" role="note" aria-label={r.id}>
      <p className="jp2-ref-says"><b>{r.id}</b> {r.text}</p>
      <p className="jp2-ref-acts">
        {onOpen && (
          <button type="button" className="link-button" onClick={(e) => onOpen(refTarget(r), e.currentTarget)} title={`Show ${r.where.name} in the reader, beside this decision.`}>
            {`Open in ${r.where.name}`}
          </button>
        )}
        <button type="button" className="link-button" onClick={(e) => onClose(e.currentTarget)} title="Fold these words (key: Esc).">Close</button>
      </p>
    </div>
  );
}
