// Telemetry (#/telemetry, packet T, plan §7a): where the Claude usage goes and when the limit hits.
// At the top, the plan's two meters now and Read now (the primary action). Then the window picker
// (this five hours, this week, 30 days), which scopes every graph below it, and the five graphs:
//   1. Weekly limit over time: the weekly percent with its resets, the 5-hour one as a thin line,
//      and a dotted forecast from the last 24 hours ("At this pace, full on Thursday 14:00").
//   2. Use by day, by job: stacked columns, a colour and a pattern per job; a column's job opens it.
//   3. Cost per ticket and per stage: two small bar charts, the last 30 days, in dollars and in
//      percent of a week.
//   4. Share by model: one bar per plan week, split by model.
//   5. People on the account: one bar per person (names only).
// Each graph says its main fact in one sentence under it and has a table view. "Only yours" graphs
// name your jobs; "Whole account" ones never do (the dataset's `audience`, so v2 can filter).
// Colour never works alone: legends, names on bars, patterns, and the tables. Colours are the
// --tele-* tokens in Telemetry.css. Data: GET /api/telemetry?window= (dashboard/lib/telemetry.js),
// read again every minute while the page is open and after Read now.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { PlanUsage, UsageMeter } from '../api/types';
import { jobHref } from '../app/router';
import { resetsIn, WARN_AT } from '../components/UsageMeters';
import { clockTime, fullTime, useNow } from '../lib/time';
import { useWorkshop, useWorkshopState } from '../state/store';
import './Telemetry.css';

// ---------- What the dashboard sends (GET /api/telemetry) ----------

export type TelemetryWindow = '5h' | 'week' | '30d';
export type Audience = 'private' | 'common';
export interface Amount { usd: number; percent: number | null }
export interface GaugePoint { t: string; week: number | null; fiveHour: number | null }
export interface Forecast {
  state: 'fills' | 'resets-first' | 'flat' | 'full' | 'unknown';
  from: { t: string; percent: number } | null;
  to: { t: string; percent: number } | null;
  perHour: number | null;
  fullAt: string | null;
  resetsAt: string | null;
  atReset: number | null;
  sentence: string;
}
interface Base { title: string; audience: Audience; sentence: string }
export interface GaugeData extends Base { id: 'gauge'; from: string; to: string; points: GaugePoint[]; resets: string[]; forecast: Forecast }
export interface JobSeries extends Amount { slug: string | null; key: string; title: string; slot: number | 'other' }
export interface DayColumn extends Amount { day: string; label: string; parts: (Amount & { key: string })[] }
export interface ByDayJobData extends Base { id: 'by-day-job'; unit: 'percent' | 'usd'; jobs: JobSeries[]; days: DayColumn[] }
export interface CostRow extends Amount { key: string | null; label: string }
export interface CostData extends Base { id: 'cost'; span: '30d'; tickets: CostRow[]; stages: CostRow[] }
export interface ModelSeries { key: string; label: string; slot: number }
export interface ModelWeek { from: string; to: string; label: string; usd: number; parts: { key: string; usd: number; share: number }[] }
export interface ByModelData extends Base { id: 'by-model'; models: ModelSeries[]; weeks: ModelWeek[] }
export interface PeopleData extends Base { id: 'people'; people: (Amount & { user: string })[] }
export type Dataset = GaugeData | ByDayJobData | CostData | ByModelData | PeopleData;
export interface TelemetryResponse {
  window: TelemetryWindow;
  windowLabel: string;
  from: string;
  to: string;
  me: string | null;
  percentPerDollar: number | null;
  lines: number;
  datasets: Dataset[];
  meters: PlanUsage;
  file: string;
}

export const WINDOWS: { id: TelemetryWindow; label: string }[] = [
  { id: '5h', label: 'This five hours' },
  { id: 'week', label: 'This week' },
  { id: '30d', label: '30 days' },
];
const WINDOW_KEY = 'workshop.telemetryWindow';
const REFRESH_MS = 60_000;

// ---------- Words for numbers ----------

