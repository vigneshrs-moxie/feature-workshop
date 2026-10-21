// The Desk (Home): every decision waiting for you, across all jobs, one at a time. The queue on the
// left, oldest first; the current one on the right with the same card the job page shows (the gate
// card for a go-ahead or the Foreman's questions, the permission or question card). Decide, and the
// next one opens.
//
// Keys (the 'desk' scope of app/keyRegistry.ts, which wins over the page's j and k; not while
// typing, not with a dialog open, and a held key never repeats):
//   j  next          k  previous          o  open the job          (↓ and ↑ too, in the queue)
//   a      approve (a gate's go-ahead, or Allow once): never for a hard line, a step Claude Code
//          flagged as risky, or a question (the Foreman's or the crew's: you answer those on the card)
//   d      deny a permission (opens its note)
// After a decision the next item opens and its card takes the focus.
import { useEffect, useRef, useState } from 'react';
import type { Job } from '../api/types';
import { useKeyScope, type KeyId } from '../app/keyRegistry';
import { jobHref, navigate } from '../app/router';
import { Kbd, KeyLegend } from '../components/Kbd';
import { Card } from '../components/permissions/PendingCards';
import { relativeTime } from '../lib/time';
import { GateSlot } from '../panes/Foreman/GateCard';
import { ServerHtml } from '../panes/Foreman/ServerHtml';
import { useJobThread } from '../panes/Foreman/useJobThread';
import { CrewMember } from '../play/CrewMember';
import { usePlayIfAny } from '../play/usePlay';
import { useWorkshopState } from '../state/store';
import { jobHueStyle } from '../theme/hue';
import { type DeskItem, oneKeyApprove } from './homeModel';

const DESK_KEYS: readonly KeyId[] = ['desk-next', 'desk-prev', 'desk-approve', 'desk-deny', 'desk-open'];

function DeskGate({ job, now }: { job: Job; now: Date }) {
  const state = useWorkshopState();
  const thread = useJobThread(job.slug, (state.threadVersions[job.slug] ?? 0) + state.threadEpoch);
  if (thread.error) return <p className="perm-warn" role="alert">{thread.error}</p>;
  if (!thread.detail) return <p className="muted" role="status">Opening the Foreman’s brief…</p>;
  const brief = thread.detail.latestBrief as { html?: string; number?: number | null } | null | undefined;
  return (
    <>
      {typeof job.headline === 'string' && job.headline && <p className="desk-headline">{job.headline}</p>}
      {brief?.html && (
        <details className="how desk-brief">
          <summary title="The Foreman’s latest brief, in full.">Read the brief{brief.number ? ` (#${brief.number})` : ''}</summary>
          <ServerHtml html={brief.html} className="prose" />
        </details>
      )}
      <GateSlot job={job} detail={thread.detail} now={now} reload={thread.reload} />
      {!thread.detail.gate && <p className="muted">The Foreman is waiting for your reply. <a href={jobHref(job.slug)}>Open the job</a> to read its last message and answer in the message box.</p>}
    </>
  );
}

export function DeskView({ items, now }: { items: DeskItem[]; now: Date }) {
  const { jobs } = useWorkshopState();
  const play = usePlayIfAny();
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const lastIndex = useRef(0);
  const at = Math.max(0, items.findIndex((i) => i.key === currentKey));
  // The one you were on was decided: stay at the same place in the queue (the next one).
  const index = currentKey !== null && !items.some((i) => i.key === currentKey) ? Math.min(lastIndex.current, items.length - 1) : at;
  const current = items[index] ?? null;
  lastIndex.current = index;
  const panel = useRef<HTMLDivElement>(null);
  const job = current ? jobs.find((j) => j.slug === current.slug) ?? null : null;
  // The one you decided on left the queue: the next one's card takes the focus.
  const shownKey = current?.key ?? null;
  const decided = currentKey !== null && !items.some((i) => i.key === currentKey);
  useEffect(() => {
    if (decided && shownKey) { setCurrentKey(shownKey); panel.current?.focus(); }
  }, [decided, shownKey]);

  const move = (by: number) => { const next = items[Math.max(0, Math.min(items.length - 1, index + by))]; if (next) setCurrentKey(next.key); };
  // Arrows only move the queue while it has the focus (elsewhere they scroll, or work a menu).
  const inQueue = (e: KeyboardEvent) => e.target instanceof Element && Boolean(e.target.closest('.desk-queue'));
  // The card's own buttons: the gate's Approve, a permission's Allow once or Deny….
  const click = (selector: string) => panel.current?.querySelector<HTMLButtonElement>(selector)?.click();
  // The Desk's scope stays on while the queue is empty too, so j and k don't leave for another job.
  useKeyScope('desk', {
    'desk-next': () => move(1),
    'desk-prev': () => move(-1),
    'desk-down': (e) => (inQueue(e) ? move(1) : false),
    'desk-up': (e) => (inQueue(e) ? move(-1) : false),
    'desk-open': () => { if (current) navigate({ name: 'job', slug: current.slug }); },
    // A gate card that still asks questions is answered on the card, whatever the job says.
    'desk-approve': () => {
      if (!current || !oneKeyApprove(current) || panel.current?.querySelector('.gate-question')) return;
      click(current.kind === 'gate' ? '.gate-actions > .btn-primary:not(:disabled)' : '.perm-actions > .btn-primary:not(:disabled)');
    },
    'desk-deny': () => { if (current?.kind === 'permission') click('.perm-actions > .btn-danger:not(:disabled)'); },
  });

  if (!items.length) {
    return (
      <div className="desk-clear" role="status">
        {play?.on && <CrewMember type="conductor" state="celebrating" size={96} label="" />}
        <h3>Desk clear</h3>
        <p className="muted">Nothing is waiting for your decision. New go-ahead requests, questions and permissions arrive here as they come.</p>
      </div>
    );
  }

  return (
    <div className="desk">
      <nav className="desk-queue" aria-label="Waiting for your decision">
        <ol>
          {items.map((it, i) => (
            <li key={it.key}>
              <button type="button" className={`desk-item${i === index ? ' is-current' : ''}`} aria-current={i === index ? 'true' : undefined} onClick={() => setCurrentKey(it.key)}>
                <span className="desk-item-top">
                  <span className="hue-dot" style={jobHueStyle(it.slug)} aria-hidden="true" />
                  <span className="desk-item-title">{it.title}</span>
                </span>
                <span className="desk-item-what">{it.what}</span>
                {it.since && <span className="desk-item-since muted">waiting {relativeTime(it.since, now)}</span>}
              </button>
            </li>
          ))}
        </ol>
        <KeyLegend ids={DESK_KEYS} className="desk-keys" />
      </nav>
      <section className="desk-current" aria-label={current ? `${current.title}: ${current.what}` : 'Decision'} ref={panel} tabIndex={-1}>
        {current && (
          <>
            <header className="desk-current-head">
              <span className="muted">{index + 1} of {items.length}</span>
              <h3>{current.title}</h3>
              <a className="btn btn-quiet" href={jobHref(current.slug)} title="Open the whole job: its conversation, documents and options (key: o).">Open the job <Kbd id="desk-open" /></a>
            </header>
            {current.kind === 'gate'
              ? (job ? <DeskGate key={current.key} job={job} now={now} /> : <p className="muted">This job isn’t in the list any more.</p>)
              : <Card key={current.key} p={current.permission} now={now} />}
            {!oneKeyApprove(current) && current.kind === 'permission' && <p className="muted desk-note">A hard line or a step Claude Code flagged as risky: decide on the card itself (no one-key approve).</p>}
          </>
        )}
      </section>
    </div>
  );
}
