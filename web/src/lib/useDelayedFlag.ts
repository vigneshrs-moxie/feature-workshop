// Don't flash loading (packet R, principle 5): a loading indicator shows only once the load has
// taken `delayMs` (so a quick load shows nothing at all), and once shown it stays at least `minMs`
// (so it never blinks). The screen shows its indicator while this is true, and its content after.
import { useEffect, useRef, useState } from 'react';

/** How long a load may take before anything says so, and how long that then stays up. */
export const LOADING_DELAY_MS = 200;
export const LOADING_MIN_MS = 400;

/**
 * True once `on` has been true for `delayMs`; it then stays true until `on` is false and it has
 * been shown at least `minMs`. False all along when `on` turns false within `delayMs`.
 */
export function useDelayedFlag(on: boolean, delayMs = LOADING_DELAY_MS, minMs = LOADING_MIN_MS): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (on && !shown) {
      const t = setTimeout(() => { shownAt.current = Date.now(); setShown(true); }, delayMs);
      return () => clearTimeout(t);
    }
    if (!on && shown) {
      const left = minMs - (Date.now() - shownAt.current);
      if (left <= 0) { setShown(false); return; }
      const t = setTimeout(() => setShown(false), left);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [on, shown, delayMs, minMs]);
  return shown;
}
