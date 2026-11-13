// Your move, as the frame draws it (Task 7): the label and the ask, from the snapshot row on the
// first paint (the same words the payload brings: waitingFor, waitingSince, headline) and from the
// payload's move after. Task 9 builds the card in full (options, Go, Send back, a permission).
// A permission's or a question's ask has no text in the snapshot row, so on a cold open the row's
// headline shows until the payload brings the move's own words.

import { memo } from 'react';
import type { Job } from '../../api/types';
import { useJob } from '../useJob';
import { STATE_WORDS, stateFromRow } from './Header';

/** A time as "Fri 12:06 PM" (the reader's title rows use it too). */
export function sinceWords(at: string | null | undefined): string | null {
  if (!at) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export const YourMove = memo(function YourMove({ job }: { job: Job | null }) {
  const move = useJob((s) => s.payload?.move);
  const state = useJob((s) => s.payload?.state);
  const line = useJob((s) => s.payload?.stateLine);
  if (move === undefined) {
    // Before the payload: the snapshot row's words.
    if (!job) return <div className="jp2-ym" />;
    const st = stateFromRow(job);
    if (st === 'needs-you') return <div className="jp2-ym"><Card label={moveLabel(job.waitingFor === 'permission', job.waitingSince)} ask={job.headline || job.laneReason || 'This job waits for you.'} /></div>;
    return <div className="jp2-ym"><p className="jp2-ym-one">{STATE_WORDS[st]}{job.laneReason ? ` · ${job.laneReason}` : ''}</p></div>;
  }
  if (move) {
    const ask = move.kind === 'permission' ? move.what : move.ask;
    return <div className="jp2-ym"><Card label={moveLabel(move.kind === 'permission', move.since)} ask={ask} /></div>;
  }
  return <div className="jp2-ym"><p className="jp2-ym-one">{state ? STATE_WORDS[state] : ''}{line ? ` · ${line}` : ''}</p></div>;
});

/** Your move's label, the same from the snapshot row (waitingFor, waitingSince) and from the payload, so it does not change when the payload lands. */
function moveLabel(permission: boolean, at: string | null | undefined): string {
  const since = sinceWords(at);
  return `Needs you${permission ? ' · permission' : ''}${since ? ` · since ${since}` : ''}`;
}

function Card({ label, ask }: { label: string; ask: string }) {
  return (
    <div className="jp2-card">
      <p className="jp2-card-label">{label}</p>
      <p className="jp2-card-ask">{ask}</p>
    </div>
  );
}
