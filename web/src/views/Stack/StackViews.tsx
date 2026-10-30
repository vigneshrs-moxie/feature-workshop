// A stack's parts, three ways (packet V):
//   <Board>     parts in columns by where they are: Needs you, Waiting on a part, Ready to start, At
//               work, Checks, Ready to merge, Merged. Every column is always there (an empty one says
//               so in a quiet line), so a part moving never moves the columns. Merged is folded to
//               one line per part; opening it grows only that column.
//   <DepMap>    what waits on what, left to right: a column per depth, an arrow from a part to each
//               part that waits on it. Hovering a part lights its arrows and dims the rest.
//   <Timeline>  one row per part from its start to its merge (or now), with now marked: what is
//               taking long.
// Each part is picked with a click (or j / k on the page) and its quick look opens beside the view.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { StackPart, StackView } from '../../api/types';
import { partHref } from '../../app/router';
import { Icon } from '../../components/Icon';
import { relativeTime } from '../../lib/time';
import { CrewMember } from '../../play/CrewMember';
import { BOARD_COLUMNS, LANE_LOOK, shortSpan } from './stackLook';

export type StackViewKind = 'board' | 'map' | 'timeline';

interface ViewProps {
  view: StackView;
  picked: number | null;
  onPick: (n: number) => void;
  now: Date;
  mode: 'full' | 'subtle' | 'off';
  pulse: boolean;
}

const laneOf = (p: StackPart) => p.lane ?? 'waiting';

/** A part's one problem, in a few words, when it has one. */
export function partProblem(p: StackPart, view: StackView): string | null {
  const k = p.problem?.kind;
  const files = p.problem?.files ?? [];
  const file = files[0]?.split('/').pop();
  if (p.state === 'failed') return `Tests failed ${p.failures || 3} times`;
  if (k === 'conflict') {
    const other = view.parts.find((x) => x !== p && x.state === 'integrated' && files.some((f) => x.owns.some((o) => f === o || f.startsWith(o.replace(/\*+$/, '')))));
    return other ? `Clash with part ${other.n} in ${file}` : `Clash in ${file ?? 'its files'}`;
  }
  if (k === 'outside') return `Changed ${file ?? 'files'} outside its own`;
  if (k === 'empty') return 'Nothing to merge yet';
  if (k === 'checks') return `Tests failed after merging (undone) · try ${p.failures} of 3`;
  return null;
}

/** Its stage in a word: "Plan", "Build", "Test", "Review". */
const STAGE_WORD: Record<string, string> = { plan: 'Plan', implement: 'Build', test: 'Test', review: 'Review' };

function pickKeys(n: number, onPick: (n: number) => void) {
  return {
    onClick: () => onPick(n),
    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(n); } },
  };
}

// ---------- Board ----------

