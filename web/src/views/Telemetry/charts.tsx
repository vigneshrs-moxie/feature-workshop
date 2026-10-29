// The ten insight graphs' pictures (views/Telemetry.tsx puts each in its card). Every series has a
// colour and a pattern (slotClass: --chart-n and --chart-pattern-n), a legend or a name on the
// mark, and the card's Table ▸ has the numbers; colour never works alone. Hover or keyboard focus
// shows a mark's numbers on the line and the weekday map; the arrow keys step through them.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { CacheData, LimitData, ModelsData, PeopleData, Pr1Data, ReworkData, StagesData, TelemetryGraph, TicketCostData, WaitingData, WhenData } from '../../api/types';
import { niceMax, OTHER_SLOT, pct, slotClass, usd, weekTick } from './words';

/** The width an element has, kept up to date (a fallback where nothing measures, as in tests). */
export function useWidth(fallback = 520) {
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

const timeWords = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function Legend({ items }: { items: { key: string; label: ReactNode; mark: ReactNode }[] }) {
  return (
    <ul className="tele-legend" aria-label="Key">
      {items.map((i) => <li key={i.key}>{i.mark}{i.label}</li>)}
    </ul>
  );
}
export const Swatch = ({ slot, extra = '' }: { slot: number; extra?: string }) => <span className={`tele-swatch ${slotClass(slot)} ${extra}`.trim()} aria-hidden="true" />;
const Empty = ({ children }: { children: ReactNode }) => <p className="muted tele-empty">{children}</p>;

/** The picture for one graph, by its id. */
export function GraphPicture({ graph }: { graph: TelemetryGraph }) {
  if (graph.state === 'cannot-see') return null; // its note says what it waits for
  switch (graph.id) {
    case 'limit': return <LimitChart data={graph.data} />;
    case 'ticket-cost': return <TicketCostChart data={graph.data} />;
    case 'stages': return <StagesChart data={graph.data} />;
    case 'models': return <ModelsChart data={graph.data} />;
    case 'people': return <PeopleChart data={graph.data} />;
    case 'rework': return <ReworkChart data={graph.data} />;
    case 'waiting': return <WaitingChart data={graph.data} />;
    case 'pr1': return <Pr1Chart data={graph.data} />;
    case 'when': return <WhenChart data={graph.data} />;
    case 'cache': return <CacheChart data={graph.data} />;
    default: return null;
  }
}

// ---------- 1. Weekly limit and forecast ----------

const G_H = 196;
const G_M = { l: 44, r: 16, t: 20, b: 26 };

function dayTicks(from: number, to: number, five: boolean): number[] {
  const out: number[] = [];
  const d = new Date(from);
  if (five) {
    d.setMinutes(0, 0, 0);
    for (d.setHours(d.getHours() + 1); d.getTime() <= to; d.setHours(d.getHours() + 1)) out.push(d.getTime());
    return out;
  }
  d.setHours(0, 0, 0, 0);
  const step = to - from > 10 * 864e5 ? 7 : 1;
  for (d.setDate(d.getDate() + 1); d.getTime() <= to; d.setDate(d.getDate() + step)) out.push(d.getTime());
  return out;
}

export function LimitChart({ data }: { data: LimitData }) {
  const [ref, width] = useWidth();
  const [at, setAt] = useState<number | null>(null);
  const pts = data.points.map((p) => ({ ...p, ms: Date.parse(p.t) }));
  const fc = data.forecast;
  const five = data.window === '5h';
  const fcEnd = fc.state === 'fills' ? fc.fullAt : fc.state === 'resets-first' ? fc.resetsAt : null;
  const showFc = !five && fc.to && fcEnd;
  if (!pts.length) return <Empty>No reading of the limits in this window yet.</Empty>;
  const x0 = Date.parse(data.from);
  const x1 = Math.max(showFc ? Date.parse(fcEnd!) : Date.parse(data.to), x0 + 60_000);
  const w = Math.max(width, 260);
  const sx = (t: number) => G_M.l + ((t - x0) / (x1 - x0)) * (w - G_M.l - G_M.r);
  const sy = (p: number) => G_M.t + (1 - Math.min(100, Math.max(0, p)) / 100) * (G_H - G_M.t - G_M.b);
  const line = (key: 'week' | 'fiveHour') => pts.filter((p) => p[key] !== null).map((p, i) => `${i ? 'L' : 'M'}${sx(p.ms).toFixed(1)},${sy(p[key]!).toFixed(1)}`).join('');
  const all = dayTicks(x0, x1, five);
  const gap = all.length > 1 ? sx(all[1]) - sx(all[0]) : Infinity;
  const ticks = all.filter((_, i) => i % Math.max(1, Math.ceil(56 / gap)) === 0);
  const hovered = at === null ? null : pts[at];
  const last = pts[pts.length - 1];
  const fcY = fc.state === 'fills' ? 100 : fc.atReset ?? 100;
  const nearest = (clientX: number, box: DOMRect) => {
    const t = x0 + ((clientX - box.left - G_M.l) / (w - G_M.l - G_M.r)) * (x1 - x0);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].ms - t) < Math.abs(pts[best].ms - t)) best = i;
    return best;
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => setAt(nearest(e.clientX, e.currentTarget.getBoundingClientRect()));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const end = pts.length - 1;
    if (e.key === 'Escape') { setAt(null); return; }
    const next = e.key === 'ArrowLeft' ? Math.max(0, (at ?? end + 1) - 1) : e.key === 'ArrowRight' ? Math.min(end, (at ?? -1) + 1) : e.key === 'Home' ? 0 : e.key === 'End' ? end : null;
    if (next === null) return;
    e.preventDefault();
    setAt(next);
  };
  return (
    <div className="tele-plot" ref={ref}>
      <Legend items={[
        { key: 'w', mark: <span className="tele-key-line" aria-hidden="true" />, label: 'This week' },
        { key: 'f', mark: <span className="tele-key-line is-thin" aria-hidden="true" />, label: '5-hour limit' },
        ...(showFc ? [{ key: 'p', mark: <span className="tele-key-line is-dotted" aria-hidden="true" />, label: 'At the last day’s pace' }] : []),
      ]} />
      <svg
        className="tele-svg" width={w} height={G_H} viewBox={`0 0 ${w} ${G_H}`} role="img" tabIndex={0} data-arrows="limit"
        aria-label={`Weekly limit over ${data.window === '5h' ? 'this five hours' : data.window === 'week' ? 'this week' : 'the last 30 days'}, with the forecast. Left and right arrows read each reading.`}
        onPointerMove={onMove} onPointerLeave={() => setAt(null)} onKeyDown={onKey} onBlur={() => setAt(null)}
      >
        {[0, 50, 80, 90, 100].map((p) => (
          <g key={p}>
            <line className={p === 0 ? 'axis' : p === 80 || p === 90 ? 'grid is-mark' : 'grid'} x1={G_M.l} x2={w - G_M.r} y1={sy(p)} y2={sy(p)} />
            <text className="tick" x={G_M.l - 6} y={sy(p) + 4} textAnchor="end">{p}%</text>
          </g>
        ))}
        {ticks.map((t) => <text key={t} className="tick" x={sx(t)} y={G_H - 8} textAnchor="middle">{five ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : new Date(t).toLocaleDateString('en-GB', all.length > 10 ? { day: 'numeric', month: 'short' } : { weekday: 'short' })}</text>)}
        {data.resets.map((r) => (
          <g key={r}>
            <line className="reset" x1={sx(Date.parse(r))} x2={sx(Date.parse(r))} y1={G_M.t} y2={sy(0)} />
            <text className="reset-label" x={sx(Date.parse(r)) + 4} y={G_M.t - 6}>Reset</text>
          </g>
        ))}
        <path className="five" d={line('fiveHour')} />
        <path className="week" d={line('week')} />
        {last.week !== null && (
          <g>
            <circle className="dot week-dot" cx={sx(last.ms)} cy={sy(last.week)} r={4.5} />
            <text className="end-label" x={sx(last.ms) - 8} y={sy(last.week) - 10} textAnchor="end">{pct(last.week)} now</text>
          </g>
        )}
        {showFc && fc.to && (
          <g>
            <path className="forecast" d={`M${sx(Date.parse(fc.to.t)).toFixed(1)},${sy(fc.to.percent).toFixed(1)}L${sx(Date.parse(fcEnd!)).toFixed(1)},${sy(fcY).toFixed(1)}`} />
            <circle className="dot week-dot" cx={sx(Date.parse(fcEnd!))} cy={sy(fcY)} r={4} />
            <text className="end-label" x={sx(Date.parse(fcEnd!)) - 8} y={sy(fcY) + (fcY > 90 ? 16 : -8)} textAnchor="end">
              {fc.state === 'fills' ? `Full ${timeWords(fcEnd!)}` : `About ${pct(fc.atReset ?? 0)} at the reset`}
            </text>
          </g>
        )}
        {hovered && (
          <g>
            <line className="cross" x1={sx(hovered.ms)} x2={sx(hovered.ms)} y1={G_M.t} y2={sy(0)} />
            {hovered.fiveHour !== null && <circle className="dot five-dot" cx={sx(hovered.ms)} cy={sy(hovered.fiveHour)} r={4} />}
            {hovered.week !== null && <circle className="dot week-dot" cx={sx(hovered.ms)} cy={sy(hovered.week)} r={4.5} />}
          </g>
        )}
        <rect className="hit" x={G_M.l} y={G_M.t} width={Math.max(0, w - G_M.l - G_M.r)} height={G_H - G_M.t - G_M.b} />
      </svg>
      {hovered && (
        <div className="tele-tip" aria-hidden="true" style={{ left: sx(hovered.ms), top: Math.min(sy(hovered.week ?? 0), sy(hovered.fiveHour ?? 0)) + 24 }}>
          <div className="tele-tip-head">{timeWords(hovered.t)}</div>
          <div className="tele-tip-row"><strong>{hovered.week === null ? 'Not read' : pct(hovered.week)}</strong><span>week</span>{' · '}<strong>{hovered.fiveHour === null ? 'Not read' : pct(hovered.fiveHour)}</strong><span>5 hours</span></div>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{hovered ? `${timeWords(hovered.t)}: week ${hovered.week === null ? 'not read' : pct(hovered.week)}, 5 hours ${hovered.fiveHour === null ? 'not read' : pct(hovered.fiveHour)}.` : ''}</p>
    </div>
  );
}

// ---------- 2. Cost per finished ticket, by week ----------

export function TicketCostChart({ data }: { data: TicketCostData }) {
  const weeks = data.weeks;
  if (!weeks.some((w) => w.median !== null)) return <Empty>No finished tickets in the last eight weeks yet.</Empty>;
  const top = data.cap ?? Math.max(...weeks.map((w) => w.high ?? 0));
  const max = niceMax(top);
  const y = (v: number) => `${(Math.min(v, max) / max) * 100}%`;
  return (
    <div className="tele-plot">
      <Legend items={[{ key: 'm', mark: <span className="tele-dot-key" aria-hidden="true" />, label: 'Median ticket' }, { key: 'r', mark: <Swatch slot={1} extra="is-soft" />, label: 'Middle half of tickets' }]} />
      <div className="tele-cols-wrap">
        <div className="tele-yaxis" aria-hidden="true">{[0, max / 2, max].map((v) => <span key={v} style={{ bottom: `${(v / max) * 100}%` }}>{usd(v).replace(/\.00$/, '')}</span>)}</div>
        <ol className="tele-cols" aria-label="Median cost of a finished ticket, by plan week">
          {weeks.map((w) => (
            <li key={w.from} className="tele-col" aria-label={w.median === null ? `${w.label}: no finished ticket` : `${w.label}: median ${usd(w.median)}, middle half ${usd(w.low!)} to ${usd(w.high!)}, ${w.tickets} tickets`}>
              {w.median !== null && (
                <>
                  <span className={`tele-range ${slotClass(1)} is-soft`} style={{ bottom: y(w.low!), height: `calc(${y(w.high!)} - ${y(w.low!)} + 4px)` }} aria-hidden="true" />
                  <span className="tele-median" style={{ bottom: y(w.median) }} aria-hidden="true" />
                  {(w.high ?? 0) > max && <span className="tele-capped" aria-hidden="true">▲</span>}
                </>
              )}
            </li>
          ))}
        </ol>
        <div className="tele-xlabels" aria-hidden="true">{weeks.map((w, i) => <span key={w.from}>{i % 2 === weeks.length % 2 || i === weeks.length - 1 ? weekTick(w.label) : ''}</span>)}</div>
      </div>
    </div>
  );
}

// ---------- 3. Where the spend goes, by stage ----------

export function StagesChart({ data }: { data: StagesData }) {
  if (!data.stages.length) return <Empty>Nothing recorded for your jobs this month or last.</Empty>;
  const max = Math.max(...data.stages.map((s) => Math.max(s.share, s.lastShare ?? 0))) || 1;
  const both = data.stages.some((s) => s.lastShare !== null);
  return (
    <div className="tele-plot">
      <Legend items={[{ key: 'a', mark: <Swatch slot={1} />, label: data.months[0] }, ...(both ? [{ key: 'b', mark: <Swatch slot={2} />, label: data.months[1] }] : [])]} />
      <ul className="tele-pairs">
        {data.stages.map((s) => (
          <li key={s.label} className="tele-pair-row" aria-label={`${s.label}: ${pct(s.share * 100)} in ${data.months[0]}, ${s.lastShare === null ? 'nothing' : pct(s.lastShare * 100)} in ${data.months[1]}`}>
            <span className="tele-bar-label">{s.label}</span>
            <span className="tele-pair-bars" aria-hidden="true">
              <span className="tele-bar-track"><span className={`tele-bar ${slotClass(1)}`} style={{ width: `${(s.share / max) * 100}%` }} /><span className="tele-bar-value">{pct(s.share * 100)}</span></span>
              {both && <span className="tele-bar-track"><span className={`tele-bar ${slotClass(2)}`} style={{ width: `${((s.lastShare ?? 0) / max) * 100}%` }} /><span className="tele-bar-value muted">{s.lastShare === null ? '—' : pct(s.lastShare * 100)}</span></span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- 4. Models ----------

export function ModelsChart({ data }: { data: ModelsData }) {
  if (!data.bars.length) return <Empty>Nothing recorded yet.</Empty>;
  const slot = new Map(data.series.map((s) => [s.key, s]));
  return (
    <div className="tele-plot">
      <Legend items={data.series.map((s) => ({ key: s.key, mark: <Swatch slot={s.slot} />, label: s.label }))} />
      <ul className="tele-shares">
        {data.bars.map((b) => (
          <li key={b.label} className="tele-share">
            <span className="tele-bar-label">{b.label}</span>
            <span className="tele-share-bar">
              {b.parts.map((p) => {
                const s = slot.get(p.key);
                return (
                  <span key={p.key} className={`tele-share-part ${slotClass(s?.slot ?? 8)}`} style={{ flexGrow: p.share }} role="img" aria-label={`${b.label}, ${s?.label ?? p.key}: ${pct(p.share * 100)} (${usd(p.usd)})`} title={`${s?.label ?? p.key}: ${pct(p.share * 100)} (${usd(p.usd)})`}>
                    {p.share >= 0.14 && <span className="tele-in" aria-hidden="true">{pct(p.share * 100)}</span>}
                  </span>
                );
              })}
            </span>
            <span className="tele-share-total num">{usd(b.usd)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- 5. People on the account ----------

export function PeopleChart({ data }: { data: PeopleData }) {
  if (data.others === null) {
    // No meter split: dollars in this app per person.
    const max = Math.max(0, ...data.people.map((p) => p.usd)) || 1;
    if (!data.people.length) return <Empty>Nobody used the account in this window, as far as this computer knows.</Empty>;
    return (
      <ul className="tele-hbars" aria-label="Spend in this app per person">
        {data.people.map((p, i) => (
          <li key={p.user} className="tele-hbar" aria-label={`${p.user}: ${usd(p.usd)}${p.percent === null ? '' : `, ${pct(p.percent)}`}`}>
            <span className="tele-bar-label">{p.user}</span>
            <span className="tele-bar-track"><span className={`tele-bar ${slotClass(i + 1)}`} style={{ width: `${(p.usd / max) * 100}%` }} aria-hidden="true" /><span className="tele-bar-value">{usd(p.usd)}{p.percent === null ? '' : ` · ${pct(p.percent)}`}</span></span>
          </li>
        ))}
      </ul>
    );
  }
  const parts = [
    ...data.people.map((p, i) => ({ key: p.user, label: p.user, slot: Math.min(7, i + 1), percent: p.percent ?? 0, words: `${p.user} · ${usd(p.usd)} · ${pct(p.percent ?? 0)}` })),
    { key: '~other', label: 'Others (estimated)', slot: OTHER_SLOT, percent: data.others.percent, words: `Others · ${pct(data.others.percent)}, estimated` },
  ];
  return <ShareBar parts={parts} unknown={data.unknown ?? 0} free={data.free ?? 0} label={`Share of ${data.window === '5h' ? 'the 5-hour limit' : 'this week’s limit'}`} />;
}

/** One bar of a limit's 100%: a segment per part (name, percent and pattern), Not known, and Still free. */
export function ShareBar({ parts, unknown, free, label, onPick }: { parts: { key: string; label: string; slot: number; percent: number; words: string }[]; unknown: number; free: number; label: string; onPick?: (key: string) => void }) {
  const segs = parts.filter((p) => p.percent > 0);
  return (
    <div className="tele-plot">
      <Legend items={[
        ...parts.map((p) => ({ key: p.key, mark: <Swatch slot={p.slot} />, label: <>{p.label} <b className="num">{pct(p.percent)}</b></> })),
        ...(unknown >= 1 ? [{ key: '~unknown', mark: <span className="tele-swatch tele-unknown" aria-hidden="true" />, label: <>Not known <b className="num">{pct(unknown)}</b></> }] : []),
        { key: '~free', mark: <span className="tele-swatch tele-free" aria-hidden="true" />, label: <>Still free <b className="num">{pct(free)}</b></> },
      ]} />
      <div className="tele-limit-bar" role="img" aria-label={`${label}: ${[...parts.map((p) => `${p.label} ${pct(p.percent)}`), ...(unknown >= 1 ? [`not known ${pct(unknown)}`] : []), `still free ${pct(free)}`].join(', ')}.`}>
        {segs.map((p) => (onPick
          ? <button key={p.key} type="button" className={`tele-limit-part ${slotClass(p.slot)}`} style={{ width: `${p.percent}%` }} onClick={() => onPick(p.key)} title={`${p.words}. Show more.`} aria-label={`${p.words}. Show more.`} />
          : <span key={p.key} className={`tele-limit-part ${slotClass(p.slot)}`} style={{ width: `${p.percent}%` }} title={p.words} aria-hidden="true" />))}
        {unknown >= 1 && <span className="tele-limit-part tele-unknown" style={{ width: `${unknown}%` }} aria-hidden="true" />}
      </div>
    </div>
  );
}

// ---------- 6. Rework ----------

export function ReworkChart({ data }: { data: ReworkData }) {
  const stages = data.stages ?? [];
  if (!stages.length) return <Empty>No send-backs in the last 30 days.</Empty>;
  const max = Math.max(...stages.map((s) => s.usd)) || 1;
  return (
    <ul className="tele-hbars" aria-label="Cost after a send-back, by stage">
      {stages.map((s) => (
        <li key={s.label} className="tele-hbar" aria-label={`${s.label}: ${usd(s.usd)} after ${s.sendBacks} send-backs`}>
          <span className="tele-bar-label">{s.label}</span>
          <span className="tele-bar-track"><span className={`tele-bar ${slotClass(1)}`} style={{ width: `${(s.usd / max) * 100}%` }} aria-hidden="true" /><span className="tele-bar-value">{usd(s.usd)} · {s.sendBacks} {s.sendBacks === 1 ? 'send-back' : 'send-backs'}</span></span>
        </li>
      ))}
    </ul>
  );
}

// ---------- 7. Waiting on you ----------

export function WaitingChart({ data }: { data: WaitingData }) {
  const weeks = data.weeks ?? [];
  if (!weeks.some((w) => w.answers)) return <Empty>No answers in the last six weeks.</Empty>;
  const max = niceMax(Math.max(...weeks.map((w) => w.day + w.night)));
  return (
    <div className="tele-plot">
      <Legend items={[{ key: 'd', mark: <Swatch slot={1} />, label: 'Daytime, 08:00 to 20:00' }, { key: 'n', mark: <Swatch slot={2} />, label: 'Overnight' }]} />
      <div className="tele-cols-wrap">
        <div className="tele-yaxis" aria-hidden="true">{[0, max / 2, max].map((v) => <span key={v} style={{ bottom: `${(v / max) * 100}%` }}>{Math.round(v)} h</span>)}</div>
        <ol className="tele-cols" aria-label="Hours your jobs waited on you, by plan week">
          {weeks.map((w) => (
            <li key={w.from} className="tele-col" aria-label={`${w.label}: ${Math.round(w.day)} hours daytime, ${Math.round(w.night)} overnight, ${w.answers} answers`}>
              {w.day + w.night > 0 && <span className="tele-col-cap" aria-hidden="true">{Math.round(w.day + w.night)} h</span>}
              <span className="tele-stack" style={{ height: `${((w.day + w.night) / max) * 100}%` }} aria-hidden="true">
                {w.day > 0 && <span className={`tele-part ${slotClass(1)}`} style={{ flexGrow: w.day }} />}
                {w.night > 0 && <span className={`tele-part ${slotClass(2)}`} style={{ flexGrow: w.night }} />}
              </span>
            </li>
          ))}
        </ol>
        <div className="tele-xlabels" aria-hidden="true">{weeks.map((w) => <span key={w.from}>{weekTick(w.label)}</span>)}</div>
      </div>
    </div>
  );
}

// ---------- 8. Time to PR #1 ----------

const SIZES: { key: 'small' | 'large' | 'unknown'; label: string }[] = [{ key: 'small', label: 'Small' }, { key: 'large', label: 'Large' }, { key: 'unknown', label: 'Size not known' }];

export function Pr1Chart({ data }: { data: Pr1Data }) {
  if (!data.items.length) return <Empty>No job has reached PR #1 yet.</Empty>;
  const max = niceMax(data.cap ?? Math.max(...data.items.map((i) => i.days)));
  const x = (d: number) => `${(Math.min(d, max) / max) * 100}%`;
  const rows = SIZES.filter((s) => data.items.some((i) => i.size === s.key));
  return (
    <div className="tele-plot">
      <Legend items={[{ key: 'd', mark: <span className="tele-dot-key is-soft" aria-hidden="true" />, label: 'One job' }, { key: 'm', mark: <span className="tele-median-key" aria-hidden="true" />, label: 'Median' }]} />
      <ul className="tele-strips">
        {rows.map((s) => (
          <li key={s.key} className="tele-strip-row" aria-label={`${s.label}: ${data.items.filter((i) => i.size === s.key).map((i) => `${i.days} days`).join(', ')}; median ${data.medians[s.key]} days`}>
            <span className="tele-bar-label">{s.label}</span>
            <span className="tele-strip" aria-hidden="true">
              {data.items.filter((i) => i.size === s.key).map((i, n) => <span key={n} className="tele-strip-dot" style={{ left: x(i.days) }} title={`${i.label}: ${i.days} days`} />)}
              {data.medians[s.key] !== null && <span className="tele-strip-median" style={{ left: x(data.medians[s.key]!) }} />}
            </span>
          </li>
        ))}
      </ul>
      <div className="tele-strip-axis" aria-hidden="true"><span>0 days</span><span>{max / 2} days</span><span>{max} days</span></div>
    </div>
  );
}

// ---------- 9. When the limit goes ----------

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_WORDS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const blockWords = (b: number) => `${String(b * 2).padStart(2, '0')}:00 to ${b === 11 ? 'midnight' : `${String(b * 2 + 2).padStart(2, '0')}:00`}`;

export function WhenChart({ data }: { data: WhenData }) {
  const [at, setAt] = useState<number | null>(null);
  if (!(data.max > 0)) return <Empty>Nothing recorded in the last four weeks.</Empty>;
  const v = (n: number) => (data.unit === 'percent' ? pct(n) : usd(n));
  const cellWords = (i: number) => {
    const c = data.cells[i];
    return `${DAY_WORDS[c.day]} ${blockWords(c.block)}: ${v(c.total)}${data.unit === 'percent' ? ` (this app ${v(c.app)}, other use ${v(c.other)}, estimated)` : ''}`;
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = at ?? 0;
    const next = e.key === 'ArrowRight' ? Math.min(83, i + 1) : e.key === 'ArrowLeft' ? Math.max(0, i - 1) : e.key === 'ArrowDown' ? Math.min(83, i + 12) : e.key === 'ArrowUp' ? Math.max(0, i - 12) : null;
    if (e.key === 'Escape') { setAt(null); return; }
    if (next === null) return;
    e.preventDefault();
    setAt(at === null ? 0 : next);
  };
  return (
    <div className="tele-plot">
      <div className="tele-heat" role="img" tabIndex={0} data-arrows="when" aria-label={`Weekday by two hours, the last four weeks. Arrow keys read each square.`} onKeyDown={onKey} onBlur={() => setAt(null)} onPointerLeave={() => setAt(null)}>
        <span aria-hidden="true" />
        {Array.from({ length: 12 }, (_, b) => <span key={b} className="tele-heat-hour" aria-hidden="true">{b % 3 === 0 ? String(b * 2).padStart(2, '0') : ''}</span>)}
        {DAYS.map((d, day) => (
          <div key={d} className="tele-heat-row" aria-hidden="true">
            <span className="tele-heat-day">{d}</span>
            {data.cells.filter((c) => c.day === day).map((c) => {
              const i = day * 12 + c.block;
              return <span key={c.block} className={`tele-heat-cell${at === i ? ' is-at' : ''}`} style={{ '--heat': `${Math.round((c.total / data.max) * 100)}%` } as CSSProperties} onPointerEnter={() => setAt(i)} title={cellWords(i)} />;
            })}
          </div>
        ))}
      </div>
      <div className="tele-heat-key" aria-hidden="true"><span>None</span><span className="tele-heat-ramp" /><span>{v(data.max)}: the busiest two hours, over four weeks</span></div>
      <p className="tele-heat-now" aria-live="polite">{at === null ? '' : cellWords(at)}</p>
    </div>
  );
}

// ---------- 10. Cache reuse ----------

export function CacheChart({ data }: { data: CacheData }) {
  const [ref, width] = useWidth();
  const pts = data.weeks.map((w, i) => ({ ...w, i })).filter((w) => w.share !== null);
  if (!pts.length) return <Empty>No input recorded for your jobs yet.</Empty>;
  const w = Math.max(width, 240);
  const H = 150;
  const m = { l: 40, r: 16, t: 16, b: 24 };
  const sx = (i: number) => m.l + (data.weeks.length > 1 ? i / (data.weeks.length - 1) : 0.5) * (w - m.l - m.r);
  const sy = (s: number) => m.t + (1 - s) * (H - m.t - m.b);
  return (
    <div className="tele-plot" ref={ref}>
      <svg className="tele-svg" width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`Share of input read from the cache by week: ${pts.map((p) => `${p.label} ${pct(p.share! * 100)}`).join(', ')}.`}>
        {[0, 0.5, 1].map((s) => <g key={s}><line className={s === 0 ? 'axis' : 'grid'} x1={m.l} x2={w - m.r} y1={sy(s)} y2={sy(s)} /><text className="tick" x={m.l - 6} y={sy(s) + 4} textAnchor="end">{pct(s * 100)}</text></g>)}
        {data.weeks.map((wk, i) => (i % 2 === data.weeks.length % 2 || i === data.weeks.length - 1) && <text key={wk.from} className="tick" x={sx(i)} y={H - 6} textAnchor="middle">{weekTick(wk.label)}</text>)}
        <path className="week" d={pts.map((p, n) => `${n ? 'L' : 'M'}${sx(p.i).toFixed(1)},${sy(p.share!).toFixed(1)}`).join('')} />
        {pts.map((p) => <circle key={p.from} className="dot week-dot" cx={sx(p.i)} cy={sy(p.share!)} r={4} />)}
        <text className="end-label" x={sx(pts.at(-1)!.i) - 6} y={sy(pts.at(-1)!.share!) - 10} textAnchor="end">{pct(pts.at(-1)!.share! * 100)}</text>
      </svg>
      {data.least.length > 0 && (
        <div className="tele-least">
          <p className="tele-sub-head">Reused least this week</p>
          <ul>{data.least.map((j) => <li key={j.label}><b>{j.label}</b> {pct(j.share * 100)} · {j.restarts === 0 ? 'one session' : `restarted ${j.restarts} ${j.restarts === 1 ? 'time' : 'times'}`}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
