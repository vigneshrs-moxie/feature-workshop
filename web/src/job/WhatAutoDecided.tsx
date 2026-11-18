// What Auto decided: a button where Auto has run on the job, and the panel it opens: the three
// summary lines and every decision, newest first. The panel's data is GET /api/job/:slug/auto;
// a 404 or an error shows the empty line. Self-contained: props in, its own sheet (`drawer`: a drawer
// at the right, which auto.css places on a laptop). The list alone (AutoDecidedList) is what the job
// page's reader shows, opened from the button beside its Auto switch (jobpage/reader/AutoView.tsx).
// Each entry: when, the step as a chip, Asked:, Chose: as a chip (the stop look for Auto stopping,
// the done look otherwise), Why:. A stop is not a decision: its chip says Stopped and Why: carries
// the reason, once. A record from an older laptop has no kind and no step: no step chip, the done
// look. A risky call (the Approver asked a second time for the safer answer) has a Risky call mark
// beside its step and, when it is known, what the Approver first said above Chose:. A refusal (Auto
// refused something the crew asked for, and the job carried on) shows its chose, "Refused: …", as
// the chip, in the quiet look. The foot says when a tag started Auto and on which ticket, when all three are known.
import { useEffect, useState } from 'react';
import type { AutoDecided, AutoDecision, JobAuto } from '../api/types';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Sheet } from '../components/Sheet';
import { STOPS } from '../components/stops/stops';
import { dayAndTime, fullTime, relativeTime } from '../lib/time';
import { useWorkshop } from '../state/store';
import './auto.css';

/** "14m ago", "3h ago"; "yesterday" and dates as they are. */
function agoWords(at: string): string {
  const t = relativeTime(at, new Date());
  return /^\d+[mhd]$/.test(t) ? `${t} ago` : t;
}

export const AUTO_EMPTY = 'Auto hasn\'t decided anything on this job yet.';
/** The foot's second sentence, always there under the list. */
export const AUTO_FOOT = 'The same decisions show in Copy decisions, marked (Auto).';

/** The foot: who started Auto, when and on which ticket (all three known), then the second sentence. */
function footOf(data: AutoDecided): string {
  const when = typeof data.startedAt === 'string' ? dayAndTime(data.startedAt) : '';
  const first = when && data.ticket && data.tag ? `Started by Auto on ${when}: ${data.ticket} carries the tag ${data.tag}. ` : '';
  return `${first}${AUTO_FOOT}`;
}

const stepOf = (e: AutoDecision) => (e.stop ? STOPS.find((s) => s.id === e.stop)?.label ?? null : null);

function Entry({ e }: { e: AutoDecision }) {
  const step = stepOf(e);
  const stop = e.kind === 'stop';
  const refuse = e.kind === 'refuse';
  const first = e.risky === true && typeof e.first === 'string' && e.first.trim() ? e.first.trim() : null;
  // A stop carries its reason as what it chose; why is the same sentence, or (a high-risk stop) the
  // Approver's own explanation. Why: says each once: the two joined when they differ.
  const why = stop ? (e.chose && e.why && e.why !== e.chose ? `${e.chose} ${e.why}` : e.chose || e.why) : e.why;
  return (
    <li className="auto-entry" data-kind={e.kind}>
      <div className="auto-entry-head">
        <span className="muted num" title={fullTime(e.at) || undefined}>{agoWords(e.at)}</span>
        {step ? <Chip className="sb-auto-entry-step">{step}</Chip> : <span className="auto-entry-stage">{e.stage}</span>}
        {e.risky === true && <Chip tone="warn" icon="alert" className="sb-auto-entry-risky">Risky call</Chip>}
      </div>
      {e.asked && <p className="sb-auto-entry-asked">Asked: {e.asked}</p>}
      {first && <p className="sb-auto-entry-first">The Approver first said: {first}</p>}
      {(stop || e.chose) && (
        <p className="sb-auto-entry-chose">
          Chose:{' '}
          {stop
            ? <Chip tone="needs-you" icon="octagon"><strong>Stopped</strong></Chip>
            : refuse
              ? <Chip icon="shield"><strong>{e.chose}</strong></Chip>
              : <Chip tone="ok" icon="check"><strong>{e.chose}</strong></Chip>}
        </p>
      )}
      {why && <p>Why: {why}</p>}
      {e.risk && <p>Risk: {e.risk}</p>}
      {e.answers && e.answers.length > 0 && (
        <ul>{e.answers.map((a, j) => <li key={j}>{a.question} {a.choice}. {a.reason}</li>)}</ul>
      )}
    </li>
  );
}

