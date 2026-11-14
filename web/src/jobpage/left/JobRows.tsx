// The job's four rows (job page rebuild, Task 10; design brief "Left pane" 3): `Ticket and goal`,
// `Conversation · 52 · 1 new`, `Decisions · 13 made for you`, `Details`. Each opens its view in the
// reader and is marked while the reader shows it (on the phone each ends in a ›: the reader is a screen).
//
// "New" is counted here, not on the server (interfaces correction 4): the lines newer than his last
// look at the conversation that are not his own. His last look is the browser's
// `sb.convo.seen.<slug>` (the old page's key, job/page/ConversationPanel.tsx seenKey, so the two
// agree); the conversation moves it on, and the count follows at once (lib/stored.ts).

import { memo, useMemo } from 'react';
import { useStored } from '../../lib/stored';
import { CONVERSATION, DECISIONS, DETAILS, readerOf, sameTarget, TICKET } from '../targets';
import type { ReaderTarget, ThreadLine } from '../types';
import { useJob } from '../useJob';
import { PhoneChevron } from '../phone/PhoneJob2';

/** Where his last look at a job's conversation is kept: the newest line's time then. */
export const seenKey = (slug: string) => `sb.convo.seen.${slug}`;

/**
 * The lines newer than his last look that are not his (panes/Foreman/thread.ts isNewSince's rule).
 * Never looked (null), an unreadable look, or a line with no time: not new.
 */
export function freshCount(thread: readonly ThreadLine[], seenAt: string | null): number {
  const seen = seenAt ? Date.parse(seenAt) : NaN;
  if (!Number.isFinite(seen)) return 0;
  let n = 0;
  for (const l of thread) {
    if (l.mine || !l.at) continue;
    const t = Date.parse(l.at);
    if (Number.isFinite(t) && t > seen) n++;
  }
  return n;
}

export interface JobRowsProps {
  /** The left pane's keyboard line (j k), by its place in the lines. */
  cursor: number | null;
  /** The place of the first row among the left pane's lines (after the steps). */
  first: number;
  onOpen(t: ReaderTarget, from: HTMLElement): void;
}

export const JobRows = memo(function JobRows({ cursor, first, onOpen }: JobRowsProps) {
  const slug = useJob((s) => s.slug);
  const target = useJob(readerOf, sameTarget);
  const convo = useJob((s) => s.payload?.rows.conversation ?? null);
  const decided = useJob((s) => s.payload?.rows.decisions.count ?? null);
  const thread = useJob((s) => s.payload?.thread ?? null);
  const [seenAt] = useStored(seenKey(slug));
  const fresh = useMemo(() => (thread ? freshCount(thread, seenAt) : 0), [thread, seenAt]);

  const count = convo && convo.count > 0 ? `${convo.count}${convo.more ? '+' : ''}` : null;
  const rows: { t: ReaderTarget; name: string; more: string | null; fresh?: string | null }[] = [
    { t: TICKET, name: 'Ticket and goal', more: null },
    { t: CONVERSATION, name: 'Conversation', more: count, fresh: count && fresh > 0 ? `${fresh} new` : null },
    { t: DECISIONS, name: 'Decisions', more: decided ? `${decided} made for you` : null },
    { t: DETAILS, name: 'Details', more: null },
  ];
  return (
    <div className="jp2-jrs" role="group" aria-label="The job">
      {rows.map((r, i) => {
        const label = [r.name, r.more, r.fresh].filter(Boolean).join(' · ');
        return (
          <button
            key={r.t.kind}
            type="button"
            className={`jp2-row jp2-jr${target?.kind === r.t.kind ? ' is-sel' : ''}${cursor === first + i ? ' is-cursor' : ''}`}
            data-jp-line={first + i}
            aria-label={r.more ? label : undefined}
            onClick={(e) => onOpen(r.t, e.currentTarget)}
          >
            {r.name}
            {/* What is new right after the name, the count at the row's end: neither moves the other (speed rule 3). */}
            {r.fresh && <span className="jp2-jr-new">{r.fresh}</span>}
            {r.more && <span className="jp2-jr-more">{r.more}</span>}
            <PhoneChevron />
          </button>
        );
      })}
    </div>
  );
});
