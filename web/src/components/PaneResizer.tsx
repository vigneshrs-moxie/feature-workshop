// The handle between the middle pane and the Preview pane: drag it to share the width between them.
// The Preview pane keeps at least PREVIEW_MIN and the middle pane at least MIDDLE_MIN; the width
// is remembered in this browser (localStorage 'workshop.previewWidth', px). With none remembered
// the Preview pane takes its usual 40%.
//
// Keys, with the handle focused (it is a focusable separator): ← / → move it by 16px (Shift: 64px),
// Home and End go to the narrowest and widest Preview pane, Enter puts back the usual width. A
// double-click puts it back too.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useStored } from '../lib/stored';

export const PREVIEW_WIDTH_KEY = 'workshop.previewWidth';
/** The narrowest Preview pane: its document list and a page still read well. */
export const PREVIEW_MIN = 320;
/** The narrowest middle pane: the conversation, its cards and the message box still fit. */
export const MIDDLE_MIN = 400;
const STEP = 16;

/** The remembered Preview width in px, or null for the usual 40%; and a setter (null forgets it). */
export function usePreviewWidth(): [number | null, (px: number | null) => void] {
  const [value, set] = useStored(PREVIEW_WIDTH_KEY);
  const n = value === null ? NaN : Number(value);
  return [Number.isFinite(n) && n > 0 ? n : null, useCallback((px: number | null) => set(px === null ? null : String(Math.round(px))), [set])];
}

/** The Preview width to use: px within [PREVIEW_MIN, what leaves the middle pane MIDDLE_MIN]. */
export function clampPreview(px: number, panesWidth: number, jobsWidth: number): number {
  const max = Math.max(PREVIEW_MIN, panesWidth - jobsWidth - MIDDLE_MIN);
  return Math.min(max, Math.max(PREVIEW_MIN, px));
}

interface Props {
  /** The .panes grid: the handle measures it and sets --preview-w on it while you drag. */
  panes: RefObject<HTMLDivElement | null>;
}

export function PaneResizer({ panes }: Props) {
  const [stored, setStored] = usePreviewWidth();
  // Where the Preview pane is now (measured), so the handle sits on its edge and reports its width.
  const [box, setBox] = useState({ width: 0, max: PREVIEW_MIN });
  const drag = useRef<{ width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const measure = useCallback(() => {
    const el = panes.current;
    const preview = el?.querySelector<HTMLElement>('.pane-preview');
    const jobs = el?.querySelector<HTMLElement>('.pane-jobs');
    if (!el || !preview) return null;
    // The room the grid keeps for the Jobs pane (app.css --jobs-reserve: its widest), else its width now.
    const reserve = parseFloat(getComputedStyle(el).getPropertyValue('--jobs-reserve'));
    const m = { panes: el.getBoundingClientRect(), preview: preview.getBoundingClientRect().width, jobs: Math.max(jobs?.getBoundingClientRect().width ?? 0, Number.isFinite(reserve) ? reserve : 0) };
    setBox({ width: m.preview, max: Math.max(PREVIEW_MIN, m.panes.width - m.jobs - MIDDLE_MIN) });
    return m;
  }, [panes]);

  useEffect(() => {
    const el = panes.current;
    if (!el) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { measure(); });
    ro.observe(el);
    const preview = el.querySelector('.pane-preview');
    if (preview) ro.observe(preview);
    return () => ro.disconnect();
  }, [panes, measure, stored]);

  /** Show a width at once (on the grid) while dragging; remember it when you let go. */
  const show = (px: number) => panes.current?.style.setProperty('--preview-w', `${Math.round(px)}px`);
  const widthAt = (clientX: number) => {
    const m = measure();
    if (!m) return null;
    return clampPreview(m.panes.right - clientX, m.panes.width, m.jobs);
  };

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { width: box.width };
    setDragging(true);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const w = widthAt(e.clientX);
    if (w === null) return;
    drag.current.width = w;
    show(w);
    setBox((b) => ({ ...b, width: w }));
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setStored(drag.current.width);
    drag.current = null;
    setDragging(false);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const m = measure();
    if (!m) return;
    const now = m.preview;
    const step = e.shiftKey ? STEP * 4 : STEP;
    let next: number | null | undefined;
    if (e.key === 'ArrowLeft') next = now + step; // the handle moves left: the Preview pane grows
    else if (e.key === 'ArrowRight') next = now - step;
    else if (e.key === 'Home') next = PREVIEW_MIN;
    else if (e.key === 'End') next = Number.POSITIVE_INFINITY;
    else if (e.key === 'Enter') next = null;
    else return;
    e.preventDefault();
    setStored(next === null ? null : clampPreview(next, m.panes.width, m.jobs));
  }

  // The class on <body> keeps the col-resize cursor and stops text being selected mid-drag.
  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add('is-resizing-panes');
    return () => document.body.classList.remove('is-resizing-panes');
  }, [dragging]);

  const width = Math.round(box.width);
  return (
    <div
      className={`pane-resizer${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the Preview pane"
      aria-valuemin={PREVIEW_MIN}
      aria-valuemax={Math.round(box.max)}
      aria-valuenow={width || undefined}
      tabIndex={0}
      style={width ? { right: `${width - 4}px` } : undefined}
      title="Drag to resize the Preview pane (double-click to put it back). With it focused: ← and → move it, Enter puts it back."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setStored(null)}
      onKeyDown={onKeyDown}
    />
  );
}