export const usd = (n: number) => `$${n.toFixed(2)}`;
export const pct = (n: number) => `${Math.round(n)}%`;
/** "51% of the week ($25.50)", or the dollars alone without the plan meters. */
export const amountWords = (a: Amount, of = 'of the week') => (a.percent === null ? usd(a.usd) : `${pct(a.percent)} ${of} (${usd(a.usd)})`);
const slotClass = (slot: number | 'other') => `tele-s${slot} tele-pat-${slot}`;
const timeWords = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** A round top for an axis: 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function readWindow(): TelemetryWindow {
  try {
    const w = window.localStorage.getItem(WINDOW_KEY);
    if (w === '5h' || w === 'week' || w === '30d') return w;
  } catch { /* storage blocked: this week */ }
  return 'week';
}

/** The width an element has, kept up to date (a fallback where nothing measures, as in tests). */
function useWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

// ---------- The page ----------

export function TelemetryView() {
  const { api } = useWorkshop();
  const [win, setWin] = useState<TelemetryWindow>(readWindow);
  const [data, setData] = useState<TelemetryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const asked = useRef(0);

  const load = useCallback(async (w: TelemetryWindow) => {
    const n = ++asked.current;
    setLoading(true);
    try {
      const body = await api.get<TelemetryResponse>(`/api/telemetry?window=${w}`);
      if (n !== asked.current) return;
      setData(body);
      setError(null);
    } catch (err) {
      if (n === asked.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (n === asked.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load(win);
    const id = setInterval(() => void load(win), REFRESH_MS);
    return () => clearInterval(id);
  }, [load, win]);

  const pick = (w: TelemetryWindow) => {
    setWin(w);
    try { window.localStorage.setItem(WINDOW_KEY, w); } catch { /* only this visit, then */ }
  };

  const byId = <T extends Dataset['id']>(id: T) => data?.datasets.find((d) => d.id === id) as Extract<Dataset, { id: T }> | undefined;
  const gauge = byId('gauge');
  const days = byId('by-day-job');
  const cost = byId('cost');
  const models = byId('by-model');
  const people = byId('people');

  return (
    <main className="tele" aria-label="Telemetry">
      <div className="tele-head">
        <h2 className="pane-title">Telemetry</h2>
        <p className="muted tele-intro">
          Where the Claude usage goes and when the limit hits. Every Foreman turn on this computer is one line in {data?.file ? <code>{data.file}</code> : 'the usage log'}; nothing is sent anywhere.
        </p>
      </div>
      <PlanNow fallback={data?.meters ?? null} onRead={() => void load(win)} />
      <div className="tele-windows" role="group" aria-label="Window: what every graph below covers">
        {WINDOWS.map((w) => (
          <button key={w.id} type="button" className="btn" aria-pressed={win === w.id} onClick={() => pick(w.id)} title={`Show ${w.label.toLowerCase()} in every graph.`}>
            <span className="tele-check" aria-hidden="true">{win === w.id ? '✓' : ''}</span>{w.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="thread-error" role="alert">
          Couldn’t read the usage log: {error}{' '}
          <button type="button" className="btn btn-quiet" onClick={() => void load(win)} title="Ask the dashboard again.">Try again</button>
        </p>
      )}
      {!data && loading && <p className="muted" role="status">Reading the usage log…</p>}
      {data && (
        <div className={`tele-grid${loading ? ' is-loading' : ''}`} aria-busy={loading}>
          {gauge && <Card data={gauge} wide table={<GaugeTable data={gauge} />}><GaugeChart data={gauge} window={data.window} /></Card>}
          {days && <Card data={days} wide table={<DaysTable data={days} />}><DaysChart data={days} /></Card>}
          {cost && <Card data={cost} table={<CostTables data={cost} />}><CostCharts data={cost} /></Card>}
          {models && <Card data={models} table={<ModelsTable data={models} />}><ModelsChart data={models} /></Card>}
          {people && <Card data={people} table={<PeopleTable data={people} />}><PeopleChart data={people} /></Card>}
        </div>
      )}
    </main>
  );
}

// ---------- The meters now, with Read now ----------

function PlanNow({ fallback, onRead }: { fallback: PlanUsage | null; onRead: () => void }) {
  const { planUsage } = useWorkshopState();
  const { api, store } = useWorkshop();
  const now = useNow(30_000);
  const [reading, setReading] = useState(false);
  const u = planUsage ?? fallback;
  if (!u || !u.enabled) {
    return (
      <section className="tele-now" aria-label="Claude plan usage now">
        <p className="muted" style={{ margin: 0 }}>The plan’s usage isn’t read on this dashboard (demo mode, or it is turned off), so there are no meters here and the graphs show dollars only.</p>
      </section>
    );
  }
  async function readNow() {
    setReading(true);
    try {
      const fresh = await api.post<PlanUsage>('/api/usage/check', {});
      store.dispatch({ type: 'plan-usage', planUsage: fresh });
      onRead();
    } catch { /* the next minute's reading tries again */ } finally {
      setReading(false);
    }
  }
  return (
    <section className="tele-now" aria-label="Claude plan usage now">
      <Meter name="5-hour limit" meter={u.fiveHour} when={(m) => `Resets ${resetsIn(m.resetsAt, now)}`} />
      <Meter name="Weekly limit" meter={u.week} when={(m) => (m.resetsAt ? `Resets ${clockTime(m.resetsAt, now)}` : '')} />
      <div className="tele-now-foot">
        {u.error && <span className="perm-warn" role="alert">⚠ The last read failed: {u.error}</span>}
        <span className="muted">{u.checkedAt ? `Read ${clockTime(u.checkedAt, now)}` : 'Not read yet'}</span>
        <button type="button" className="btn btn-primary" onClick={() => void readNow()} disabled={reading} title="Read the plan’s usage from Claude now (it is read every minute by itself).">{reading ? 'Reading…' : 'Read now'}</button>
      </div>
    </section>
  );
}

function Meter({ name, meter, when }: { name: string; meter: UsageMeter | null; when: (m: UsageMeter) => string }) {
  if (!meter) return <div className="tele-meter"><span className="tele-meter-name">{name}</span><span className="muted">Not read yet</span></div>;
  const level = meter.percent >= 100 ? 'full' : meter.percent >= WARN_AT ? 'warn' : 'ok';
  const words = meter.percent >= 100 ? 'Limit reached' : `${meter.percent}% used`;
  return (
    <div className={`tele-meter is-${level}`} data-meter={name}>
      <span className="tele-meter-name">{name}</span>
      <span className="tele-meter-bar" aria-hidden="true"><span className="tele-meter-fill" style={{ width: `${Math.min(100, meter.percent)}%` }} /></span>
      <span className="num">{level !== 'ok' && <span aria-hidden="true">⚠ </span>}{words}</span>
      <span className="tele-meter-reset muted" title={meter.resetsAt ? fullTime(meter.resetsAt) : undefined}>{when(meter)}</span>
    </div>
  );
}

// ---------- A graph's card: title, who sees it, graph or table, and its sentence ----------

const AUDIENCE: Record<Audience, { label: string; hint: string }> = {
  private: { label: 'Only yours', hint: 'Your own work, with your job names. Only you see it.' },
  common: { label: 'Whole account', hint: 'About the shared Claude account, with no job names: the kind of graph the whole team can see.' },
};

function Card({ data, wide = false, table, children }: { data: Dataset; wide?: boolean; table: ReactNode; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <section className={`tele-card${wide ? ' tele-card-wide' : ''}`} aria-labelledby={`${id}-title`} data-dataset={data.id} data-audience={data.audience}>
      <div className="tele-card-head">
        <h3 id={`${id}-title`} className="tele-card-title">{data.title}</h3>
        <span className="chip tele-audience" title={AUDIENCE[data.audience].hint}>{AUDIENCE[data.audience].label}</span>
        <button type="button" className="btn btn-quiet" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} title={asTable ? 'Show this as a graph again.' : 'Show the numbers behind this graph as a table (for copying, and for screen readers).'}>
          {asTable ? 'Show the graph' : 'Show as a table'}
        </button>
      </div>
      {asTable ? <div className="tele-table-wrap">{table}</div> : children}
      <p className="tele-fact">{data.sentence}</p>
    </section>
  );
}

function Tip({ x, y, head, rows }: { x: number; y: number; head: string; rows: { key?: ReactNode; value: string; name: string }[] }) {
  return (
    <div className="tele-tip" aria-hidden="true" style={{ left: x, top: y }}>
      <div className="tele-tip-head">{head}</div>
      {rows.map((r, i) => <div key={i} className="tele-tip-row">{r.key}<strong>{r.value}</strong><span>{r.name}</span></div>)}
    </div>
  );
}

// ---------- 1. The weekly limit over time ----------

const G_H = 200;
const G_M = { l: 40, r: 16, t: 18, b: 26 };

function xTicks(from: number, to: number, window: TelemetryWindow): number[] {
  const out: number[] = [];
  const d = new Date(from);
  if (window === '5h') {
    d.setMinutes(0, 0, 0);
    for (d.setHours(d.getHours() + 1); d.getTime() <= to; d.setHours(d.getHours() + 1)) out.push(d.getTime());
    return out;
  }
  d.setHours(0, 0, 0, 0);
  const step = window === '30d' ? 7 : 1;
  for (d.setDate(d.getDate() + 1); d.getTime() <= to; d.setDate(d.getDate() + step)) out.push(d.getTime());
  return out;
}
const tickLabel = (t: number, window: TelemetryWindow) => (window === '5h'
  ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  : new Date(t).toLocaleDateString('en-GB', window === '30d' ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric' }));

export function GaugeChart({ data, window }: { data: GaugeData; window: TelemetryWindow }) {
  const [ref, width] = useWidth();
  const [at, setAt] = useState<number | null>(null);
  const pts = data.points.map((p) => ({ ...p, ms: Date.parse(p.t) }));
  const fc = data.forecast;
  // The dotted forecast, to where the week fills or resets (not on the five-hour view: too short to show it).
  const fcEnd = fc.state === 'fills' ? fc.fullAt : fc.state === 'resets-first' ? fc.resetsAt : null;
  const showFc = window !== '5h' && fc.to && fcEnd;
  const x0 = Date.parse(data.from);
  const x1 = Math.max(showFc ? Date.parse(fcEnd!) : Date.parse(data.to), x0 + 60_000);
  const w = Math.max(width, 240);
  const sx = (t: number) => G_M.l + ((t - x0) / (x1 - x0)) * (w - G_M.l - G_M.r);
  const sy = (p: number) => G_M.t + (1 - Math.min(100, Math.max(0, p)) / 100) * (G_H - G_M.t - G_M.b);
  const line = (key: 'week' | 'fiveHour') => pts.filter((p) => p[key] !== null).map((p, i) => `${i ? 'L' : 'M'}${sx(p.ms).toFixed(1)},${sy(p[key]!).toFixed(1)}`).join('');
  if (!pts.length) return <p className="muted tele-empty">No reading of the limits in this window.</p>;
  // Labels at least 64px apart: on a narrow screen every second (or third) one.
  const all = xTicks(x0, x1, window);
  const gap = all.length > 1 ? sx(all[1]) - sx(all[0]) : Infinity;
  const ticks = all.filter((_, i) => i % Math.max(1, Math.ceil(64 / gap)) === 0);
  const hovered = at === null ? null : pts[at];
  const last = pts[pts.length - 1];

  const nearest = (clientX: number, box: DOMRect) => {
    const t = x0 + ((clientX - box.left - G_M.l) / (w - G_M.l - G_M.r)) * (x1 - x0);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].ms - t) < Math.abs(pts[best].ms - t)) best = i;
    return best;
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => setAt(nearest(e.clientX, e.currentTarget.getBoundingClientRect()));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const last = pts.length - 1;
    const next = e.key === 'ArrowLeft' ? Math.max(0, (at ?? last + 1) - 1) : e.key === 'ArrowRight' ? Math.min(last, (at ?? -1) + 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (e.key === 'Escape') { setAt(null); return; }
    if (next === null) return;
    e.preventDefault();
    setAt(next);
  };

  return (
    <div className="tele-plot" ref={ref}>
      <ul className="tele-legend" aria-label="Key">
        <li><span className="tele-key-line" aria-hidden="true" />Weekly limit</li>
        <li><span className="tele-key-line is-thin" aria-hidden="true" />5-hour limit</li>
        {showFc && <li><span className="tele-key-line is-dotted" aria-hidden="true" />Forecast at the last day’s pace</li>}
      </ul>
      <svg
        className="tele-svg" width={w} height={G_H} viewBox={`0 0 ${w} ${G_H}`} role="img" tabIndex={0}
        aria-label={`${data.title}: ${data.sentence} Left and right arrows read each point.`}
        onPointerMove={onMove} onPointerLeave={() => setAt(null)} onKeyDown={onKey} onBlur={() => setAt(null)}
      >
        {[0, 50, 80, 100].map((p) => (
          <g key={p}>
            <line className={p === 0 ? 'axis' : 'grid'} x1={G_M.l} x2={w - G_M.r} y1={sy(p)} y2={sy(p)} />
            <text className="tick" x={G_M.l - 6} y={sy(p) + 4} textAnchor="end">{p}%</text>
          </g>
        ))}
        {ticks.map((t) => <text key={t} className="tick" x={sx(t)} y={G_H - 8} textAnchor="middle">{tickLabel(t, window)}</text>)}
        {data.resets.map((r) => (
          <g key={r}>
            <line className="reset" x1={sx(Date.parse(r))} x2={sx(Date.parse(r))} y1={G_M.t} y2={sy(0)} />
            <text className="reset-label" x={sx(Date.parse(r)) + 4} y={G_M.t - 6}>Reset</text>
          </g>
        ))}
        <path className="five" d={line('fiveHour')} />
        <path className="week" d={line('week')} />
        {/* The latest reading, as dots with its value: a line needs two points, the five-hour window may have one. */}
        {last.fiveHour !== null && <circle className="dot five-dot" cx={sx(last.ms)} cy={sy(last.fiveHour)} r={3} />}
        {last.week !== null && (
          <g>
            <circle className="dot week-dot" cx={sx(last.ms)} cy={sy(last.week)} r={4} />
            <text className="end-label" x={sx(last.ms) - 8} y={sy(last.week) - 10} textAnchor="end">{pct(last.week)} now</text>
          </g>
        )}
        {showFc && fc.to && (
          <g>
            <path className="forecast" d={`M${sx(Date.parse(fc.to.t)).toFixed(1)},${sy(fc.to.percent).toFixed(1)}L${sx(Date.parse(fcEnd!)).toFixed(1)},${sy(fc.state === 'fills' ? 100 : fc.atReset ?? 100).toFixed(1)}`} />
            <circle className="dot week-dot" cx={sx(Date.parse(fcEnd!))} cy={sy(fc.state === 'fills' ? 100 : fc.atReset ?? 100)} r={4} />
            <text className="end-label" x={sx(Date.parse(fcEnd!)) - 8} y={sy(fc.state === 'fills' ? 100 : fc.atReset ?? 100) - 8} textAnchor="end">
              {fc.state === 'fills' ? `Full ${timeWords(fcEnd!)}` : `About ${pct(fc.atReset ?? 0)} at the reset`}
            </text>
          </g>
        )}
        {hovered && (
          <g>
            <line className="cross" x1={sx(hovered.ms)} x2={sx(hovered.ms)} y1={G_M.t} y2={sy(0)} />
            {hovered.fiveHour !== null && <circle className="dot five-dot" cx={sx(hovered.ms)} cy={sy(hovered.fiveHour)} r={4} />}
            {hovered.week !== null && <circle className="dot week-dot" cx={sx(hovered.ms)} cy={sy(hovered.week)} r={4} />}
          </g>
        )}
        <rect className="hit" x={G_M.l} y={G_M.t} width={Math.max(0, w - G_M.l - G_M.r)} height={G_H - G_M.t - G_M.b} />
      </svg>
      {hovered && (
        <Tip
          x={sx(hovered.ms)} y={Math.min(sy(hovered.week ?? 0), sy(hovered.fiveHour ?? 0)) + 30}
          head={timeWords(hovered.t)}
          rows={[
            ...(hovered.week !== null ? [{ key: <span className="tele-tip-key" />, value: pct(hovered.week), name: 'weekly limit' }] : []),
            ...(hovered.fiveHour !== null ? [{ key: <span className="tele-tip-key k2" />, value: pct(hovered.fiveHour), name: '5-hour limit' }] : []),
          ]}
        />
      )}
    </div>
  );
}

function GaugeTable({ data }: { data: GaugeData }) {
  return (
    <table className="tele-table">
      <caption>{data.sentence}{data.resets.length ? ` The week reset at ${data.resets.map(timeWords).join(', ')}.` : ''}</caption>
      <thead><tr><th scope="col">When</th><th scope="col" className="n">Weekly limit used</th><th scope="col" className="n">5-hour limit used</th></tr></thead>
      <tbody>
        {data.points.map((p) => <tr key={p.t}><td>{timeWords(p.t)}</td><td className="n">{p.week === null ? 'Not read' : pct(p.week)}</td><td className="n">{p.fiveHour === null ? 'Not read' : pct(p.fiveHour)}</td></tr>)}
      </tbody>
    </table>
  );
}

// ---------- 2. Use by day, by job ----------

const C_H = 180;
const C_TOP = 16; // room for the tallest column's cap

export function DaysChart({ data }: { data: ByDayJobData }) {
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const val = (a: Amount) => (data.unit === 'percent' ? a.percent ?? 0 : a.usd);
  const words = (a: Amount) => (data.unit === 'percent' ? amountWords(a) : usd(a.usd));
  const jobOf = new Map(data.jobs.map((j) => [j.key, j]));
  const max = niceMax(Math.max(0, ...data.days.map(val)));
  const plotH = C_H - C_TOP;
  const tickWords = (v: number) => (data.unit === 'percent' ? `${Math.round(v)}%` : `$${v % 1 ? v.toFixed(1) : v}`);
  if (!data.days.some((d) => d.usd > 0)) return <p className="muted tele-empty">None of your jobs used Claude in this window.</p>;
  const peak = data.days.reduce((b, d, i) => (val(d) > val(data.days[b]) ? i : b), 0);
  const every = data.days.length > 10 ? 7 : 1;
  const show = (i: number, el: HTMLElement) => {
    const outer = box.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setTip({ i, x: r.left - (outer?.left ?? 0) + r.width / 2, y: r.top - (outer?.top ?? 0) + C_TOP + 20 });
  };
  const dayWords = (d: DayColumn) => `${d.label}: ${words(d)} in all${d.parts.length ? `; ${d.parts.map((p) => `${jobOf.get(p.key)?.title ?? p.key} ${words(p)}`).join(', ')}` : ''}.`;
  return (
    <div className="tele-plot" ref={box}>
      <ul className="tele-legend" aria-label="Jobs">
        {data.jobs.map((j) => (
          <li key={j.key}>
            {j.slug
              ? <a href={jobHref(j.slug)} title={`Open ${j.title}.`}><span className={`tele-swatch ${slotClass(j.slot)}`} aria-hidden="true" />{j.title}</a>
              : <><span className={`tele-swatch ${slotClass(j.slot)}`} aria-hidden="true" />{j.title}</>}
          </li>
        ))}
      </ul>
      <div className="tele-cols-wrap">
        <div className="tele-yaxis" aria-hidden="true">
          {[0, max / 2, max].map((v) => <span key={v} style={{ bottom: (v / max) * plotH }}>{tickWords(v)}</span>)}
        </div>
        <div className="tele-cols" role="list" aria-label={`${data.title}, one column a day`}>
          {[max / 2, max].map((v) => <span key={v} className="tele-gridline" style={{ bottom: (v / max) * plotH }} aria-hidden="true" />)}
          {data.days.map((d, i) => (
            <div
              key={d.day} role="listitem" className="tele-col" tabIndex={0} aria-label={dayWords(d)}
              onPointerEnter={(e) => show(i, e.currentTarget)} onPointerLeave={() => setTip(null)}
              onFocus={(e) => show(i, e.currentTarget)} onBlur={() => setTip(null)}
            >
              {i === peak && <span className="tele-col-cap" aria-hidden="true">{data.unit === 'percent' ? pct(d.percent ?? 0) : usd(d.usd)}</span>}
              <div className="tele-stack" style={{ height: (val(d) / max) * plotH }}>
                {d.parts.map((p) => {
                  const j = jobOf.get(p.key);
                  return j?.slug
                    ? <a key={p.key} href={jobHref(j.slug)} tabIndex={-1} className={`tele-seg ${slotClass(j.slot)}`} style={{ flexGrow: val(p) }} aria-label={`Open ${j.title}`} />
                    : <span key={p.key} className={`tele-seg ${slotClass(j?.slot ?? 'other')}`} style={{ flexGrow: val(p) }} />;
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="tele-xlabels" aria-hidden="true">
          {data.days.map((d, i) => <span key={d.day}>{i % every === 0 || i === data.days.length - 1 ? d.label.replace(/^\w+ /, '') : ''}</span>)}
        </div>
      </div>
      {tip && data.days[tip.i] && (
        <Tip
          x={tip.x} y={tip.y} head={`${data.days[tip.i].label} · ${words(data.days[tip.i])}`}
          rows={[...data.days[tip.i].parts].reverse().map((p) => ({ key: <span className={`tele-swatch ${slotClass(jobOf.get(p.key)?.slot ?? 'other')}`} />, value: words(p), name: jobOf.get(p.key)?.title ?? p.key }))}
        />
      )}
    </div>
  );
}

function DaysTable({ data }: { data: ByDayJobData }) {
  const words = (a: Amount | undefined) => (!a ? '—' : data.unit === 'percent' ? amountWords(a) : usd(a.usd));
  return (
    <table className="tele-table">
      <thead>
        <tr>
          <th scope="col">Day</th>
          {data.jobs.map((j) => <th key={j.key} scope="col" className="n">{j.slug ? <a href={jobHref(j.slug)}>{j.title}</a> : j.title}</th>)}
          <th scope="col" className="n">All</th>
        </tr>
      </thead>
      <tbody>
        {data.days.map((d) => (
          <tr key={d.day}><td>{d.label}</td>{data.jobs.map((j) => <td key={j.key} className="n">{words(d.parts.find((p) => p.key === j.key))}</td>)}<td className="n">{words(d)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- 3. Cost per ticket and per stage ----------

const MAX_ROWS = 8;
/** The first rows, and the rest added up as one "Others" row. */
export function fold(rows: CostRow[], others: string): CostRow[] {
  if (rows.length <= MAX_ROWS) return rows;
  const rest = rows.slice(MAX_ROWS - 1);
  const p = rest.every((r) => r.percent === null) ? null : rest.reduce((s, r) => s + (r.percent ?? 0), 0);
  return [...rows.slice(0, MAX_ROWS - 1), { key: null, label: `${others} (${rest.length})`, usd: rest.reduce((s, r) => s + r.usd, 0), percent: p }];
}

function HBars({ rows, label, of }: { rows: { key: string; label: string; usd: number; percent: number | null }[]; label: string; of: string }) {
  const max = Math.max(0, ...rows.map((r) => r.usd)) || 1;
  return (
    <ul className="tele-hbars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="tele-hbar" aria-label={`${r.label}: ${amountWords(r, of)}`}>
          <span className="tele-hbar-label" title={r.label}>{r.label}</span>
          <span className="tele-hbar-track">
            <span className="tele-hbar-fill tele-s1" style={{ width: `calc((100% - 9em) * ${(r.usd / max).toFixed(4)})` }} aria-hidden="true" />
            <span className="tele-hbar-value num">{r.percent === null ? usd(r.usd) : `${usd(r.usd)} · ${pct(r.percent)}`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CostCharts({ data }: { data: CostData }) {
  if (!data.tickets.length) return <p className="muted tele-empty">Nothing recorded for your jobs in the last 30 days.</p>;
  const rows = (list: CostRow[], others: string) => fold(list, others).map((r, i) => ({ ...r, key: r.key ?? `others-${i}` }));
  return (
    <div className="tele-pair">
      <div><p className="tele-sub">Per ticket, last 30 days</p><HBars rows={rows(data.tickets, 'Other tickets')} label="Cost per ticket" of="of a week" /></div>
      <div><p className="tele-sub">Per stage, last 30 days</p><HBars rows={rows(data.stages, 'Other stages')} label="Cost per stage" of="of a week" /></div>
    </div>
  );
}

function CostTables({ data }: { data: CostData }) {
  const table = (caption: string, head: string, list: CostRow[]) => (
    <table className="tele-table">
      <caption>{caption}</caption>
      <thead><tr><th scope="col">{head}</th><th scope="col" className="n">Cost</th><th scope="col" className="n">Share of a week</th></tr></thead>
      <tbody>{list.map((r, i) => <tr key={r.key ?? i}><td>{r.label}</td><td className="n">{usd(r.usd)}</td><td className="n">{r.percent === null ? 'Not known' : pct(r.percent)}</td></tr>)}</tbody>
    </table>
  );
  return <>{table('Per ticket, last 30 days', 'Ticket', data.tickets)}{table('Per stage, last 30 days', 'Stage', data.stages)}</>;
}

// ---------- 4. Share by model ----------

export function ModelsChart({ data }: { data: ByModelData }) {
  const [tip, setTip] = useState<{ text: string; head: string; slot: number; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const model = new Map(data.models.map((m) => [m.key, m]));
  if (!data.weeks.some((w) => w.usd > 0)) return <p className="muted tele-empty">Nothing recorded in this window.</p>;
  const show = (el: HTMLElement, head: string, text: string, slot: number) => {
    const outer = box.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setTip({ head, text, slot, x: r.left - (outer?.left ?? 0) + r.width / 2, y: r.top - (outer?.top ?? 0) });
  };
  return (
    <div className="tele-plot" ref={box}>
      <ul className="tele-legend" aria-label="Models">
        {data.models.map((m) => <li key={m.key}><span className={`tele-swatch ${slotClass(m.slot)}`} aria-hidden="true" />{m.label}</li>)}
      </ul>
      <ul className="tele-shares">
        {data.weeks.filter((w) => w.usd > 0).map((w) => (
          <li key={w.from} className="tele-share">
            <span className="tele-hbar-label">{w.label}</span>
            <span className="tele-share-bar">
              {w.parts.filter((p) => p.usd > 0).map((p) => {
                const m = model.get(p.key);
                const text = `${pct(p.share * 100)} (${usd(p.usd)})`;
                return (
                  <span
                    key={p.key} className={`tele-share-seg ${slotClass(m?.slot ?? 8)}`} style={{ flexGrow: p.share }} tabIndex={0} role="img"
                    aria-label={`${w.label}, ${m?.label ?? p.key}: ${text}`}
                    onPointerEnter={(e) => show(e.currentTarget, w.label, text, m?.slot ?? 8)} onPointerLeave={() => setTip(null)}
                    onFocus={(e) => show(e.currentTarget, w.label, text, m?.slot ?? 8)} onBlur={() => setTip(null)}
                  />
                );
              })}
            </span>
            <span className="tele-share-total num">{usd(w.usd)}</span>
          </li>
        ))}
      </ul>
      {tip && <Tip x={tip.x} y={tip.y} head={tip.head} rows={[{ key: <span className={`tele-swatch ${slotClass(tip.slot)}`} />, value: tip.text, name: data.models.find((m) => m.slot === tip.slot)?.label ?? '' }]} />}
    </div>
  );
}

function ModelsTable({ data }: { data: ByModelData }) {
  return (
    <table className="tele-table">
      <thead><tr><th scope="col">Week</th>{data.models.map((m) => <th key={m.key} scope="col" className="n">{m.label}</th>)}<th scope="col" className="n">All</th></tr></thead>
      <tbody>
        {data.weeks.map((w) => (
          <tr key={w.from}>
            <td>{w.label}</td>
            {data.models.map((m) => { const p = w.parts.find((x) => x.key === m.key); return <td key={m.key} className="n">{p ? `${pct(p.share * 100)} (${usd(p.usd)})` : '—'}</td>; })}
            <td className="n">{usd(w.usd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- 5. People on the account ----------

export function PeopleChart({ data }: { data: PeopleData }) {
  if (!data.people.length) return <p className="muted tele-empty">Nobody used the account in this window, as far as this computer knows.</p>;
  return <HBars rows={data.people.map((p) => ({ key: p.user, label: p.user, usd: p.usd, percent: p.percent }))} label="Use per person" of="of the week" />;
}

function PeopleTable({ data }: { data: PeopleData }) {
  return (
    <table className="tele-table">
      <thead><tr><th scope="col">Person</th><th scope="col" className="n">Cost</th><th scope="col" className="n">Share of the week</th></tr></thead>
      <tbody>{data.people.map((p) => <tr key={p.user}><td>{p.user}</td><td className="n">{usd(p.usd)}</td><td className="n">{p.percent === null ? 'Not known' : pct(p.percent)}</td></tr>)}</tbody>
    </table>
  );
}
