// The reader, the right pane (job page rebuild, Task 12; plan "Decisions already made" 2, design brief
// "The reader"): it shows exactly one thing, under the same thin title row (TitleRow.tsx). What it
// shows is targets.ts readerOf: his pick, else the opened step's main output, else the payload's `open`.
//
// Views: a message or a brief (MessageView), a document (DocView), Ticket and goal (TicketView),
// Decisions (DecisionsView), a step with nothing written yet (NotYet), the conversation (its lines;
// Task 13 makes it ConversationView). Changes, findings, checks and recording, the walkthrough, Ship, a
// PR and Details come with Tasks 14 and 20.
//
// Each view is drawn fresh for each thing read (keyed by it) inside ReaderBody, which keeps every
// thing's own scroll place. A body held in the store paints in the same frame as the pick; one not held
// shows the title row at once and its words when they land (speed rules 2 and 3).

import { memo, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { sinceWords } from '../left/YourMove';
import { readerOf, sameTarget } from '../targets';
import type { ReaderTarget } from '../types';
import { useJob } from '../useJob';
import { DecisionsView } from './DecisionsView';
import { DocView } from './DocView';
import { MessageView } from './MessageView';
import { ReaderBody } from './ReaderBody';
import { TicketView } from './TicketView';
import { placeKey, TitleRow } from './TitleRow';

export interface ReaderProps {
  /** The job's title from the Jobs row, for the title row before the payload names a target. */
  fallback: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  /** The page's own pick (the address follows; under 1100 px the reader stays over the left pane). */
  onOpen(t: ReaderTarget, from?: HTMLElement | null): void;
}

export const Reader = memo(function Reader({ fallback, searchRef, onOpen }: ReaderProps) {
  const target = useJob(readerOf, sameTarget);
  return (
    <>
      <TitleRow target={target} fallback={fallback} onOpen={onOpen} />
      {target ? <View key={placeKey(target)} target={target} searchRef={searchRef} onOpen={onOpen} /> : <div className="jp2-rv-body" />}
    </>
  );
});

function View({ target, searchRef, onOpen }: { target: ReaderTarget } & Pick<ReaderProps, 'searchRef' | 'onOpen'>) {
  switch (target.kind) {
    case 'message':
    case 'brief':
      return <MessageView target={target} onOpen={onOpen} />;
    case 'doc':
      return <DocView id={target.id} onOpen={onOpen} />;
    case 'ticket':
      return <TicketView onOpen={onOpen} />;
    case 'decisions':
      return <DecisionsView />;
    case 'conversation':
      return <ConversationFrame searchRef={searchRef} />;
    case 'not-yet':
      return <ReaderBody view="not-yet" place={placeKey(target)}><NotYet id={target.id} /></ReaderBody>;
    default:
      return <ReaderBody view={target.kind} place={placeKey(target)}><p className="jp2-dim">This view comes in a later build of the new page.</p></ReaderBody>;
  }
}

/** A step that has written nothing (yet): what it is doing, said plainly. */
function NotYet({ id }: { id: string }) {
  const state = useJob((s) => s.payload?.steps.find((x) => x.id === id)?.state ?? null);
  const words = state === 'skipped' ? 'This job skips this step.'
    : state === 'current' ? 'Nothing written yet. The Foreman is on this step.'
      : state === 'done' ? 'This step wrote no document.'
        : 'Nothing yet. This step has not started.';
  return <p className="jp2-notyet">{words}</p>;
}

/** The conversation's lines, one each, with a filter (Task 13 groups and opens them). */
function ConversationFrame({ searchRef }: { searchRef: React.RefObject<HTMLInputElement | null> }) {
  const thread = useJob((s) => s.payload?.thread ?? null);
  const [words, setWords] = useState('');
  const shown = useMemo(() => {
    const all = (thread ?? []).filter((l) => l.kind !== 'small');
    const q = words.trim().toLowerCase();
    return q ? all.filter((l) => l.headline.toLowerCase().includes(q)) : all;
  }, [thread, words]);
  return (
    <>
      <div className="jp2-cv-tools">
        <label className="jp2-cv-sbox">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            className="jp2-cv-search"
            type="search"
            aria-label="Search the conversation"
            placeholder="Search the conversation"
            value={words}
            onChange={(e) => setWords(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && words) { e.stopPropagation(); setWords(''); } }}
          />
        </label>
        {thread && <span className="jp2-dim jp2-cv-count">{shown.length} shown</span>}
      </div>
      <ReaderBody view="conversation" place="conversation:conversation" className="jp2-cv-body">
        <ul className="jp2-cv-lines">
          {shown.map((l) => (
            <li key={l.id} className={`jp2-cv-line${l.mine ? ' is-you' : ''}`}>
              <span className="jp2-cv-h">{l.headline}</span>
              {l.at && <time className="jp2-dim" dateTime={l.at}>{sinceWords(l.at)}</time>}
            </li>
          ))}
        </ul>
      </ReaderBody>
    </>
  );
}
