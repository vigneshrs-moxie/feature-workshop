// "Saved", quietly, beside a setting that just changed (packet R; Primer's saving pattern): changes
// apply at once, so there is no Save button and no toast. The note appears next to the control,
// holds for about 1.5 s and fades out (opacity only; with less motion it simply goes). It is a
// role="status", so a screen reader hears "Saved" too. It takes no room of its own (it is drawn
// over the space after the control), so nothing moves when it comes or goes.
//
//   const saved = useSaved();                 // in the component whose settings save
//   saved.mark('theme');                      // once the change is kept (after the dashboard answered)
//   <Saved tick={saved.tick('theme')} />      // where it shows: after the control, never inside its label
//
// One section shows one note at a time: the newest change's.
import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';

/** How long the note holds before it fades. */
export const SAVED_MS = 1500;
/** The fade (controls.css .saved-word); none with less motion. */
const FADE_MS = 400;

/** Which setting changed last, and a counter so the same one saved twice shows again. */
export function useSaved(): { mark(key?: string): void; tick(key?: string): number } {
  const [last, setLast] = useState<{ key: string; n: number } | null>(null);
  const mark = useCallback((key = 'all') => setLast((l) => ({ key, n: (l?.n ?? 0) + 1 })), []);
  const tick = useCallback((key = 'all') => (last && last.key === key ? last.n : 0), [last]);
  return { mark, tick };
}

function lessMotion(): boolean {
  try { return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; }
}

/** The note itself: empty until `tick` changes, then "Saved" for about 1.5 s. */
export function Saved({ tick, className = '' }: { tick: number; className?: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!tick) { setShown(0); return; }
    setShown(tick);
    const t = setTimeout(() => setShown(0), lessMotion() ? SAVED_MS : SAVED_MS + FADE_MS);
    return () => clearTimeout(t);
  }, [tick]);
  return (
    <span className={`saved ${className}`.trim()} role="status">
      {shown ? <span key={shown} className="saved-word"><Icon name="check" size={12} />Saved</span> : null}
    </span>
  );
}
