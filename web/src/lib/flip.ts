// A short slide that shows where something went (packet R, principles 4 and 13). Each element
// marked data-flip-key inside `box` that moved since the last arrangement slides from where it was
// to where it is (transform only), and one that just arrived fades in (opacity only): 200 ms,
// ease-out. Nothing moves with reduced motion, and any key or click finishes it at once.
import { useLayoutEffect, useRef, type RefObject } from 'react';

export const FLIP_MS = 200;
const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)';

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function rectsIn(box: HTMLElement): Map<string, DOMRect> {
  const out = new Map<string, DOMRect>();
  for (const el of box.querySelectorAll<HTMLElement>('[data-flip-key]')) out.set(el.dataset.flipKey!, el.getBoundingClientRect());
  return out;
}

/**
 * Slides `box`'s marked elements whenever `arrangement` (a string naming who is where) changes.
 * Where they were is read just before React changes the page, so scrolling in between doesn't count.
 */
export function useFlip(box: RefObject<HTMLElement | null>, arrangement: string) {
  const shown = useRef(arrangement);
  const before = useRef<Map<string, DOMRect> | null>(null);
  // Read during render, while the page still shows the old arrangement.
  if (arrangement !== shown.current && box.current && !before.current) before.current = rectsIn(box.current);
  useLayoutEffect(() => {
    if (arrangement === shown.current) return;
    shown.current = arrangement;
    const was = before.current;
    before.current = null;
    const el = box.current;
    if (!was || !el || reducedMotion()) return;
    const running: Animation[] = [];
    for (const card of el.querySelectorAll<HTMLElement>('[data-flip-key]')) {
      if (typeof card.animate !== 'function') continue;
      const old = was.get(card.dataset.flipKey!);
      const now = card.getBoundingClientRect();
      if (!old) {
        running.push(card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FLIP_MS, easing: EASE_OUT }));
        continue;
      }
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      running.push(card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: FLIP_MS, easing: EASE_OUT }));
    }
    if (!running.length) return;
    const finish = () => { for (const a of running) a.finish(); };
    window.addEventListener('keydown', finish, { once: true, capture: true });
    window.addEventListener('pointerdown', finish, { once: true, capture: true });
    const t = setTimeout(() => {
      window.removeEventListener('keydown', finish, { capture: true });
      window.removeEventListener('pointerdown', finish, { capture: true });
    }, FLIP_MS + 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', finish, { capture: true });
      window.removeEventListener('pointerdown', finish, { capture: true });
    };
  }, [arrangement, box]);
}
