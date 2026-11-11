// What a button that sends something shows after the click (spec 1.2), shared by every place that
// names the same key, so a bar and the card under it (or a page drawn again after the send) agree:
//   idle      nothing is out
//   sending   from the click until the request answers: the button spins and can't be pressed again
//   sent      the server took it, until clear() (the thing it sent moved on)
//   stuck     STUCK_AFTER_MS after the click (start()) with no clear(): nothing has moved yet, whether
//             the request answered or not; accepted() after that keeps it stuck
// failed() goes back to idle (the button's own error line says why). The state lives here, not in
// a component, so it outlives the bar that started it; the stuck timer is wall-clock from start()
// (from accepted() when nothing called start(), as the website's queued card does).
// A new button joins by naming its key: useSent(key), then start(), accepted() or failed() around
// its request, and clear() from whoever watches what it sent.
import { useMemo, useSyncExternalStore } from 'react';

export const STUCK_AFTER_MS = 30_000;

export type SentPhase = 'idle' | 'sending' | 'sent' | 'stuck';

export interface Sent {
  state: SentPhase;
  start(): void;
  accepted(): void;
  failed(): void;
  clear(): void;
}

const phases = new Map<string, SentPhase>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** When each send's 30 seconds run out (ms since 1970). */
const deadlines = new Map<string, number>();
const listeners = new Set<() => void>();

function stopTimer(key: string) {
  const t = timers.get(key);
  if (t !== undefined) clearTimeout(t);
  timers.delete(key);
  deadlines.delete(key);
}

/** Sending or sent turns stuck once the 30 seconds from the click are over. */
function startTimer(key: string) {
  stopTimer(key);
  deadlines.set(key, Date.now() + STUCK_AFTER_MS);
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    const p = phases.get(key);
    if (p === 'sending' || p === 'sent') set(key, 'stuck');
  }, STUCK_AFTER_MS));
}

function set(key: string, phase: SentPhase) {
  if ((phases.get(key) ?? 'idle') === phase) return;
  if (phase === 'idle') phases.delete(key); else phases.set(key, phase);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The send named `key`: its state, and the four calls that move it. */
export function useSent(key: string): Sent {
  const state = useSyncExternalStore(subscribe, () => phases.get(key) ?? 'idle');
  const calls = useMemo(() => ({
    start: () => { startTimer(key); set(key, 'sending'); },
    accepted: () => {
      const due = deadlines.get(key);
      if (due === undefined) { startTimer(key); set(key, 'sent'); return; }
      set(key, Date.now() >= due ? 'stuck' : 'sent');
    },
    failed: () => { stopTimer(key); set(key, 'idle'); },
    clear: () => { stopTimer(key); set(key, 'idle'); },
  }), [key]);
  return { state, ...calls };
}

/** Forget every send (between tests). */
export function clearAllSent() {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  deadlines.clear();
  if (phases.size === 0) return;
  phases.clear();
  listeners.forEach((l) => l());
}
