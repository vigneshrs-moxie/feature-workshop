// The Desk (Home): every decision waiting for you, across all jobs, one at a time. Three columns
// from 1200 px (plan §5): the queue on the left, oldest first; the current item in the middle, with
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
// After a decision the next item opens and its card takes the focus.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { Job } from '../api/types';
import { useKeyScope, type KeyId } from '../app/keyRegistry';
import { jobHref, navigate } from '../app/router';
import { Kbd, KeyLegend } from '../components/Kbd';
import { Card } from '../components/permissions/PendingCards';
import { fullTime, relativeTime } from '../lib/time';
import { GateSlot } from '../panes/Foreman/GateCard';
import { ServerHtml } from '../panes/Foreman/ServerHtml';
import { useJobThread } from '../panes/Foreman/useJobThread';
import { CrewMember } from '../play/CrewMember';
import { usePlayIfAny } from '../play/usePlay';
import { useWorkshop, useWorkshopState } from '../state/store';
import { jobHueStyle } from '../theme/hue';
import type { DeskItem } from './homeModel';
import { type DeskEntry, deskEntries, isShipping, jobFacts, type NudgeItem, nudgePath, oneKeyDecide, recordDecision, useDecidedToday, whereLine } from './nudges';

const DESK_KEYS: readonly KeyId[] = ['desk-next', 'desk-prev', 'desk-approve', 'desk-deny', 'desk-open', 'desk-brief'];

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

export function DeskView({ items: decisions, now }: { items: DeskItem[]; now: Date }) {
  const { api } = useWorkshop();
  const { jobs } = useWorkshopState();
  const play = usePlayIfAny();
  // Nudges you said yes to or put away just now: gone at once, before the next snapshot confirms it.
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  const items: DeskEntry[] = deskEntries(decisions, jobs).filter((e) => !settled.has(e.key));
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [briefOpen, setBriefOpen] = useState(true);
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
      if (!current || busy || !oneKeyDecide(current)) return;
      if (current.kind === 'nudge') { void settleNudge(current, 'yes'); return; }
      if (panel.current?.querySelector('.gate-question')) return;
      pressed(current.kind === 'gate' ? 'Approved' : 'Allowed once');
      click(current.kind === 'gate' ? '.gate-actions > .btn-primary:not(:disabled)' : '.perm-actions > .btn-primary:not(:disabled)');
    },
    'desk-deny': () => {
      if (!current || busy) return;
      if (current.kind === 'nudge') { void settleNudge(current, 'dismiss'); return; }
      if (current.kind === 'permission') click('.perm-actions > .btn-danger:not(:disabled)');
    },
    'desk-brief': () => { if (current?.kind === 'gate') setBriefOpen((o) => !o); else return false; },
  });

  const onPanelClick = (e: ReactMouseEvent) => pressed(buttonWords(e.target));

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
            {(current.kind === 'permission' || current.kind === 'question') && <Card key={current.key} p={current.permission} now={now} />}
            {current.kind === 'nudge' && <NudgeCard key={current.key} item={current} busy={busy} error={error} onYes={() => void settleNudge(current, 'yes')} onDismiss={() => void settleNudge(current, 'dismiss')} />}
            {!oneKeyDecide(current) && current.kind === 'permission' && <p className="muted desk-note">A hard line or a step Claude Code flagged as risky: decide on the card itself (no one-key approve).</p>}
          </>
        )}
      </section>
      <DeskSide job={job} />
    </div>
  );
}
