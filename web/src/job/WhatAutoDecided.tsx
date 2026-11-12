// What Auto decided: a button where Auto has run on the job, and the panel it opens: the three
// summary lines and every decision, newest first. The panel's data is GET /api/job/:slug/auto;
// a 404 or an error shows the empty line. Self-contained: props in, its own sheet (on the new job
// page a drawer at the right, `drawer`, which auto.css places on a laptop).
// Each entry: when, the step as a chip, Asked:, Chose: as a chip (the stop look for Auto stopping,
// the done look otherwise), Why:. A stop is not a decision: its chip says Stopped and Why: carries
// the reason, once. A record from an older laptop has no kind and no step: no step chip, the done
// look. The foot says when a tag started Auto and on which ticket, when all three are known.
import { useEffect, useState } from 'react';
import type { AutoDecided, AutoDecision, JobAuto } from '../api/types';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { Sheet } from '../components/Sheet';
import { STOPS } from '../components/stops/stops';
import { relativeTime } from '../lib/time';
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

/** "Nov 10 at 9:14 am", in the viewer's own time; null when the time can't be read. */
function startedWords(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AP])M$/i, (_m, ap: string) => ` ${ap.toLowerCase()}m`);
  return `${day} at ${time}`;
}

/** The foot: who started Auto, when and on which ticket (all three known), then the second sentence. */
function footOf(data: AutoDecided): string {
  const when = typeof data.startedAt === 'string' && data.startedAt ? startedWords(data.startedAt) : null;
  const first = when && data.ticket && data.tag ? `Started by Auto on ${when}: ${data.ticket} carries the tag ${data.tag}. ` : '';
  return `${first}${AUTO_FOOT}`;
}

const stepOf = (e: AutoDecision) => (e.stop ? STOPS.find((s) => s.id === e.stop)?.label ?? null : null);

function Entry({ e }: { e: AutoDecision }) {
  const step = stepOf(e);
  const stop = e.kind === 'stop';
  // A stop carries its reason as what it chose (and often as why too): it is said once, as Why:.
  const why = stop ? e.chose || e.why : e.why;
  return (
    <li className="auto-entry" data-kind={e.kind}>
      <div className="auto-entry-head">
        <span className="muted num" title={e.at}>{agoWords(e.at)}</span>
        {step ? <Chip className="auto-entry-step">{step}</Chip> : <span className="auto-entry-stage">{e.stage}</span>}
      </div>
      {e.asked && <p className="auto-entry-asked">Asked: {e.asked}</p>}
      {(stop || e.chose) && (
        <p className="auto-entry-chose">
          Chose:{' '}
          {stop
            ? <Chip tone="needs-you" icon="octagon"><strong>Stopped</strong></Chip>
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

function Panel({ slug, onClose, drawer }: { slug: string; onClose(): void; drawer: boolean }) {
  const { api } = useWorkshop();
  // undefined: loading; null: nothing to show (not built yet, or it failed).
  const [data, setData] = useState<AutoDecided | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    api.get<AutoDecided>(`/api/job/${encodeURIComponent(slug)}/auto`).then(
      (d) => { if (!cancelled) setData(d && Array.isArray(d.entries) ? d : null); },
      () => { if (!cancelled) setData(null); },
    );
    return () => { cancelled = true; };
  }, [api, slug]);
  // Newest first. The laptop sends them that way; they are only put in order again when every time is readable, otherwise they stay as given.
  const entries = data ? [...data.entries] : [];
  if (entries.every((e) => Number.isFinite(Date.parse(e.at)))) entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <Sheet title="What Auto decided" onClose={onClose} className={drawer ? 'sb-drawer' : ''}>
      <div className="auto-decided">
        {data === undefined ? <p className="muted" role="status">Loading…</p> : !data || (entries.length === 0 && !data.summary.some((l) => l.trim())) ? <p>{AUTO_EMPTY}</p> : (
          <>
            <ul className="auto-summary">{data.summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <ul className="auto-entries">
              {entries.map((e, i) => <Entry key={`${e.at}-${i}`} e={e} />)}
            </ul>
            <p className="auto-foot">{footOf(data)}</p>
          </>
        )}
        <div className="sheet-actions"><Button onClick={onClose}>Close</Button></div>
      </div>
    </Sheet>
  );
}

export function WhatAutoDecided({ slug, auto, size = 'sm', drawer = false }: { slug: string; auto?: Pick<JobAuto, 'ran'> | null; size?: 'sm' | 'md'; /** The new job page's: the panel opens as a drawer at the right on a laptop. */ drawer?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!auto?.ran) return null;
  return (
    // Clicks and keys inside the button and its panel stay here: a card or row holding them has its own.
    // Escape is let through: the panel hears it on the document, above this.
    <span className="auto-decided-wrap" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}>
      <Button kind="quiet" size={size} onClick={() => setOpen(true)} title="Every step Auto approved or answered for you on this job, and why.">What Auto decided</Button>
      {open && <Panel slug={slug} onClose={() => setOpen(false)} drawer={drawer} />}
    </span>
  );
}
