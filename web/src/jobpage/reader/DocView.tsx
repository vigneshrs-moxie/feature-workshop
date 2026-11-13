// A document in the reader (job page rebuild, Task 12; design brief "The reader"): a spec, a plan, a
// review, a test report. The same typography as a message (Prose.tsx), `Key points` first when it has
// them, and an outline of its headings at the right edge when the reader is wide enough (a container
// query on the reader's body, jobpage.css: no measuring, no redraw when the window changes). A click
// on an outline line moves the reading place to that heading at once.

import type { ReaderTarget } from '../types';
import { goTo, prepareDoc, Prose, type Prepared } from './Prose';
import { NotLoaded, ReaderBody, useBody } from './ReaderBody';

export interface DocViewProps {
  id: string;
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

export function DocView({ id, onOpen }: DocViewProps) {
  const { body, error } = useBody(id);
  return (
    <ReaderBody view="doc" place={`doc:${id}`} ready={body !== null}>
      {body ? <DocLayout prepared={prepareDoc(body)} base={id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : ''} onOpen={onOpen} /> : <NotLoaded error={error} />}
    </ReaderBody>
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
