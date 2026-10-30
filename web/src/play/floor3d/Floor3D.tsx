// <Floor3D benches onOpenJob fallback />: the workshop floor in 3D (packet S), for Play full. Each
// job is a bench; the Foreman and its crew stand at it in the pose of what each agent is really
// doing, and every figure's words are always on the page, under its bench (status is never shown
// by a pose or a colour alone).
//
//   benches    the floor's benches (model.ts floorBenches / the floor lab's fixtures), in grid order
//   onOpenJob  what clicking a bench or a figure does (default: open the job's page). On Jobs it
//              opens R's quick look (home/JobPeek.tsx), with Go / No go when the job waits.
//   fallback   what to show when the browser can't draw 3D (the 2D floor); the plain list otherwise
//   keys       answer the floor's keys (keyRegistry.ts, scope floor): j / k and the arrows pick a
//              bench, Enter opens it with onOpenJob, o opens its job's page, Esc puts it down
//   current    the bench being looked at (the quick look's job), shown as picked
//
// The 3D itself (three.js) loads only when this first mounts, from loadScene(). Until it has, the
// words are already where they'll stay: the layout is worked out without three.js (layout.ts), so
// nothing moves when the 3D arrives. "Show as a list" swaps the 3D for the plain list (remembered
// per browser); the list is also what screen readers get, as the plates under the benches.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { jobHref, navigate } from '../../app/router';
import { jobHueStyle } from '../../theme/hue';
import { Icon } from '../../components/Icon';
import { STOPS } from '../../components/stops/stops';
import type { StopHue } from './palette';
import { usePrefersReducedMotion } from '../usePlay';
import { useKeyScope } from '../../app/keyRegistry';
import { Button } from '../../components/Button';
import { FloorList, FigureLine, StopWord } from './FloorList';
import { floorLayout, type FloorLayout } from './layout';
import { loadScene } from './loadScene';
import { readPalette, watchTheme } from './palette';
import { sceneBenches, type FloorAnchors, type FloorBench, type FloorScene, type FrameStats } from './types';
import { hasWebGL } from './webgl';
import './floor3d.css';

export const FLOOR_VIEW_KEY = 'fw.floor.view';
type View = 'floor' | 'list';

function readView(): View {
  try { return localStorage.getItem(FLOOR_VIEW_KEY) === 'list' ? 'list' : 'floor'; } catch { return 'floor'; }
}
function saveView(v: View) {
  try { localStorage.setItem(FLOOR_VIEW_KEY, v); } catch { /* private window: not remembered */ }
}

export interface Floor3DProps {
  benches: readonly FloorBench[];
  onOpenJob?: (slug: string) => void;
  fallback?: ReactNode;
  /** The floor lab's frame-time check: keep every figure moving, and report the timings each second. */
  busy?: boolean;
  onStats?: (s: FrameStats) => void;
  /** The floor's accessible name. */
  label?: string;
  /** The line above the floor (null: none, when the page already says it). */
  hint?: string | null;
  keys?: boolean;
  current?: string | null;
  /** Where things go (default: the floor's grid; the Stage strip passes its own band). Keep it stable. */
  layoutFor?: (width: number, count: number) => FloorLayout;
  /** The bar above the floor (its line, Fit all, Show as a list); the Stage strip has none. */
  bar?: boolean;
}

const openJob = (slug: string) => navigate({ name: 'job', slug });

export function Floor3D({ benches, onOpenJob = openJob, fallback, busy = false, onStats, label = 'The workshop floor', hint, keys = false, current = null, layoutFor = floorLayout, bar = true }: Floor3DProps) {
  const [view, setViewState] = useState<View>(readView);
  const [webgl] = useState(hasWebGL);
  const [failed, setFailed] = useState(false);
  const setView = (v: View) => { setViewState(v); saveView(v); };

  if (!webgl || failed) {
    return (
      <section className="floor3d is-flat" aria-label={label}>
        <p className="floor3d-note muted">This browser can’t draw the 3D floor, so the jobs show {fallback ? 'as cards' : 'as a list'}, with the same words.</p>
        {fallback ?? <FloorList benches={benches} onOpenJob={onOpenJob} />}
      </section>
    );
  }
  return (
    <section className="floor3d" aria-label={label}>
      {view === 'list' && bar ? (
        <>
          <FloorBar view={view} onView={setView} hint={hint} />
          <FloorList benches={benches} onOpenJob={onOpenJob} />
        </>
      ) : (
        <FloorStage benches={benches} onOpenJob={onOpenJob} busy={busy} onStats={onStats} onFail={() => setFailed(true)} onView={setView} hint={hint} keys={keys} current={current} layoutFor={layoutFor} bar={bar} />
      )}
    </section>
  );
}

