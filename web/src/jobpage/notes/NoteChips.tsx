// The notes waiting in the message box (R4, Task 17): one chip per note, above the box. A chip's
// click opens its place in the reader (the view, then the block flashed; Pointable.tsx and Pins.tsx
// answer the seek); `×` removes it. A chip whose block a newer version removed says so (`Not in Spec
// v4`) and stays. `Show what will be sent` shows the exact text the next Send, Send back or Go carries
// (notes/chips.ts composeFor: the server's own composeNotes), his words in the box included.
// The notes are kept in this browser (jobStore notesKey), so a reload finds them.

import { memo, useEffect, useId, useState } from 'react';
import type { PageNote } from '../jobStore';
import type { ReaderTarget } from '../types';
import { useJob, useJobStore } from '../useJob';
import { bodyToRead, chipWords, composeFor, goneFrom } from './chips';
import { useExplainAnswers } from './Pointable';

export interface NoteChipsProps {
  onOpen?(t: ReaderTarget, from?: HTMLElement | null): void;
}

export const NoteChips = memo(function NoteChips({ onOpen }: NoteChipsProps) {
  const store = useJobStore();
  const notes = useJob((s) => s.ui.notes);
  // Explains' answers are read here, so they land wherever he is on the page.
  useExplainAnswers();
  const [shown, setShown] = useState(false);
  const id = useId();
  useEffect(() => { if (!notes.length) setShown(false); }, [notes.length]);
  if (!notes.length) return null;
  return (
    <div className="jp2-chips">
      <ul className="jp2-chips-in" aria-label={`Notes to send · ${notes.length}`}>
        {notes.map((n) => <Chip key={n.n} n={n} onOpen={onOpen} onRemove={() => store.setNotes(store.getState().ui.notes.filter((x) => x.n !== n.n))} />)}
      </ul>
      <div className="jp2-chips-f">
        <button type="button" className="link-button" aria-expanded={shown} aria-controls={`${id}-wws`} onClick={() => setShown((v) => !v)}>
          {shown ? 'Hide what will be sent' : 'Show what will be sent'}
        </button>
      </div>
      {shown && <Sent id={`${id}-wws`} notes={notes} />}
    </div>
  );
});

/** The exact text, his words in the box after the block. */
function Sent({ id, notes }: { id: string; notes: PageNote[] }) {
  const draft = useJob((s) => s.ui.draft);
  return (
    <div className="jp2-wws" id={id} role="region" aria-label="What will be sent">
      <pre className="jp2-wws-t">{composeFor(notes, draft)}</pre>
    </div>
  );
}

const Chip = memo(function Chip({ n, onOpen, onRemove }: { n: PageNote; onOpen?: NoteChipsProps['onOpen']; onRemove(): void }) {
  const store = useJobStore();
  const gone = useJob((s) => (s.payload ? goneFrom(n, s.payload, s.bodies) : null));
  const toRead = useJob((s) => (s.payload ? bodyToRead(n, s.payload) : null));
  const held = useJob((s) => (toRead ? Boolean(s.bodies[toRead]) : true));
  // Its document has a newer version: read it, to tell whether the block is still there.
  useEffect(() => { if (toRead && !held) void store.loadBody(toRead); }, [store, toRead, held]);
  const words = chipWords(n);
  return (
    <li className={`jp2-chip${gone ? ' is-gone' : ''}`}>
      <button
        type="button"
        className="jp2-chip-l"
        title={`${n.place}${n.note ? `: ${n.note}` : ''}${gone ? ` (${gone})` : ''}. Click to show it.`}
        disabled={!n.target}
        onClick={(e) => {
          if (!n.target) return;
          onOpen?.(n.target, e.currentTarget);
          store.setSeek(n.n);
        }}
      >
        {words}
        {gone && <span className="jp2-chip-gone"> · {gone}</span>}
      </button>
      <button type="button" className="jp2-chip-x" aria-label={`Remove the note: ${words}`} title="Remove this note" onClick={onRemove}>×</button>
    </li>
  );
});
