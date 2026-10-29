// The Desk (#/desk): every decision waiting for you, across all jobs, one at a time. Two layouts
// (Settings → Look → Desk layout): One at a time, the default (packet M): the dots, 1 of 3, the
// whole queue in a drawer; one console card with the job's seven stops, the headline, the brief
// behind Details (b), and the big calls Reply (c), No go: send back (r) and Go (a), which press
// the gate card's own Other guidance, Revise with feedback and Approve. Decided today folds below.
// Three columns, as the Desk was from 1200 px (plan §5): the queue on the left, oldest first; the current item in the middle, with
// the same card the job page shows (the gate card for a go-ahead or the Foreman's questions, the
// permission or question card) and the Foreman's brief open above it; on the right what you decided
// this session, the job's facts and where its work is. Under 1200 px the right column folds under
// the item. After the decisions come the hand-off nudges (home/nudges.ts): PR steps that wait on
// you or that the Foreman takes on when you say yes; those on jobs past your finish line sit under
// a quieter Shipping heading at the end, never first. Decide, and the next one opens.
//
// Keys (the 'desk' scope of app/keyRegistry.ts, which wins over the page's j and k; not while
// typing, not with a dialog open, and a held key never repeats):
//   j  next          k  previous          o  open the job, or a nudge's link     (↓ and ↑ too, in the queue)
//   a      approve (a gate's go-ahead, Allow once, or yes to a nudge): never for a hard line, a step
//          Claude Code flagged as risky, or a question (the Foreman's or the crew's: you answer those on the card)
//   d      deny a permission (opens its note), or put a nudge away
//   b      show or hide the brief
//   r      no go: send back (a go-ahead: the gate's Revise with feedback)
//   c      reply without deciding (a go-ahead: the gate's Other guidance; elsewhere c stays New job)
// After a decision the next item opens and its card takes the focus.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { Job } from '../api/types';
import { useKeyScope, type KeyId } from '../app/keyRegistry';
import { hrefFor, jobHref, navigate } from '../app/router';
import { Kbd, KeyLegend } from '../components/Kbd';
import { Icon } from '../components/Icon';
import { Fold, Hero } from '../components/page/Page';
import { StopMap } from '../components/stops/StopMap';
import { Card } from '../components/permissions/PendingCards';
import { fullTime, relativeTime } from '../lib/time';
import { GateSlot } from '../panes/Foreman/GateCard';
import { ServerHtml } from '../panes/Foreman/ServerHtml';
import { useJobThread } from '../panes/Foreman/useJobThread';
import { CrewMember } from '../play/CrewMember';
import { usePlayIfAny } from '../play/usePlay';
import { useWorkshop, useWorkshopState } from '../state/store';
import { jobHueStyle } from '../theme/hue';
import { ReviewDeskCard } from '../views/Review/ReviewDeskCard';
import { isRoundCard, ROUND_NUDGES, useReviewList } from '../views/Review/useReview';
import type { DeskItem } from './homeModel';
import { type DeskEntry, deskEntries, isShipping, jobFacts, type NudgeItem, nudgePath, oneKeyDecide, recordDecision, useDecidedToday, whereLine } from './nudges';

const DESK_KEYS: readonly KeyId[] = ['desk-next', 'desk-prev', 'desk-approve', 'desk-deny', 'desk-open', 'desk-brief'];

export type DeskLayout = 'one' | 'columns';
export const DESK_LAYOUT_KEY = 'gc.desk.layout';

/** A button's words without its key hint. */
function wordsOf(b: Element | null): string {
  if (!b) return '';
  const copy = b.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('kbd').forEach((k) => k.remove());
  return (copy.textContent ?? '').trim();
}
/** Dots for at most this many; the rest is a number. */
const DOTS = 9;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * One at a time: the go-ahead as a console. The gate card underneath keeps every rule (questions,
 * decisions made for you, a stale plan); its own row of buttons is hidden here, and the three big
 * calls press them. Go is off while the card asks a question: a never answers one.
 */
