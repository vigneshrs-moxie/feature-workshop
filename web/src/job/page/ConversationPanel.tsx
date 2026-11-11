// The job page's conversation (design 3.4): a full-height panel with the whole conversation, newest
// at the bottom (no Earlier fold), and the message box at its foot. Widen gives it the full page and
// Back to the job gives it back; nothing in it is drawn again from scratch for that, so what you are
// typing stays. `full` is the phone's and the narrow window's whole-screen form: its head counts the
// messages new since your last look, with the new line above the first of them. Permission cards
// are not drawn here: they stay on the bar. What sits above the full form is the page's.
//
// The panel owns its scroll area: it opens at its end and follows new messages there unless you are
// more than 96 px above the end; Load older keeps the message you were reading where it was. While
// it is on screen it remembers the newest message's time as your last look (sb.convo.seen.<slug>).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Job, ThreadItem } from '../../api/types';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { readStored, writeStored } from '../../lib/stored';
import { Composer } from '../../panes/Foreman/Composer';
import { isNewSince, ThreadList, useJobConversation } from '../../panes/Foreman/ForemanPane';
import { shownItems } from '../../panes/Foreman/thread';
import { useWorkshopState } from '../../state/store';
import { foremanModel } from './foremanModel';
import './page.css';

type Conversation = ReturnType<typeof useJobConversation>;

/** Where your last look at a job's conversation is kept: the newest message's time then. */
export const seenKey = (slug: string) => `sb.convo.seen.${slug}`;

/** The messages newer than your last look that are not yours (none when you never looked). */
export function newCount(items: ThreadItem[], seenAt: string | null): number {
  return items.filter((it) => isNewSince(it, seenAt)).length;
}

/** The newest message's time, or null when no message has one. */
function newestAt(items: ThreadItem[]): string | null {
  let best: string | null = null;
  let bestT = -Infinity;
  for (const it of items) {
    const t = it.at ? Date.parse(it.at) : NaN;
    if (Number.isFinite(t) && t > bestT) { bestT = t; best = it.at; }
  }
  return best;
}

const messagesWords = (n: number) => `${n} ${n === 1 ? 'message' : 'messages'}`;

/** Within this of the end, you are at the end: new messages keep you there. */
const AT_END = 96;

/**
 * The scroll area's rules: open at the end; follow new messages while you are at the end; keep the
 * message you were reading in place when older ones arrive above it (Load older). The browser's own
 * scroll anchoring is off for it (page.css), so only this moves it.
 */
function useConvoScroll(items: ThreadItem[]) {
  const listRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const height = useRef(0);
  const first = useRef<string | null>(null);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_END;
    height.current = el.scrollHeight;
  };

  // After every render, before it is painted: a new message, your steered one, the live row.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const was = first.current;
    const firstId = items[0]?.id ?? null;
    // Older messages came in above: the old first one is still there, no longer first.
    const above = was !== null && firstId !== was && items.some((it) => it.id === was);
    if (above) el.scrollTop += el.scrollHeight - height.current;
    else if (atEnd.current) el.scrollTop = el.scrollHeight;
    first.current = firstId;
    height.current = el.scrollHeight;
  });

  // Something in it changed size (a brief's text came in, the live row, a card folding): at the end,
  // it stays at the end.
  useEffect(() => {
    const el = listRef.current;
    const body = bodyRef.current;
    if (!el || !body || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => {
      if (atEnd.current) el.scrollTop = el.scrollHeight;
      height.current = el.scrollHeight;
    });
    watch.observe(body);
    return () => watch.disconnect();
  }, []);

  return { listRef, bodyRef, onScroll };
}

export function ConversationPanel({ job, conversation, now, wide, onWide, full = false }: {
  job: Job; conversation: Conversation; now: Date;
  /** The panel has the full page. */
  wide: boolean;
  /** Widen (true) or Back to the job (false). */
  onWide(on: boolean): void;
  /** The phone's and the narrow window's whole-screen form. */
  full?: boolean;
}) {
  const { thread, run } = conversation;
  const state = useWorkshopState();
  const items = thread.items;
  const count = shownItems(items).length;
  const key = seenKey(job.slug);
  // Your last look before this view: the new line and count stay put while you read.
  const [lastLook] = useState(() => readStored(key));
  const fresh = newCount(items, lastLook);

  // On screen: the newest message is seen.
  const newest = newestAt(items);
  useEffect(() => {
    if (!newest) return;
    // Only ever forward (an unreadable one is replaced).
    if (!(Date.parse(readStored(key) ?? '') >= Date.parse(newest))) writeStored(key, newest);
  }, [key, newest]);

  const { listRef, bodyRef, onScroll } = useConvoScroll(items);
  const modelLine = foremanModel(thread.detail, state.meta?.models);

  return (
    <section className={`sb-convo${wide ? ' is-wide' : ''}${full ? ' is-full' : ''}`} aria-label="Conversation">
      <header className="sb-convo-head">
        {full ? (
          <>
            <h2 className="sb-convo-title">Conversation</h2>
            <p className="sb-convo-count">{messagesWords(count)}{fresh > 0 && ` · ${fresh} new`}</p>
          </>
        ) : (
          <>
            <Icon name="message" size={16} />
            <h3>Conversation</h3>{' '}
            {count > 0 && <span className="muted">· {messagesWords(count)}</span>}
            <span className="sb-convo-spacer" />
            <Button
              kind="quiet"
              size="sm"
              onClick={() => onWide(!wide)}
              title={wide ? 'Give the page back to the job: its steps beside the conversation.' : 'Give the conversation the full page.'}
            >
              {wide ? 'Back to the job' : 'Widen'}
            </Button>
          </>
        )}
      </header>
      <div ref={listRef} className="sb-convo-list" onScroll={onScroll}>
        <div ref={bodyRef} className="sb-convo-body">
          {!full && <p className="sb-convo-line">The whole conversation, newest at the bottom</p>}
          <ThreadList job={job} conversation={conversation} now={now} cards={false} newFrom={full ? lastLook : undefined} />
        </div>
      </div>
      <div className="sb-convo-foot">
        <Composer key={job.slug} slug={job.slug} detail={thread.detail} run={run} modelLine={modelLine} />
      </div>
    </section>
  );
}