export function Board({ view, picked, onPick, now, mode, pulse, mergedOpen, onMergedOpen }: ViewProps & { mergedOpen: boolean; onMergedOpen: (open: boolean) => void }) {
  return (
    <div className="stack-board" role="list" aria-label="The parts by where they are">
      {BOARD_COLUMNS.map((col) => {
        const parts = view.parts.filter((p) => col.lanes.includes(laneOf(p)));
        const folded = col.id === 'merged' && !mergedOpen;
        return (
          <section key={col.id} className={`board-col col-${col.id}${parts.length ? '' : ' is-empty'}`} role="listitem" aria-label={`${col.word}: ${parts.length}`}>
            <header className="board-col-head">
              <Icon name={col.icon} size={14} className={`board-col-icon tone-${LANE_LOOK[col.lanes[0]].tone}`} />
              <span className="board-col-word">{col.word}</span>
              <span className="board-col-count num">{parts.length}</span>
              {col.id === 'merged' && parts.length > 0 && (
                <button type="button" className="board-col-fold" aria-expanded={!folded} onClick={() => onMergedOpen(folded)} title={folded ? 'Show the merged parts as cards.' : 'Fold the merged parts to one line each.'}>
                  {folded ? 'Show' : 'Fold'} <Icon name="chevron-down" size={12} />
                </button>
              )}
            </header>
            {!parts.length ? <p className="board-col-empty">{col.empty}</p> : folded ? (
              <ol className="board-merged">
                {parts.map((p) => (
                  <li key={p.n}>
                    <button type="button" className={`board-merged-row${picked === p.n ? ' is-picked' : ''}`} {...pickKeys(p.n, onPick)} title={`Part ${p.n}: ${p.title ?? p.name}. Merged ${p.mergedAt ? relativeTime(p.mergedAt, now) : ''}.`}>
                      <span className="part-num num">{p.n}</span>
                      <span className="board-merged-name">{p.title ?? p.name}</span>
                      {p.mergedAt && <time className="num muted" dateTime={p.mergedAt}>{relativeTime(p.mergedAt, now)}</time>}
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <ol className="board-cards">
                {parts.map((p) => <PartCard key={p.n} p={p} view={view} picked={picked === p.n} onPick={onPick} now={now} mode={mode} pulse={pulse} />)}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PartCard({ p, view, picked, onPick, now, mode, pulse }: { p: StackPart; view: StackView; picked: boolean; onPick: (n: number) => void; now: Date; mode: ViewProps['mode']; pulse: boolean }) {
  const lane = laneOf(p);
  const look = LANE_LOOK[lane];
  const problem = partProblem(p, view);
  const live = lane === 'working' || lane === 'checks' || lane === 'merging';
  const stage = p.stage ? STAGE_WORD[p.stage] : null;
  return (
    <li className={`board-card lane-${lane}${picked ? ' is-picked' : ''}`}>
      <div className="board-card-hit" role="button" tabIndex={0} aria-pressed={picked} aria-label={`Part ${p.n}: ${p.title ?? p.name}. ${p.laneWords ?? look.word}.${problem ? ` ${problem}.` : ''}`} {...pickKeys(p.n, onPick)}>
        <div className="board-card-top">
          <span className="part-num num">{p.n}</span>
          <b className="board-card-title">{p.title ?? p.name}</b>
          {mode !== 'off' && live && <span className={`stack-light tone-${look.tone} is-on${mode === 'full' && pulse ? ' is-pulse' : ''}`} aria-hidden="true" />}
        </div>
        {p.now ? (
          <p className="board-card-now">
            {mode === 'full' && p.now.crew ? <span className="board-face" aria-hidden="true"><CrewMember type={p.now.crew} state={p.now.tone === 'waiting' ? 'waiting' : 'working'} size={18} label="" animated={false} /></span> : null}
            <span><b>{p.now.who}</b> · {p.now.what}</span>
          </p>
        ) : (
          <p className="board-card-now is-quiet">{lane === 'waiting' ? p.laneWords : lane === 'queued' ? (p.reason ?? 'Starts when a slot is free') : lane === 'merged' ? 'Merged' : ''}</p>
        )}
        {problem && <p className="board-card-problem"><Icon name="warn" size={13} /> {problem}</p>}
        <div className="board-card-foot">
          {(lane === 'stuck' || lane === 'merging') && <span className={`board-tag tone-${look.tone}`}><Icon name={look.icon} size={12} /> {look.word}</span>}
          {stage && lane !== 'merged' && lane !== 'waiting' && lane !== 'queued' && <span className={`board-stage stop-${p.stage}`}>{stage}</span>}
          <span className="spacer" />
          {p.now?.since && <time className="num muted" dateTime={p.now.since}>{relativeTime(p.now.since, now)}</time>}
        </div>
      </div>
    </li>
  );
}

// ---------- The map: what waits on what ----------

/** Each part's depth: 0 for one that waits on nothing, else one more than the deepest it waits on. */
export function depths(parts: readonly StackPart[]): Map<string, number> {
  const by = new Map(parts.map((p) => [p.name, p]));
  const out = new Map<string, number>();
  const visit = (p: StackPart, seen: Set<string>): number => {
    if (out.has(p.name)) return out.get(p.name)!;
    if (seen.has(p.name)) return 0;
    seen.add(p.name);
    const d = Math.max(-1, ...p.dependsOn.map((n) => by.get(n)).filter((x): x is StackPart => Boolean(x)).map((x) => visit(x, seen))) + 1;
    out.set(p.name, d);
    return d;
  };
  for (const p of parts) visit(p, new Set());
  return out;
}

interface Edge { from: number; to: number; d: string }

export function DepMap({ view, picked, onPick, mode }: ViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);
  const cols = useMemo(() => {
    const d = depths(view.parts);
    const n = Math.max(0, ...d.values()) + 1;
    return Array.from({ length: n }, (_, i) => view.parts.filter((p) => d.get(p.name) === i));
  }, [view.parts]);
  const links = useMemo(() => view.parts.flatMap((p) => p.dependsOn.map((dep) => ({ from: view.parts.find((x) => x.name === dep)?.n ?? 0, to: p.n })).filter((l) => l.from)), [view.parts]);

  // The arrows follow the nodes wherever the layout puts them.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const draw = () => {
      const r = el.getBoundingClientRect();
      const at = (n: number) => el.querySelector<HTMLElement>(`[data-node="${n}"]`)?.getBoundingClientRect() ?? null;
      setSize({ w: r.width, h: r.height });
      setEdges(links.map((l) => {
        const a = at(l.from);
        const b = at(l.to);
        if (!a || !b) return null;
        const x1 = a.right - r.left;
        const y1 = a.top + a.height / 2 - r.top;
        const x2 = b.left - r.left - 6;
        const y2 = b.top + b.height / 2 - r.top;
        const c = Math.max(24, (x2 - x1) / 2);
        return { ...l, d: `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}` };
      }).filter((e): e is Edge => Boolean(e)));
    };
    draw();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(draw) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [links, cols]);

  const lit = hover ?? picked;
  const touches = (e: Edge) => lit !== null && (e.from === lit || e.to === lit);
  return (
    <div className={`dep-map${lit !== null ? ' has-lit' : ''}`} ref={box} aria-label="What each part waits on, left to right">
      <svg className="dep-edges" width={size.w} height={size.h} aria-hidden="true">
        <defs>
          <marker id="dep-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" className="dep-arrow" /></marker>
          <marker id="dep-arrow-lit" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" className="dep-arrow is-lit" /></marker>
        </defs>
        {edges.map((e) => <path key={`${e.from}-${e.to}`} d={e.d} className={`dep-edge${touches(e) ? ' is-lit' : ''}`} markerEnd={`url(#${touches(e) ? 'dep-arrow-lit' : 'dep-arrow'})`} />)}
      </svg>
      {cols.map((col, i) => (
        <ol key={i} className="dep-col" aria-label={i === 0 ? 'Parts that wait on nothing' : `Parts ${i} step${i === 1 ? '' : 's'} along`}>
          {col.map((p) => {
            const lane = laneOf(p);
            const look = LANE_LOOK[lane];
            const on = lit !== null && (lit === p.n || links.some((l) => (l.from === lit && l.to === p.n) || (l.to === lit && l.from === p.n)));
            return (
              <li key={p.n}>
                <button
                  type="button" data-node={p.n}
                  className={`dep-node lane-${lane} tone-${look.tone}${picked === p.n ? ' is-picked' : ''}${on ? ' is-lit' : ''}`}
                  onClick={() => onPick(p.n)} onPointerEnter={() => setHover(p.n)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(p.n)} onBlur={() => setHover(null)}
                  aria-label={`Part ${p.n}: ${p.title ?? p.name}. ${p.laneWords ?? look.word}. ${p.dependsOnN?.length ? `Waits on ${p.dependsOnN.map((x) => `part ${x}`).join(', ')}.` : 'Waits on nothing.'}`}
                >
                  <span className="part-num num">{p.n}</span>
                  <span className="dep-node-body">
                    <span className="dep-node-title">{p.title ?? p.name}</span>
                    <span className="dep-node-lane"><Icon name={look.icon} size={12} /> {p.laneWords ?? look.word}</span>
                  </span>
                  {mode !== 'off' && (lane === 'working' || lane === 'checks') && <span className={`stack-light tone-${look.tone} is-on`} aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ol>
      ))}
    </div>
  );
}

// ---------- The timeline ----------

const ms = (iso: string | null | undefined) => { const t = Date.parse(iso ?? ''); return Number.isNaN(t) ? null : t; };

export function Timeline({ view, picked, onPick, now }: ViewProps) {
  const t1 = now.getTime();
  const starts = view.parts.map((p) => ms(p.startedAt)).filter((t): t is number => t !== null);
  const t0 = Math.min(ms(view.planApprovedAt) ?? Infinity, ...starts, t1 - 3600e3);
  const span = Math.max(3600e3, t1 - t0);
  const end = t1 + span * 0.04;
  const pct = (t: number) => `${(((t - t0) / (end - t0)) * 100).toFixed(3)}%`;
  const width = (a: number, b: number) => `${(((b - a) / (end - t0)) * 100).toFixed(3)}%`;
  // Ticks: whole days for long stacks, hours for short ones.
  const day = 86400e3;
  const step = span > 2 * day ? day : span > 12 * 3600e3 ? 6 * 3600e3 : 3600e3;
  const ticks: number[] = [];
  const first = new Date(t0);
  if (step === day) first.setHours(0, 0, 0, 0); else first.setMinutes(0, 0, 0);
  for (let t = first.getTime() + step; t < end; t += step) ticks.push(t);
  const tickWord = (t: number) => (step === day ? new Date(t).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }) : new Date(t).toLocaleTimeString([], { hour: 'numeric' }));
  return (
    <div className="stack-timeline" aria-label="Each part from its start to its merge">
      <div className="tl-axis" aria-hidden="true">
        <span />
        <div className="tl-track">
          {ticks.map((t) => <span key={t} className="tl-tick" style={{ left: pct(t) }}>{tickWord(t)}</span>)}
          <span className="tl-now-label" style={{ left: pct(t1) }}>now</span>
        </div>
      </div>
      <ol className="tl-rows">
        {view.parts.map((p) => {
          const lane = laneOf(p);
          const look = LANE_LOOK[lane];
          const a = ms(p.startedAt);
          const merged = ms(p.mergedAt);
          const ready = ms(p.readyAt);
          const stop = merged ?? t1;
          const took = a !== null ? shortSpan(stop - a) : null;
          return (
            <li key={p.n} className={`tl-row${picked === p.n ? ' is-picked' : ''}`}>
              <button type="button" className="tl-label" onClick={() => onPick(p.n)} aria-label={`Part ${p.n}: ${p.title ?? p.name}. ${p.laneWords ?? look.word}.${took ? ` ${merged ? 'Took' : 'Running for'} ${took}.` : ' Not started.'}`}>
                <span className="part-num num">{p.n}</span>
                <span className="tl-name">{p.title ?? p.name}</span>
              </button>
              <div className="tl-track" onClick={() => onPick(p.n)}>
                {ticks.map((t) => <span key={t} className="tl-grid" style={{ left: pct(t) }} />)}
                <span className="tl-now" style={{ left: pct(t1) }} />
                {a !== null ? (
                  <>
                    <span className={`tl-bar tone-${look.tone} pat-${look.pattern}`} style={{ left: pct(a), width: width(a, ready && ready < stop ? ready : stop) }} />
                    {ready && ready < stop && <span className={`tl-bar is-waiting tone-ok`} style={{ left: pct(ready), width: width(ready, stop) }} title="Ready, waiting for its turn to merge" />}
                    <span className="tl-took num" style={{ left: `calc(${pct(stop)} + 6px)` }}>{took}{lane === 'merged' ? '' : ` · ${(p.laneWords ?? look.word).toLowerCase()}`}</span>
                  </>
                ) : <span className="tl-not muted" style={{ left: `calc(${pct(t1)} + 6px)` }}>not started · {(p.laneWords ?? '').toLowerCase()}</span>}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="tl-key muted">
        <span><i className="tl-swatch tone-info pat-solid" /> building</span>
        <span><i className="tl-swatch tone-ok is-waiting" /> ready, waiting for its turn</span>
        <span><i className="tl-swatch tone-ok pat-solid" /> merged</span>
        <span><i className="tl-swatch is-now" /> now</span>
      </p>
    </div>
  );
}

/** The part's page, for a link. */
export const partLink = (view: StackView, n: number) => partHref(view.slug, n);
