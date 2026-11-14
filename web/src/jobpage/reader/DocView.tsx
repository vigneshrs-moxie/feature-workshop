// A document in the reader (job page rebuild, Task 12; design brief "The reader"): a spec, a plan, a
// review, a test report. The same typography as a message (Prose.tsx), `Key points` first when it has
// them, and an outline of its headings at the right edge when the reader is wide enough (a container
// query on the reader's body, jobpage.css: no measuring, no redraw when the window changes). A click
// on an outline line moves the reading place to that heading at once.
//
// What changed since vN (Task 18, R5): when the title row's `What changed since v2` is pressed, the
// reader shows the document's lines with the ones added and removed since its newest older version
// marked (reader/docDiff.ts, worked out on the page).

import { useMemo } from 'react';
import '../answers.css';
import type { JobBody, ReaderTarget } from '../types';
import { useJob, useJobStore } from '../useJob';
import { lineDiff, newestOlder, useShowChanges } from './docDiff';
import { goTo, prepareDoc, Prose, type Prepared } from './Prose';
import { NotLoaded, ReaderBody, useBody } from './ReaderBody';

export interface DocViewProps {
  id: string;
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

type Older = { n: string; id: string } | null;
const sameOlder = (a: Older, b: Older) => a === b || (!!a && !!b && a.n === b.n && a.id === b.id);

export function DocView({ id, onOpen }: DocViewProps) {
  const store = useJobStore();
  const { body, error } = useBody(id);
  const older = useJob((s) => newestOlder(s.payload, id), sameOlder);
  const changes = useShowChanges(store, id) && older !== null;
  return (
    <ReaderBody view="doc" place={`doc:${id}`} ready={body !== null}>
      {!body ? <NotLoaded error={error} />
        : changes && older ? <DocChanges now={body} older={older} />
          : <DocLayout prepared={prepareDoc(body)} base={id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : ''} onOpen={onOpen} />}
    </ReaderBody>
  );
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The document's lines, the ones added (ins) and removed (del) since its newest older version marked. */
function DocChanges({ now, older }: { now: JobBody; older: NonNullable<Older> }) {
  const { body: before, error } = useBody(older.id);
  const lines = useMemo(() => (before ? lineDiff(before.text ?? '', now.text ?? '') : null), [before, now]);
  if (!lines) return error ? <NotLoaded error={error} /> : <p className="jp2-dim" role="status">Reading v{older.n}…</p>;
  const added = lines.filter((l) => l.kind === 'add').length;
  const removed = lines.filter((l) => l.kind === 'del').length;
  return (
    <div className="jp2-dd">
      <p className="jp2-dd-sum">Since v{older.n}: {plural(added, 'line')} added, {removed} removed</p>
      <div className="jp2-dd-ls">
        {lines.map((l, i) => (l.kind === 'add' ? <ins key={i} className="jp2-dd-l is-add">{l.text}</ins>
          : l.kind === 'del' ? <del key={i} className="jp2-dd-l is-del">{l.text}</del>
            : <div key={i} className="jp2-dd-l">{l.text}</div>))}
      </div>
    </div>
  );
}

/** The words, and beside them (when there is room) the outline of their headings. */
export function DocLayout({ prepared, base = '', onOpen }: { prepared: Prepared; base?: string; onOpen?: DocViewProps['onOpen'] }) {
  return (
    <div className="jp2-doc">
      <Prose prepared={prepared} base={base} onOpen={onOpen} />
      {prepared.outline.length >= 2 && (
        <nav className="jp2-doc-ol" aria-label="On this page">
          <p className="jp2-ol-t" aria-hidden="true">On this page</p>
          {prepared.outline.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`jp2-ol-i is-l${h.level}`}
              onClick={(e) => {
                const at = e.currentTarget.closest('.jp2-doc')?.querySelector<HTMLElement>(`#${CSS.escape(h.id)}`);
                if (at) goTo(at);
              }}
            >
              {h.text}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