function DeskGateOne({ job, now, briefOpen, toggleBrief, call }: { job: Job; now: Date; briefOpen: boolean; toggleBrief(): void; call: boolean }) {
  const state = useWorkshopState();
  const thread = useJobThread(job.slug, (state.threadVersions[job.slug] ?? 0) + state.threadEpoch);
  const body = useRef<HTMLDivElement>(null);
  const [go, setGo] = useState({ words: '', off: true, asks: false });
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const read = () => {
      const b = el.querySelector<HTMLButtonElement>('[data-gate="approve"]');
      const next = { words: wordsOf(b), off: !b || b.disabled, asks: Boolean(el.querySelector('.gate-question')) };
      setGo((was) => (was.words === next.words && was.off === next.off && was.asks === next.asks ? was : next));
    };
    read();
    const watch = new MutationObserver(read);
    watch.observe(el, { subtree: true, childList: true, attributes: true, characterData: true });
    return () => watch.disconnect();
  }, [thread.detail]);
  if (thread.error) return <p className="perm-warn" role="alert">{thread.error}</p>;
  if (!thread.detail) return <p className="muted" role="status">Opening the Foreman’s brief…</p>;
  const brief = thread.detail.latestBrief as { html?: string; number?: number | null } | null | undefined;
  const press = (what: 'approve' | 'revise' | 'guidance') => body.current?.querySelector<HTMLButtonElement>(`[data-gate="${what}"]:not(:disabled)`)?.click();
  const gate = Boolean(thread.detail.gate);
  const goWords = go.words || 'Approve';
  return (
    <>
      <div className="desk-say">
        <span className="next-label">{call ? 'Go / no go' : 'Waiting for you'}</span>
        <h3 className="desk-head">{typeof job.headline === 'string' && job.headline ? job.headline : 'Waiting for your go-ahead'}</h3>
        {job.laneReason && <p className="desk-sub">{job.laneReason}</p>}
      </div>
      {brief?.html && (
        <section className={`fold desk-brief-fold${briefOpen ? '' : ' is-shut'}`} aria-label={`The Foreman’s brief${brief.number ? ` #${brief.number}` : ''}`}>
          <button type="button" className="fold-head" aria-expanded={briefOpen} onClick={toggleBrief} title={briefOpen ? 'Hide the Foreman’s brief (key: b).' : 'Read the Foreman’s brief in full (key: b).'}>
            <Icon name="file" size={16} />
            <span className="fold-name">The Foreman’s brief</span>
            <span className="muted">· <Kbd id="desk-brief" /></span>
            <span className="fold-show">{briefOpen ? 'Hide ▾' : 'Details ▸'}</span>
          </button>
          {briefOpen && <div className="fold-body"><ServerHtml html={brief.html} className="prose" /></div>}
        </section>
      )}
      <div ref={body} className="desk-gate-body">
        <GateSlot job={job} detail={thread.detail} now={now} reload={thread.reload} callsOutside />
      </div>
      {gate ? (
        <div className={`desk-calls${call ? ' is-call' : ''}`}>
          <button type="button" className={`btn desk-call-reply${call ? ' btn-lg' : ' btn-quiet'}`} onClick={() => press('guidance')} title="Ask or tell the Foreman something without deciding: nothing is approved (key: c).">
            Reply <Kbd id="desk-reply" />
          </button>
          <button type="button" className={`btn desk-call-no${call ? ' btn-lg' : ''}`} onClick={() => press('revise')} title="No go: say what should change. The Foreman stays at this stop and revises; nothing is approved (key: r).">
            {call ? <>No go<span className="call-long">: send back</span></> : 'Send back'} <Kbd id="desk-send-back" />
          </button>
          <button
            type="button"
            className={`btn btn-primary desk-call-go${call ? ' btn-lg' : ''}`}
            disabled={go.off || go.asks}
            onClick={() => press('approve')}
            title={go.asks ? 'Answer the questions on the card first: a for go never answers a question.' : go.off ? 'Go is off for now: the card says why.' : `${goWords} (key: a).`}
          >
            {call ? <>Go<span className="call-long">: {lowerFirst(goWords)}</span></> : goWords} <Kbd id="desk-approve" />
          </button>
        </div>
      ) : (
        <p className="muted">The Foreman is waiting for your reply. <a href={jobHref(job.slug)}>Open the job</a> to read its last message and answer in the message box.</p>
      )}
    </>
  );
}

