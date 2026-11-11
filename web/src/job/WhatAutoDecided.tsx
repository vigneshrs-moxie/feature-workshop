// What Auto decided: a button where Auto has run on the job, and the panel it opens: the three
// summary lines and every decision, newest first. The panel's data is GET /api/job/:slug/auto;
// a 404 or an error shows the empty line. Self-contained: props in, its own sheet.
import { useEffect, useState } from 'react';
import type { AutoDecided, JobAuto } from '../api/types';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { relativeTime } from '../lib/time';
import { useWorkshop } from '../state/store';
import './auto.css';

export const AUTO_EMPTY = 'Auto hasn\'t decided anything on this job yet.';

function Panel({ slug, onClose }: { slug: string; onClose(): void }) {
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
    <Sheet title="What Auto decided" onClose={onClose}>
      <div className="auto-decided">
        {data === undefined ? <p className="muted" role="status">Loading…</p> : entries.length === 0 ? <p>{AUTO_EMPTY}</p> : (
          <>
            <ul className="auto-summary">{data!.summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <ul className="auto-entries">
              {entries.map((e, i) => (
                <li key={`${e.at}-${i}`} className="auto-entry">
                  <div className="auto-entry-head"><span className="auto-entry-stage">{e.stage}</span><span className="muted" title={e.at}>{relativeTime(e.at, new Date())}</span></div>
                  <p><strong>{e.chose}</strong></p>
                  <p className="muted">{e.asked}</p>
                  <p>{e.why}</p>
                  {e.risk && <p>{e.risk}</p>}
                  {e.answers && e.answers.length > 0 && (
                    <ul>{e.answers.map((a, j) => <li key={j}>{a.question} {a.choice}. {a.reason}</li>)}</ul>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="sheet-actions"><Button onClick={onClose}>Close</Button></div>
      </div>
    </Sheet>
  );
}

export function WhatAutoDecided({ slug, auto, size = 'sm' }: { slug: string; auto?: Pick<JobAuto, 'ran'> | null; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false);
  if (!auto?.ran) return null;
  return (
    // Clicks and keys inside the button and its panel stay here: a card or row holding them has its own.
    // Escape is let through: the panel hears it on the document, above this.
    <span className="auto-decided-wrap" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}>
      <Button kind="quiet" size={size} onClick={() => setOpen(true)} title="Every step Auto approved or answered for you on this job, and why.">What Auto decided</Button>
      {open && <Panel slug={slug} onClose={() => setOpen(false)} />}
    </span>
  );
}
