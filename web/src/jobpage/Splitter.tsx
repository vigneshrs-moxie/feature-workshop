// A drag handle between two of the job page's columns on a laptop (16 Nov: "all the panels are fixed
// size, can't be adjusted"). Dragging it sets one width, a custom property on the page (`--jp2-…-w`),
// which the grid reads (jobpage.css); the width is kept in this browser and comes back next time.
// The arrow keys move it by 24 px (Shift: 96 px); a double click, or Home, gives back the default.
// The CSP allows this: a custom property set on an element's style from script (as JobHeader does).

import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

export interface SplitterProps {
  /** The page element whose custom property is set. */
  page: RefObject<HTMLElement | null>;
  /** The custom property: `--jp2-decide-w` or `--jp2-convo-w`. */
  prop: string;
  /** The column whose width this sets: measured when a drag starts. */
  measure(): HTMLElement | null;
  /** The column is left of the handle (dragging right widens it) or right of it (dragging left widens it). */
  side: 'left' | 'right';
  min: number;
  max: number;
  /** What the handle resizes, for a screen reader: `the decision`, `the conversation`. */
  label: string;
  className?: string;
}

const keyOf = (prop: string) => `sb.jobPage.${prop.replace(/^--jp2-/, '')}`;

function readWidth(prop: string): number | null {
  try {
    const v = Number(localStorage.getItem(keyOf(prop)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}

function keepWidth(prop: string, px: number | null) {
  try {
    if (px === null) localStorage.removeItem(keyOf(prop));
    else localStorage.setItem(keyOf(prop), String(Math.round(px)));
  } catch { /* storage off: the width lasts for this visit */ }
}

export function Splitter({ page, prop, measure, side, min, max, label, className = '' }: SplitterProps) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.max(min, Math.min(max, w));
  const set = (w: number | null) => {
    const el = page.current;
    if (!el) return;
    if (w === null) el.style.removeProperty(prop);
    else el.style.setProperty(prop, `${Math.round(w)}px`);
  };

  // The width kept from an earlier visit, before the first paint shows the default.
  useEffect(() => {
    const kept = readWidth(prop);
    if (kept !== null) set(clamp(kept));
  }, [prop]);

  const now = () => measure()?.getBoundingClientRect().width ?? min;

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, w: now() };
    page.current?.setAttribute('data-dragging', '');
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    set(clamp(side === 'left' ? d.w + dx : d.w - dx));
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    page.current?.removeAttribute('data-dragging');
    keepWidth(prop, now());
  }
  function reset() {
    set(null);
    keepWidth(prop, null);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 96 : 24;
    const grow = side === 'left' ? 1 : -1;
    let w: number | null = null;
    if (e.key === 'ArrowLeft') w = clamp(now() - step * grow);
    else if (e.key === 'ArrowRight') w = clamp(now() + step * grow);
    else if (e.key === 'Home') { e.preventDefault(); reset(); return; }
    if (w === null) return;
    e.preventDefault();
    e.stopPropagation();
    set(w);
    keepWidth(prop, w);
  }

  return (
    <div
      className={`jp2-split ${className}`.trim()}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`Drag to resize ${label}. Double-click to put it back.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
    />
  );
}
