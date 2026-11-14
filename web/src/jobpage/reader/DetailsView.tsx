// Details in the reader (job page rebuild, Task 14; plan decision 4, design brief "Details"): for when
// something goes wrong. One table, one row per piece of work, newest first: the step, who (the role and
// the model), the task it was given in one line, how long, how it ended; `Open in terminal` on a row
// that is still running, on the laptop only (the server sends a row's `ref` only then). Under it: cost
// by step. No tool-call lists, no crew telemetry.
//
// The rows are GET /api/job/:slug/work (dashboard/lib/work-rows.js, Task 5): read when Details opens and
// again on the job's `job-page` event (on the website, which sends no such event: on `thread`), since the
// work moves without the payload's v. What was read stays on screen while a read is out or fails.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client';
import type { LiveEvent } from '../../api/types';
import { BRAND } from '../../app/brand';
import { Button } from '../../components/Button';
import { spentWords } from '../../job/page/stepWords';
import { liveViewer, onLiveEvent } from '../../state/live';
import { useWorkshop } from '../../state/store';
import { sinceWords } from '../left/YourMove';
import { useJob } from '../useJob';
import { ReaderBody } from './ReaderBody';

interface WorkRow {
  id: string; step: string | null; stepLabel: string | null; who: string; role: string; model: string | null; task: string | null;
  startedAt: string | null; endedAt: string | null; durationMs: number | null; ended: string; state: string; ref: string | null;
}
interface Work { rows: WorkRow[]; costs: { steps: { step: string; label: string; usd: number }[]; totalUsd: number | null }; note: string | null }

export interface DetailsViewProps {
  /** The app's event stream (state/live.ts onLiveEvent when left out). */
  events?: (fn: (e: LiveEvent) => void) => () => void;
}

const money = (usd: number | null | undefined) => (typeof usd === 'number' && Number.isFinite(usd) ? `$${usd.toFixed(2)}` : '—');
const words = (err: unknown) => (err instanceof ApiError || err instanceof Error ? err.message : String(err));

function workOf(v: unknown): Work {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Work>;
  const rows = (Array.isArray(o.rows) ? o.rows : []).filter((r): r is WorkRow => Boolean(r) && typeof r.id === 'string');
  const steps = (Array.isArray(o.costs?.steps) ? o.costs!.steps : []).filter((s) => s && typeof s.label === 'string');
  return { rows, costs: { steps, totalUsd: typeof o.costs?.totalUsd === 'number' ? o.costs.totalUsd : null }, note: typeof o.note === 'string' ? o.note : null };
}

export function DetailsView({ events = onLiveEvent }: DetailsViewProps) {
  const { api } = useWorkshop();
  const slug = useJob((s) => s.slug);
  const hosted = useJob((s) => Boolean(s.payload?.hosted)) || Boolean(api.hosted?.());
  const [work, setWork] = useState<Work | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const read = useCallback(async () => {
    const viewer = hosted ? null : liveViewer();
    try {
      const v = await api.get<unknown>(`/api/job/${encodeURIComponent(slug)}/work${viewer ? `?viewer=${encodeURIComponent(viewer)}` : ''}`);
      if (!live.current) return;
      setWork(workOf(v));
      setError(null);
    } catch (err) {
      if (live.current) setError(words(err));
    }
  }, [api, slug, hosted]);

  // On open, then on the job's own change event.
  useEffect(() => {
    void read();
    return events((e) => {
      // The same test as the page's store (jobStore onEvent): the event's job, else its data's slug; on the
      // website a thread or change that names no job counts too.
      if (!e) return;
      const d = (e.data && typeof e.data === 'object' ? e.data : {}) as { slug?: unknown };
      const job = e.job ?? d.slug ?? null;
      if (e.type === 'job-page' && job === slug) void read();
      else if (hosted && (e.type === 'thread' || e.type === 'change') && (job === slug || e.job === null)) void read();
    });
  }, [read, events, slug, hosted]);

  return (
    <ReaderBody view="details" place="details:details" ready={work !== null}>
      {error && (
        <div className="jp2-dt-err">
          <p className="jp2-dim" role="alert">Couldn’t read the work: {error}</p>
          <Button size="sm" onClick={() => void read()} title={`Ask ${BRAND.name} for the work again.`}>Try again</Button>
        </div>
      )}
      {work && <Table work={work} hosted={hosted} slug={slug} />}
    </ReaderBody>
  );
}

function Table({ work, hosted, slug }: { work: Work; hosted: boolean; slug: string }) {
  return (
    <div className="jp2-dt">
      {work.rows.length === 0
        ? <p className="jp2-notyet">{work.note ?? 'No crew has worked on this job yet.'}</p>
        : (
          <div className="jp2-dt-wrap">
            <table className="jp2-dt-t">
              <thead><tr><th>Step</th><th>Who</th><th>Asked to</th><th>Took</th><th>Ended</th></tr></thead>
              <tbody>{work.rows.map((r) => <Row key={r.id} r={r} hosted={hosted} slug={slug} />)}</tbody>
            </table>
          </div>
        )}
      {work.rows.length > 0 && work.note && <p className="jp2-dim">{work.note}</p>}
      {work.costs.steps.length > 0 && (
        <>
          <h4 className="jp2-dt-h">Cost by step</h4>
          <div className="jp2-dt-wrap">
            <table className="jp2-dt-c">
              <tbody>
                {work.costs.steps.map((s) => <tr key={s.step}><td>{s.label}</td><td className="jp2-num">{money(s.usd)}</td></tr>)}
                <tr className="jp2-dt-sum"><td>All</td><td className="jp2-num">{money(work.costs.totalUsd)}</td></tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ r, hosted, slug }: { r: WorkRow; hosted: boolean; slug: string }) {
  const running = r.state === 'running';
  return (
    <tr className={running ? 'is-running' : undefined}>
      <td>{r.stepLabel ?? 'Between steps'}</td>
      <td>{r.role}{r.model && <div className="jp2-dim">{r.model}</div>}</td>
      <td>{r.task ?? 'Not known'}</td>
      <td className="jp2-num">{typeof r.durationMs === 'number' ? spentWords(r.durationMs) : ''}</td>
      <td>
        {running ? <b>{r.ended}</b> : r.ended}
        {!running && r.startedAt && <div className="jp2-dim">{sinceWords(r.startedAt)}</div>}
        {running && r.ref && !hosted && <Terminal r={r} slug={slug} />}
      </td>
    </tr>
  );
}

/** Open in terminal: that crew member in a terminal on this laptop (the step's terminal route, as today). */
function Terminal({ r, slug }: { r: WorkRow; slug: string }) {
  const { api } = useWorkshop();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ bad: boolean; text: string } | null>(null);
  async function go() {
    if (busy || !r.ref) return;
    setBusy(true);
    setSaid(null);
    try {
      const res = await api.post<{ demo?: boolean }>(`/api/job/${encodeURIComponent(slug)}/stage/${encodeURIComponent(r.step ?? 'build')}/terminal`, { ref: r.ref });
      setSaid({ bad: false, text: res?.demo ? `In the demo nothing opens; on your computer this opens the ${r.role} in a terminal.` : `Opened the ${r.role} in a terminal.` });
    } catch (err) {
      setSaid({ bad: true, text: `Couldn’t open it: ${words(err)}` });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="link-button" disabled={busy} onClick={() => void go()} title={`Open the ${r.role} in a terminal on this computer.`}>Open in terminal</button>
      {said && <div className={said.bad ? 'jp2-dt-bad' : 'jp2-dim'} role={said.bad ? 'alert' : 'status'}>{said.text}</div>}
    </div>
  );
}