function FloorBar({ view, onView, onFit, hint }: { view: View; onView: (v: View) => void; onFit?: () => void; hint?: string | null }) {
  const words = hint === undefined ? (view === 'floor' ? 'Each bench is a job. Pick a bench or a builder to open the job.' : 'The floor as a list: one row per bench.') : hint;
  return (
    <div className="floor3d-bar">
      {words && <p className="floor3d-hint muted">{words}</p>}
      <div className="floor3d-actions">
        {/* Fit all keeps its place while hidden, so the bar never moves. */}
        <Button kind="quiet" size="sm" className={`floor3d-btn${onFit ? '' : ' is-idle'}`} aria-hidden={onFit ? undefined : true} tabIndex={onFit ? undefined : -1} onClick={onFit} title="Show the whole floor again (after zooming with a pinch, or ⌘ and scroll).">Fit all</Button>
        <Button kind="quiet" size="sm" className="floor3d-btn" aria-pressed={view === 'list'} onClick={() => onView(view === 'floor' ? 'list' : 'floor')} title={view === 'floor' ? 'Show the benches as a plain list of words instead of the 3D floor.' : 'Show the 3D floor again.'}>
          {view === 'floor' ? 'Show as a list' : 'Show the floor'}
        </Button>
      </div>
    </div>
  );
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.clientWidth));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

interface StageProps {
  benches: readonly FloorBench[];
  onOpenJob: (slug: string) => void;
  busy: boolean;
  onStats?: (s: FrameStats) => void;
  onFail: () => void;
  onView: (v: View) => void;
  hint?: string | null;
  keys: boolean;
  current: string | null;
  layoutFor: (width: number, count: number) => FloorLayout;
  bar: boolean;
}

