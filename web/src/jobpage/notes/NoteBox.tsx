// The note box (R4, Task 17): it opens in place, under the block he pointed at (or by the pin he
// dropped), and on the phone as a sheet at the foot of the screen. It names the place and the words
// pointed at, then three calls:
//   - `Change`: what he types is the change (Enter in the field is Change; with nothing typed the
//     field asks for the words and nothing is added);
//   - `Drop this`: no typing;
//   - `Explain`: no typing; it asks the Foreman at once (Pointable.tsx sends it).
// On a picture the box has one call, `Add the note`, which needs words. Escape or × closes it and
// nothing is added. Words typed here stay while the job changes under it (the box holds them itself).

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../components/Button';

export type NoteCall = 'change' | 'drop' | 'explain';

export interface NoteBoxProps {
  /** The place as the Foreman will read it. */
  place: string;
  /** The words pointed at (shown on two lines at most). */
  quote: string | null;
  /** A pin on a picture: one call, Add the note. */
  pin?: boolean;
  /** The phone: a sheet at the foot of the screen. */
  sheet?: boolean;
  /** Where it sits in the reader (px in its scroll area); none in a sheet. */
  at?: { top: number; left: number } | null;
  onNote(call: NoteCall, words: string): void;
  onClose(): void;
}

const NEED_CHANGE = 'Write what should change, then press Change.';
const NEED_PIN = 'Write what is wrong here, then press Add the note.';

export function NoteBox({ place, quote, pin = false, sheet = false, at = null, onNote, onClose }: NoteBoxProps) {
  const [words, setWords] = useState('');
  const [need, setNeed] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const id = useId();
  // The cursor goes to the field without scrolling the reader (nothing moves he did not move).
  useEffect(() => { field.current?.focus({ preventScroll: true }); }, []);

  const call = (c: NoteCall) => {
    const w = words.trim();
    if (c === 'change' && !w) {
      setNeed(pin ? NEED_PIN : NEED_CHANGE);
      field.current?.focus({ preventScroll: true });
      return;
    }
    onNote(c, w);
  };
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === 'Enter' && e.target === field.current && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); call('change'); }
  }

  const box = (
    <div
      className={`jp2-nb${sheet ? ' is-sheet' : ''}`}
      role="dialog"
      aria-label="A note on this place"
      aria-describedby={`${id}-place`}
      data-pt-skip=""
      style={at && !sheet ? { top: at.top, left: at.left } : undefined}
      onKeyDown={onKeyDown}
    >
      <p className="jp2-nb-place" id={`${id}-place`}>{place}</p>
      {quote && <p className="jp2-nb-q">“{quote}”</p>}
      <input
        ref={field}
        type="text"
        className={`text-input jp2-nb-in${need ? ' is-need' : ''}`}
        aria-label={pin ? 'What is wrong here' : 'What should change'}
        aria-invalid={need ? true : undefined}
        placeholder={pin ? 'What is wrong here?' : 'What should change?'}
        value={words}
        onChange={(e) => { setWords(e.target.value); if (need) setNeed(null); }}
      />
      {need && <p className="jp2-nb-need" role="alert">{need}</p>}
      <div className="jp2-nb-acts">
        {pin ? (
          <Button kind="primary" size="sm" onClick={() => call('change')} title="Add this pin and its note to the notes in the message box. Nothing is sent yet.">Add the note</Button>
        ) : (
          <>
            <Button kind="primary" size="sm" onClick={() => call('change')} title="Add a note asking for this change. It waits in the message box with your other notes until you send them.">Change</Button>
            <Button size="sm" onClick={() => call('drop')} title="Add a note to take this out. It waits in the message box with your other notes until you send them.">Drop this</Button>
            <Button size="sm" onClick={() => call('explain')} title="Ask the Foreman to explain this, now. It changes nothing; the answer opens beside it.">Explain</Button>
          </>
        )}
        <Button kind="quiet" size="sm" icon="x" iconOnly className="jp2-nb-x" aria-label="Close the note without adding it" title="Close (Esc). Nothing is added." onClick={onClose} />
      </div>
    </div>
  );
  if (!sheet) return box;
  return (
    <div className="jp2-nb-sheet" data-pt-skip="">
      <div className="jp2-nb-scrim" aria-hidden="true" onClick={onClose} />
      {box}
    </div>
  );
}
