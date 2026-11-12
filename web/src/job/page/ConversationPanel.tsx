// The job page's conversation (design 3.4): a full-height panel with the whole conversation, newest
// at the bottom (no Earlier fold), and the message box at its foot. Widen gives it the full page and
// Back to the job gives it back; nothing in it is drawn again from scratch for that, so what you are
// typing stays. `full` is the phone's and the narrow window's whole-screen form: its head counts the
// messages new since your last look, with the new line above the first of them. Permission cards
// are not drawn here: they stay on the bar. What sits above the full form is the page's.
//
// The panel owns its scroll area: it opens at its end and follows new messages there (and stays there
// when the message box at its foot grows) unless you are more than 96 px above the end; Load older
// keeps the message you were reading where it was. While you can see it (the page is in front and
// the panel has a size) it remembers the newest message's time as your last look
// (sb.convo.seen.<slug>). The full form's "· N new" counts from your last look before this view, so
// it still rises for messages that arrive while you read. Another job starts the panel afresh.
//
// Its parent must have a set height (the page's column); otherwise the page scrolls, not the list,
// and none of the scroll rules can work.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Job, ThreadItem } from '../../api/types';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { readStored, writeStored } from '../../lib/stored';
import { Composer } from '../../panes/Foreman/Composer';
import { ThreadList, useJobConversation } from '../../panes/Foreman/ForemanPane';
import { isNewSince, shownItems } from '../../panes/Foreman/thread';
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
  /** Also told when the list or its content changes size (it may have just been shown). */
  const onResize = useRef<(() => void) | null>(null);
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
    if (above) {
      el.scrollTop += el.scrollHeight - height.current;
      // You are reading the older ones now: only when that is also the very end does it follow.
      atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 0;
    } else if (atEnd.current && el.scrollHeight !== height.current) {
      // Only when something came in: a render that changed nothing never moves you.
      el.scrollTop = el.scrollHeight;
    }
    first.current = firstId;
    height.current = el.scrollHeight;
  });

  // Something in it changed size (a brief's text came in, the live row, a card folding), or its
  // window did (the message box at the foot grew or shrank): at the end, it stays at the end.
  useEffect(() => {
    const el = listRef.current;
    const body = bodyRef.current;
    if (!el || !body || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => {
      if (atEnd.current) el.scrollTop = el.scrollHeight;
      height.current = el.scrollHeight;
      onResize.current?.();
    });
    watch.observe(body);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return { listRef, bodyRef, onScroll, onResize };
}

interface PanelProps {
  job: Job; conversation: Conversation; now: Date;
  /** The panel has the full page. */
  wide: boolean;
  /** Widen (true) or Back to the job (false). */
  onWide(on: boolean): void;
  /** The phone's and the narrow window's whole-screen form. */
  full?: boolean;
}

/** The conversation panel. Its parent must have a set height (see the head of this file). */
export function ConversationPanel(props: PanelProps) {
  // Each job its own: its last look, where its list was, its message box.
  return <JobConversation key={props.job.slug} {...props} />;
}

function JobConversation({ job, conversation, now, wide, onWide, full = false }: PanelProps) {
  const { thread, run } = conversation;
  const state = useWorkshopState();
  const items = thread.items;
  const count = shownItems(items).length;
  const key = seenKey(job.slug);
  // Your last look before this view: the new line and count stay put while you read. The job page
  // keeps the panel mounted and only shows or hides it, so each time the full form opens it is a new
  // view: read the last look again then (the column at 1100 px and up shows neither).
  const [lastLook, setLastLook] = useState(() => readStored(key));
  const [lookFor, setLookFor] = useState(full);
  if (lookFor !== full) {
    setLookFor(full);
    if (full) setLastLook(readStored(key));
  }
  const fresh = newCount(items, lastLook);

  const { listRef, bodyRef, onScroll, onResize } = useConvoScroll(items);

  // While you can see it (the page in front, the panel shown with a size), the newest message is seen.
  const newest = newestAt(items);
  const markSeen = useRef(() => {});
  markSeen.current = () => {
    if (!newest || document.visibilityState === 'hidden' || !listRef.current?.clientHeight) return;
    // Only ever forward (an unreadable one is replaced).
    if (!(Date.parse(readStored(key) ?? '') >= Date.parse(newest))) writeStored(key, newest);
  };
  useEffect(() => { markSeen.current(); }, [key, newest]);
  useEffect(() => {
    const look = () => markSeen.current();
    onResize.current = look;
    document.addEventListener('visibilitychange', look);
    return () => { document.removeEventListener('visibilitychange', look); onResize.current = null; };
  }, [onResize]);

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