function FloorStage({ benches, onOpenJob, busy, onStats, onFail, onView, hint, keys, current, layoutFor, bar }: StageProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const iconBox = useRef<HTMLSpanElement>(null);
  const sceneRef = useRef<FloorScene | null>(null);
  const plates = useRef(new Map<string, HTMLElement>());
  const hits = useRef(new Map<string, HTMLElement>());
  const cells = useRef(new Map<string, HTMLElement>());
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<{ slug: string; key: string | null } | null>(null);
  const reduced = usePrefersReducedMotion();
  const width = useWidth(box);
  const count = benches.reduce((n, b) => Math.max(n, b.index + 1), 0);
  const layout = useMemo<FloorLayout | null>(() => (width > 0 ? layoutFor(width, Math.max(1, count)) : null), [width, count, layoutFor]);

  // Where the words and pointer targets go after each frame (zoom and parallax move them).
  const place = useCallback((a: FloorAnchors) => {
    for (const b of a.benches) {
      const el = plates.current.get(b.slug);
      if (el) el.style.transform = `translate(${b.plate.left}px, ${b.plate.top}px)`;
      const cell = cells.current.get(b.slug);
      if (cell) { cell.style.transform = `translate(${b.cell.left}px, ${b.cell.top}px)`; cell.style.width = `${b.cell.width}px`; cell.style.height = `${b.cell.height}px`; }
    }
    for (const f of a.figures) {
      const el = hits.current.get(f.key);
      if (!el) continue;
      el.style.transform = `translate(${f.rect.left}px, ${f.rect.top}px)`;
      el.style.width = `${f.rect.width}px`;
      el.style.height = `${f.rect.height}px`;
      el.hidden = false;
    }
  }, []);

  // The scene: loaded once, disposed when the floor goes.
  useEffect(() => {
    let cancelled = false;
    let made: FloorScene | null = null;
    const el = canvas.current;
    if (!el) return;
    loadScene()
      .then((mod) => {
        if (cancelled) return;
        made = mod.createFloorScene(el, { palette: readPalette(), reducedMotion: reduced, icons: stopIcons(iconBox.current) });
        sceneRef.current = made;
        made.onFrame(place);
        setReady(true);
      })
      .catch(() => { if (!cancelled) onFail(); });
    return () => {
      cancelled = true;
      made?.dispose();
      sceneRef.current = null;
    };
    // Made once per mount; the effects below keep it in step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ready && layout) sceneRef.current?.setLayout(layout, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  }, [ready, layout]);
  useEffect(() => { if (ready && layout) sceneRef.current?.setBenches(sceneBenches(benches)); }, [ready, layout, benches]);
  useEffect(() => { if (ready) sceneRef.current?.setReducedMotion(reduced); }, [ready, reduced]);
  useEffect(() => { if (ready) sceneRef.current?.setBusy(busy); }, [ready, busy]);
  useEffect(() => { if (ready) sceneRef.current?.setHover(hover?.key ?? null); }, [ready, hover]);
  // The theme: read again whenever it may have changed.
  useEffect(() => {
    if (!ready) return;
    return watchTheme(() => requestAnimationFrame(() => sceneRef.current?.setPalette(readPalette())));
  }, [ready]);
  // Nothing is drawn while the tab is hidden or the floor is scrolled out of view.
  useEffect(() => {
    if (!ready) return;
    let visible = true;
    const apply = () => sceneRef.current?.setActive(visible && document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', apply);
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined' && box.current) {
      io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; apply(); }, { rootMargin: '120px' });
      io.observe(box.current);
    }
    return () => { document.removeEventListener('visibilitychange', apply); io?.disconnect(); };
  }, [ready]);
  useEffect(() => {
    if (!ready || !onStats) return;
    const id = setInterval(() => { const s = sceneRef.current?.stats(); if (s) onStats(s); }, 1000);
    return () => clearInterval(id);
  }, [ready, onStats]);

  // Zoom: a pinch (which the browser sends as ⌘/Ctrl and scroll) or ⌘/Ctrl and scroll; a plain
  // scroll still scrolls the page.
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || !ready) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      sceneRef.current?.zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      setZoomed(Boolean(sceneRef.current?.zoomed()));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ready]);
  const fit = () => { sceneRef.current?.fitAll(); setZoomed(false); };

  // The picked bench (keys, or the quick look's job): a ring round its cell and its words.
  const [picked, setPicked] = useState<string | null>(current);
  useEffect(() => { if (current) setPicked(current); }, [current]);
  const ordered = useMemo(() => [...benches].sort((a, b) => a.index - b.index), [benches]);
  const pick = useCallback((slug: string | null) => {
    setPicked(slug);
    if (slug) cells.current.get(slug)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, []);
  const step = (by: number) => {
    if (!ordered.length) return;
    const at = ordered.findIndex((b) => b.slug === picked);
    const next = at < 0 ? (by > 0 ? 0 : ordered.length - 1) : (at + by + ordered.length) % ordered.length;
    pick(ordered[next].slug);
  };
  // Up and down move a whole row: as many benches as the grid has columns.
  const cols = layout?.cols ?? 1;
  useKeyScope('floor', {
    'floor-next': () => step(1),
    'floor-prev': () => step(-1),
    'floor-peek': () => { if (!picked) return false; onOpenJob(picked); },
    'floor-open': () => { if (!picked) return false; navigate({ name: 'job', slug: picked }); },
    'floor-leave': () => { if (!picked) return false; setPicked(null); },
  }, keys);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!keys || e.target !== e.currentTarget) return;
    const by = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : 0;
    if (!by) return;
    e.preventDefault();
    step(by);
  };

  const onMove = (e: React.PointerEvent) => {
    const el = box.current;
    if (!el || reduced || e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    sceneRef.current?.setPointer(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1);
  };
  const onLeave = () => { sceneRef.current?.setPointer(0, 0); setHover(null); };

  const refFor = (map: React.RefObject<Map<string, HTMLElement>>, key: string) => (el: HTMLElement | null) => {
    if (el) map.current.set(key, el); else map.current.delete(key);
  };

  return (
    <>
      {bar && <FloorBar view="floor" onView={onView} onFit={zoomed ? fit : undefined} hint={hint} />}
      <div
        ref={box}
        className={`floor3d-stage${ready ? ' is-ready' : ''}`}
        style={{ height: layout?.height ?? 0 }}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        data-benches={benches.length}
        {...(keys ? {
          tabIndex: 0,
          role: 'group',
          'aria-label': 'The floor. The arrows, or j and k, pick a bench; Enter takes a quick look; o opens its job.',
          onKeyDown,
        } : {})}
      >
        {/* The stops' icons, the app's own, read once for the benches' front tags. */}
        <span ref={iconBox} hidden aria-hidden="true">
          {STOPS.map((s) => <span key={s.id} data-stop={s.id}><Icon name={s.icon} /></span>)}
        </span>
        <canvas ref={canvas} className="floor3d-canvas" aria-hidden="true" style={layout ? { width: layout.width, height: layout.height } : undefined} />
        {/* What the pointer can pick: each bench's cell, and each figure over it. Mouse only: the words below say the same. */}
        <div className="floor3d-hits" aria-hidden="true">
          {layout && benches.map((b) => {
            const spot = layout.benches[b.index];
            return (
              <div
                key={b.slug}
                ref={refFor(cells, b.slug)}
                className={`floor3d-cell${picked === b.slug ? ' is-picked' : ''}`}
                style={spot ? { transform: `translate(${spot.cell.left}px, ${spot.cell.top}px)`, width: spot.cell.width, height: spot.cell.height } : undefined}
                onPointerEnter={() => setHover({ slug: b.slug, key: null })}
                onClick={() => { setPicked(b.slug); onOpenJob(b.slug); }}
              />
            );
          })}
          {/* Each figure's now line in the app's tooltip (R's TooltipLayer draws every data-tip). */}
          {ready && benches.flatMap((b) => b.figures.map((f) => (
            <div
              key={f.key}
              ref={refFor(hits, f.key)}
              className="floor3d-hit"
              hidden
              data-tip={f.label}
              onPointerEnter={() => setHover({ slug: b.slug, key: f.key })}
              onPointerLeave={() => setHover({ slug: b.slug, key: null })}
              onClick={() => { setPicked(b.slug); onOpenJob(b.slug); }}
            />
          )))}
        </div>
        <ol className="floor3d-plates">
          {layout && benches.map((b) => {
            const spot = layout.benches[b.index];
            if (!spot) return null;
            return (
              <li
                key={b.slug}
                ref={refFor(plates, b.slug)}
                className={`floor3d-plate${hover?.slug === b.slug ? ' is-hover' : ''}${picked === b.slug ? ' is-picked' : ''}`}
                data-group={b.lamp}
                style={{ transform: `translate(${spot.plate.left}px, ${spot.plate.top}px)`, width: spot.plate.width }}
              >
                <Plate bench={b} onOpenJob={onOpenJob} hoverKey={hover?.slug === b.slug ? hover.key : null} />
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}

/** Each stop's icon markup, from the hidden icons the floor renders. */
function stopIcons(box: HTMLElement | null): Partial<Record<StopHue, string>> {
  const out: Partial<Record<StopHue, string>> = {};
  box?.querySelectorAll<HTMLElement>('[data-stop]').forEach((el) => {
    const svg = el.querySelector('svg');
    if (svg) out[el.dataset.stop as StopHue] = svg.innerHTML;
  });
  return out;
}

function Plate({ bench, onOpenJob, hoverKey }: { bench: FloorBench; onOpenJob: (slug: string) => void; hoverKey: string | null }) {
  const lines = bench.figures.slice(0, 4);
  return (
    <>
      <div className="floor3d-plate-head">
        <span className="hue-dot" style={jobHueStyle(bench.slug)} aria-hidden="true" />
        <a
          className="floor3d-plate-title"
          href={jobHref(bench.slug)}
          title={`Open ${bench.title}.`}
          onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onOpenJob(bench.slug); }}
        >
          {bench.title}
        </a>
        {bench.stop && <StopWord bench={bench} />}
        <span className="floor3d-status" data-group={bench.lamp}>
          <span className="floor3d-glyph" aria-hidden="true">{bench.glyph}</span>
          {bench.status}
        </span>
      </div>
      <ul className="floor3d-lines">
        {lines.map((f) => <FigureLine key={f.key} figure={f} hover={hoverKey === f.key} />)}
        {bench.more > 0 && <li className="floor3d-line floor3d-more">and {bench.more} more {bench.more === 1 ? 'helper' : 'helpers'} at work</li>}
      </ul>
    </>
  );
}