/** What was last read for each job, per app: a second look paints at once while it is read again. */
const kept = new WeakMap<object, Map<string, AutoDecided | null>>();

/** GET /api/job/:slug/auto. undefined: loading (nothing read before); null: nothing to show (not built yet, or it failed). */
function useAutoLog(slug: string): AutoDecided | null | undefined {
  const { api } = useWorkshop();
  let bySlug = kept.get(api);
  if (!bySlug) { bySlug = new Map(); kept.set(api, bySlug); }
  const held = bySlug;
  const [data, setData] = useState<AutoDecided | null | undefined>(() => held.get(slug));
  useEffect(() => {
    let cancelled = false;
    // The same answer as the one shown keeps it: nothing draws again.
    const take = (d: AutoDecided | null) => {
      if (cancelled) return;
      held.set(slug, d);
      setData((was) => (was !== undefined && JSON.stringify(was) === JSON.stringify(d) ? was : d));
    };
    api.get<AutoDecided>(`/api/job/${encodeURIComponent(slug)}/auto`).then(
      (d) => take(d && Array.isArray(d.entries) ? d : null),
      () => take(null),
    );
    return () => { cancelled = true; };
  }, [api, slug, held]);
  return data;
}

/**
 * The list itself: the summary lines, every decision newest first, and the foot. The sheet shows it
 * under its title; the job page's reader shows it as the page (reader/AutoView.tsx), where `quiet`
 * leaves the body empty while it is read, so nothing moves when it lands.
 */
export function AutoDecidedList({ slug, quiet = false }: { slug: string; quiet?: boolean }) {
  const data = useAutoLog(slug);
  // Newest first. The laptop sends them that way; they are only put in order again when every time is readable, otherwise they stay as given.
  const entries = data ? [...data.entries] : [];
  if (entries.every((e) => Number.isFinite(Date.parse(e.at)))) entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (data === undefined) return quiet ? null : <p className="muted" role="status">Loading…</p>;
  if (!data || (entries.length === 0 && !data.summary.some((l) => l.trim()))) return <p>{AUTO_EMPTY}</p>;
  return (
    <>
      <ul className="auto-summary">{data.summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
      <ul className="auto-entries">
        {entries.map((e, i) => <Entry key={`${e.at}-${i}`} e={e} />)}
      </ul>
      <p className="sb-auto-foot">{footOf(data)}</p>
    </>
  );
}

function Panel({ slug, onClose, drawer }: { slug: string; onClose(): void; drawer: boolean }) {
  return (
    <Sheet title="What Auto decided" onClose={onClose} className={drawer ? 'sb-drawer' : ''}>
      <div className="auto-decided">
        <AutoDecidedList slug={slug} />
        <div className="sheet-actions"><Button onClick={onClose}>Close</Button></div>
      </div>
    </Sheet>
  );
}

export function WhatAutoDecided({ slug, auto, size = 'sm', drawer = false, plain = false }: { slug: string; auto?: Pick<JobAuto, 'ran'> | null; size?: 'sm' | 'md'; /** The new job page's: the panel opens as a drawer at the right on a laptop. */ drawer?: boolean; /** The new job page's: a plain button with its icon, as drawn, instead of the quiet look. */ plain?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!auto?.ran) return null;
  return (
    // Clicks and keys inside the button and its panel stay here: a card or row holding them has its own.
    // Escape is let through: the panel hears it on the document, above this.
    <span className="auto-decided-wrap" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}>
      <Button kind={plain ? 'secondary' : 'quiet'} icon={plain ? 'checks' : undefined} size={size} onClick={() => setOpen(true)} title="Every step Auto approved or answered for you on this job, and why.">What Auto decided</Button>
      {open && <Panel slug={slug} onClose={() => setOpen(false)} drawer={drawer} />}
    </span>
  );
}