/** The whole queue, in a drawer from the side (One at a time). */
function QueueDrawer({ items, index, now, onPick, onClose }: { items: DeskEntry[]; index: number; now: Date; onPick(key: string): void; onClose(): void }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    list.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (before?.isConnected) before.focus(); };
  }, [onClose]);
  return (
    <div className="sheet-backdrop drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="drawer" role="dialog" aria-modal="true" aria-label="The queue">
        <header className="drawer-head">
          <h3>The queue · {items.length}</h3>
          <button type="button" className="btn btn-quiet btn-icon" aria-label="Close the queue" onClick={onClose}><Icon name="x" /></button>
        </header>
        <ol ref={list} className="drawer-list">
          {items.map((it, i) => (
            <li key={it.key}>
              <button type="button" className={`desk-item${i === index ? ' is-current' : ''}`} aria-current={i === index ? 'true' : undefined} onClick={() => { onPick(it.key); onClose(); }}>
                <span className="desk-item-top"><span className="desk-item-title">{it.title}</span></span>
                <span className="desk-item-what">{it.what}</span>
                {it.since && it.kind !== 'nudge' && <span className="desk-item-since muted">waiting {relativeTime(it.since, now)}</span>}
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function DecidedFold() {
  const decided = useDecidedToday();
  return (
    <Fold icon="clock" name="Decided today" note={decided.length} id="desk-decided">
      {decided.length === 0
        ? <p className="muted">Nothing yet this session. Your decisions appear here as you make them.</p>
        : (
          <ol className="desk-decided-list">
            {decided.map((d, i) => (
              <li key={`${d.at}-${i}`}>
                <span className="desk-decided-title">{d.title}</span>
                <span className="desk-decided-what">{d.what}</span>
                <time className="muted" dateTime={d.at} title={fullTime(d.at)}>{new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
              </li>
            ))}
          </ol>
        )}
    </Fold>
  );
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function DeskGate({ job, now, briefOpen, toggleBrief }: { job: Job; now: Date; briefOpen: boolean; toggleBrief(): void }) {
  const state = useWorkshopState();
  const thread = useJobThread(job.slug, (state.threadVersions[job.slug] ?? 0) + state.threadEpoch);
  if (thread.error) return <p className="perm-warn" role="alert">{thread.error}</p>;
  if (!thread.detail) return <p className="muted" role="status">Opening the Foreman’s brief…</p>;
  const brief = thread.detail.latestBrief as { html?: string; number?: number | null } | null | undefined;
  const label = `Brief${brief?.number ? ` #${brief.number}` : ''}`;
  return (
    <>
      {typeof job.headline === 'string' && job.headline && <p className="desk-headline">{job.headline}</p>}
      {brief?.html && (
        <section className="desk-brief" aria-label={label}>
          <header className="desk-brief-head">
            <h4>{label}</h4>
            <button type="button" className="btn btn-quiet" aria-expanded={briefOpen} onClick={toggleBrief} title={briefOpen ? 'Hide the Foreman’s brief (key: b).' : 'Read the Foreman’s latest brief in full (key: b).'}>
              {briefOpen ? 'Hide the brief' : 'Show the brief'} <Kbd id="desk-brief" />
            </button>
          </header>
          {briefOpen && <ServerHtml html={brief.html} className="prose" />}
        </section>
      )}
      <GateSlot job={job} detail={thread.detail} now={now} reload={thread.reload} />
      {!thread.detail.gate && <p className="muted">The Foreman is waiting for your reply. <a href={jobHref(job.slug)}>Open the job</a> to read its last message and answer in the message box.</p>}
    </>
  );
}

/**
 * A hand-off nudge: what it is about, and Yes (the Foreman takes it on) or a link to GitHub, plus
 * Not now. Its own quiet card, not a .perm-card: every theme colours those as an ask.
 */
function NudgeCard({ item, busy, error, onYes, onDismiss }: { item: NudgeItem; busy: boolean; error: string | null; onYes(): void; onDismiss(): void }) {
  const n = item.nudge;
  return (
    <section className={`desk-nudge${n.afterLine ? ' is-after' : ''}`} aria-label={n.title} aria-busy={busy}>
      <p className="perm-who gate-meta">
        <span className="ask-label">{n.afterLine ? 'Shipping · past your finish line' : 'Hand-off'}</span>
      </p>
      <h3 className="perm-headline">{n.title}</h3>
      <p className="desk-nudge-text">{n.text}</p>
      <div className="perm-actions">
        {n.action && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onYes} title={`Yes: the Foreman gets “${n.action.send}” and takes it from there.`}>
            Yes, ask the Foreman<Kbd id="desk-approve" />
          </button>
        )}
        {n.link && (
          <a className={`btn${n.action ? '' : ' btn-primary'} desk-nudge-link`} href={n.link} target="_blank" rel="noopener noreferrer" title="Open it on GitHub, in a new tab (key: o). The dashboard never merges or approves anything itself.">
            Open on GitHub<Kbd id="desk-open" />
          </a>
        )}
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onDismiss} title="Put this nudge away for this job. It doesn’t come back; the job is unchanged.">
          Not now<Kbd id="desk-deny" />
        </button>
      </div>
      {error && <p className="field-problem" role="alert">{error}</p>}
    </section>
  );
}

/** What the clicked button says, without its key hint: "Allow once", "Approve plan v2 and start Build". */
function buttonWords(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const b = target.closest<HTMLElement>('.perm-actions button, .gate-actions button');
  if (!b || b.classList.contains('btn-quiet')) return null;
  const copy = b.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('kbd').forEach((k) => k.remove());
  const words = (copy.textContent ?? '').trim();
  return words || null;
}

/** The right column: what you decided this session, and the current job's facts and where its work is. */
function DeskSide({ job }: { job: Job | null }) {
  const decided = useDecidedToday();
  return (
    <aside className="desk-side" aria-label="Decided today, and the job">
      <section className="desk-side-box desk-decided" aria-labelledby="desk-decided-head">
        <h4 id="desk-decided-head">Decided today</h4>
        {decided.length === 0
          ? <p className="muted">Nothing yet this session. Your decisions appear here as you make them.</p>
          : (
            <ol>
              {decided.map((d, i) => (
                <li key={`${d.at}-${i}`}>
                  <span className="desk-decided-title">{d.title}</span>
                  <span className="desk-decided-what">{d.what}</span>
                  <time className="muted" dateTime={d.at} title={fullTime(d.at)}>{new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                </li>
              ))}
            </ol>
          )}
      </section>
      {job && (
        <section className="desk-side-box desk-job" aria-labelledby="desk-job-head">
          <h4 id="desk-job-head">This job</h4>
          <p className="desk-facts muted">
            {jobFacts(job).map((f, i) => <span key={i}>{f}</span>)}
          </p>
          <p className="desk-where" title="Where the job’s work is, from the finish line and its PRs.">{whereLine(job)}</p>
        </section>
      )}
    </aside>
  );
}

export function DeskView({ items: decisions, now, layout = 'columns' }: { items: DeskItem[]; now: Date; layout?: DeskLayout }) {
  const { api } = useWorkshop();
  const { jobs } = useWorkshopState();
  const play = usePlayIfAny();
  // Nudges you said yes to or put away just now: gone at once, before the next snapshot confirms it.
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  // A job with a review round: the round's card takes the place of its PR nudges.
  const { list: reviewList } = useReviewList(jobs.length > 0);
  const reviewing = new Set((reviewList?.jobs ?? []).map((v) => v.slug));
  const items: DeskEntry[] = deskEntries(decisions, jobs).filter((e) => !settled.has(e.key) && !(e.kind === 'nudge' && reviewing.has(e.slug) && ROUND_NUDGES.has(e.nudge.id)));
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [briefOpen, setBriefOpen] = useState(layout === 'columns');
  const [queueOpen, setQueueOpen] = useState(false);
  const closeQueue = useCallback(() => setQueueOpen(false), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastIndex = useRef(0);
  const at = Math.max(0, items.findIndex((i) => i.key === currentKey));
  // The one you were on was decided: stay at the same place in the queue (the next one).
  const index = currentKey !== null && !items.some((i) => i.key === currentKey) ? Math.min(lastIndex.current, items.length - 1) : at;
  const current = items[index] ?? null;
  lastIndex.current = index;
  const panel = useRef<HTMLDivElement>(null);
  const job = current ? jobs.find((j) => j.slug === current.slug) ?? null : null;
  // The item shown last, with the words of the button you pressed on it: when it leaves the queue
  // (the snapshot says it is decided), that goes into Decided today. Nudges record themselves.
  const shown = useRef<{ entry: DeskEntry; pressed: string | null } | null>(null);
  const shownKey = current?.key ?? null;
  const gone = (key: string) => !items.some((i) => i.key === key);
  useEffect(() => {
    const was = shown.current;
    if (was && was.entry.key !== shownKey) {
      if (was.entry.kind !== 'nudge' && gone(was.entry.key)) recordDecision({ title: was.entry.title, what: was.pressed ?? was.entry.what });
      shown.current = null;
    }
    if (current && shown.current === null) shown.current = { entry: current, pressed: null };
  });
  const pressed = (words: string | null) => { if (shown.current && words) shown.current.pressed = words; };
  // The one you decided on left the queue: the next one's card takes the focus.
  const decided = currentKey !== null && gone(currentKey);
  useEffect(() => {
    if (!decided) return;
    if (shownKey) { setCurrentKey(shownKey); panel.current?.focus(); } else setCurrentKey(null);
  }, [decided, shownKey]);

  const move = (by: number) => { const next = items[Math.max(0, Math.min(items.length - 1, index + by))]; if (next) setCurrentKey(next.key); };
  // Arrows only move the queue while it has the focus (elsewhere they scroll, or work a menu).
  const inQueue = (e: KeyboardEvent) => e.target instanceof Element && Boolean(e.target.closest('.desk-queue'));
  // The card's own buttons: the gate's Approve, a permission's Allow once or Deny….
  const click = (selector: string) => panel.current?.querySelector<HTMLButtonElement>(selector)?.click();
  // A review round's card (packet Q): a is its go, r its no go, o opens the round on the job.
  const round = current && current.kind !== 'gate' && current.kind !== 'nudge' && isRoundCard(current.permission);

  /** A nudge: yes (the Foreman gets its sentence) or dismiss. The item goes at once; the snapshot confirms it. */
  async function settleNudge(item: NudgeItem, what: 'yes' | 'dismiss') {
    setBusy(true);
    setError(null);
    try {
      await api.post(nudgePath(item.slug, item.nudge.id, what), {});
      recordDecision({ title: item.title, what: what === 'yes' ? `Yes: ${item.nudge.title}` : `Not now: ${item.nudge.title}` });
      setSettled((s) => new Set([...s, item.key]));
      setCurrentKey(item.key); // left the queue: the next one opens
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  // The Desk's scope stays on while the queue is empty too, so j and k don't leave for another job.
  useKeyScope('desk', {
    'desk-next': () => move(1),
    'desk-prev': () => move(-1),
    'desk-down': (e) => (inQueue(e) ? move(1) : false),
    'desk-up': (e) => (inQueue(e) ? move(-1) : false),
    'desk-open': () => {
      if (!current) return;
      if (current.kind === 'nudge' && current.nudge.link) { window.open(current.nudge.link, '_blank', 'noopener'); return; }
      navigate({ name: 'job', slug: current.slug });
    },
    // A gate card that still asks questions is answered on the card, whatever the job says.
    'desk-approve': () => {
      if (round) { pressed('Go'); click('[data-review-go]:not(:disabled)'); return; }
      if (!current || busy || !oneKeyDecide(current)) return;
      if (current.kind === 'nudge') { void settleNudge(current, 'yes'); return; }
      if (panel.current?.querySelector('.gate-question')) return;
      pressed(current.kind === 'gate' ? 'Approved' : 'Allowed once');
      click(current.kind === 'gate' ? '[data-gate="approve"]:not(:disabled)' : '.perm-actions > .btn-primary:not(:disabled)');
    },
    'desk-deny': () => {
      if (!current || busy) return;
      if (current.kind === 'nudge') { void settleNudge(current, 'dismiss'); return; }
      if (current.kind === 'permission') click('.perm-actions > .btn-danger:not(:disabled)');
    },
    'desk-brief': () => { if (current?.kind === 'gate') setBriefOpen((o) => !o); else return false; },
    // r and c press the gate card's Revise with feedback and Other guidance (the same in both layouts).
    'desk-send-back': () => {
      if (round) { pressed('No go'); click('[data-review-nogo]:not(:disabled)'); return; }
      if (current?.kind !== 'gate') return false;
      click('[data-gate="revise"]:not(:disabled)');
    },
    'desk-reply': () => { if (current?.kind !== 'gate') return false; click('[data-gate="guidance"]:not(:disabled)'); },
  });

  const onPanelClick = (e: ReactMouseEvent) => pressed(buttonWords(e.target));

  if (!items.length && layout === 'one') {
    return (
      <div className="desk-one">
        <Hero
          icon="circle-check"
          quiet
          title="Desk clear"
          actions={<a className="btn btn-primary btn-lg" href={hrefFor({ name: 'home' })} title="Every job, in four lanes (keys: g j).">See all jobs <kbd className="kbd key-hint" aria-hidden="true">g j</kbd></a>}
        >
          {play?.on && <CrewMember type="conductor" state="celebrating" size={96} label="" />}
          <p>The crew carries on with your decisions. Go-aheads, questions and permissions land here as they come.</p>
        </Hero>
        <DecidedFold />
      </div>
    );
  }

  if (layout === 'one') {
    const call = Boolean(play?.on);
    return (
      <div className="desk-one">
        <div className="desk-qbar">
          <span className="desk-dots" aria-hidden="true">
            {items.slice(0, DOTS).map((it, i) => <span key={it.key} className={`desk-dot${i === index ? ' is-current' : ''}`} />)}
            {items.length > DOTS && <span className="desk-dots-more">+{items.length - DOTS}</span>}
          </span>
          <b>{index + 1} of {items.length}</b>
          <span className="muted desk-qbar-words">waiting for you</span>
          <span className="spacer" />
          <button type="button" className="btn btn-quiet" aria-haspopup="dialog" aria-expanded={queueOpen} onClick={() => setQueueOpen(true)} title="The whole queue, oldest first (j and k move through it here).">
            <Icon name="list" size={16} /> Queue
          </button>
        </div>
        <section className={`desk-console${call && current?.kind === 'gate' ? ' is-call' : ''}`} aria-label={current ? `${current.title}: ${current.what}` : 'Decision'} ref={panel} tabIndex={-1} onClickCapture={onPanelClick}>
          {current && (
            <>
              <header className="desk-console-head">
                <span className="desk-console-title">{current.title}</span>
                {typeof job?.ticket === 'object' && job?.ticket && 'key' in job.ticket && <span className="chip">{String((job.ticket as { key: unknown }).key)}</span>}
                <span className="spacer" />
                {current.since && current.kind !== 'nudge' && <span className="muted">waiting {relativeTime(current.since, now)}</span>}
                <a className="btn btn-quiet" href={jobHref(current.slug)} title="Open the whole job: its stops, documents and conversation (key: o).">Open the job <Kbd id="desk-open" /></a>
              </header>
              {job && current.kind !== 'nudge' && <StopMap job={job} />}
              {current.kind === 'gate' && (job
                ? <DeskGateOne key={current.key} job={job} now={now} briefOpen={briefOpen} toggleBrief={() => setBriefOpen((o) => !o)} call={call} />
                : <p className="muted">This job isn’t in the list any more.</p>)}
              {(current.kind === 'permission' || current.kind === 'question') && (isRoundCard(current.permission)
                ? <ReviewDeskCard key={current.key} permission={current.permission} call={call} />
                : <Card key={current.key} p={current.permission} now={now} />)}
              {current.kind === 'nudge' && <NudgeCard key={current.key} item={current} busy={busy} error={error} onYes={() => void settleNudge(current, 'yes')} onDismiss={() => void settleNudge(current, 'dismiss')} />}
              {!oneKeyDecide(current) && current.kind === 'permission' && <p className="muted desk-note">A hard line or a step Claude Code flagged as risky: decide on the card itself (no one-key approve).</p>}
            </>
          )}
        </section>
        <DecidedFold />
        {queueOpen && <QueueDrawer items={items} index={index} now={now} onPick={setCurrentKey} onClose={closeQueue} />}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="desk desk-is-clear">
        <div className="desk-clear" role="status">
          {play?.on && <CrewMember type="conductor" state="celebrating" size={96} label="" />}
          <h3>Desk clear</h3>
          <p className="muted">Your desk is clear. The crew carries on with your decisions. New go-ahead requests, questions, permissions and hand-offs arrive here as they come.</p>
        </div>
        <DeskSide job={null} />
      </div>
    );
  }

  const firstShipping = items.findIndex(isShipping);
  return (
    <div className="desk">
      <nav className="desk-queue" aria-label="Waiting for your decision">
        <ol>
          {items.map((it, i) => (
            <li key={it.key} className={i === firstShipping ? 'desk-group-start' : undefined}>
              {i === firstShipping && <span className="desk-group muted" id="desk-shipping" title="Jobs past your finish line: these wait on other people; one link or one yes each.">Shipping</span>}
              <button type="button" className={`desk-item${i === index ? ' is-current' : ''}${isShipping(it) ? ' is-shipping' : ''}`} aria-current={i === index ? 'true' : undefined} onClick={() => setCurrentKey(it.key)}>
                <span className="desk-item-top">
                  <span className="hue-dot" style={jobHueStyle(it.slug)} aria-hidden="true" />
                  <span className="desk-item-title">{it.title}</span>
                </span>
                <span className="desk-item-what">{it.what}</span>
                {it.since && it.kind !== 'nudge' && <span className="desk-item-since muted">waiting {relativeTime(it.since, now)}</span>}
              </button>
            </li>
          ))}
        </ol>
        <KeyLegend ids={DESK_KEYS} className="desk-keys" />
      </nav>
      <section className="desk-current" aria-label={current ? `${current.title}: ${current.what}` : 'Decision'} ref={panel} tabIndex={-1} onClickCapture={onPanelClick}>
        {current && (
          <>
            <header className="desk-current-head">
              <span className="muted">{index + 1} of {items.length}</span>
              <h3>{current.title}</h3>
              <a className="btn btn-quiet" href={jobHref(current.slug)} title="Open the whole job: its conversation, documents and options (key: o).">Open the job <Kbd id="desk-open" /></a>
            </header>
            {current.kind === 'gate' && (job
              ? <DeskGate key={current.key} job={job} now={now} briefOpen={briefOpen} toggleBrief={() => setBriefOpen((o) => !o)} />
              : <p className="muted">This job isn’t in the list any more.</p>)}
            {(current.kind === 'permission' || current.kind === 'question') && (isRoundCard(current.permission)
              ? <ReviewDeskCard key={current.key} permission={current.permission} call={Boolean(play?.on)} />
              : <Card key={current.key} p={current.permission} now={now} />)}
            {current.kind === 'nudge' && <NudgeCard key={current.key} item={current} busy={busy} error={error} onYes={() => void settleNudge(current, 'yes')} onDismiss={() => void settleNudge(current, 'dismiss')} />}
            {!oneKeyDecide(current) && current.kind === 'permission' && <p className="muted desk-note">A hard line or a step Claude Code flagged as risky: decide on the card itself (no one-key approve).</p>}
          </>
        )}
      </section>
      <DeskSide job={job} />
    </div>
  );
}
