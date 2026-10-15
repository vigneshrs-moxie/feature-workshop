// The page-wide side of alerts, used once by the shell:
//   - the tab title carries the Needs-you count: "(2) Feature Workshop";
//   - on your first click anywhere, if you've never been asked, the browser asks whether this page
//     may show notifications, and the answer is remembered (fw.alerts.notify);
//   - when something new needs you, play the chime (if on) and show a notification (if allowed and
//     you're looking at another tab or window; on this page the row and the title already say so).
import { useEffect, useRef } from 'react';
import { readStored, writeStored } from '../lib/stored';
import { needsYouCount, type WorkshopState } from '../state/reducer';
import { alertOutputs, askNotifyPermission, attentionKeys, CHIME_KEY, newAlerts, notifySupport, NOTIFY_KEY } from './alerts';

export const BASE_TITLE = 'Feature Workshop';

export function titleFor(needs: number): string {
  return needs > 0 ? `(${needs}) ${BASE_TITLE}` : BASE_TITLE;
}

const pageInView = () => document.visibilityState === 'visible' && document.hasFocus();

/** Ask for notification permission on the first click, unless already decided. */
export function useAskOnFirstClick() {
  useEffect(() => {
    if (readStored(NOTIFY_KEY) !== null) return;
    const onClick = (e: MouseEvent) => {
      // The Alerts controls ask for themselves; let that click be theirs.
      if (e.target instanceof Element && e.target.closest('[data-alerts-control]')) return;
      document.removeEventListener('click', onClick, true);
      if (readStored(NOTIFY_KEY) !== null) return;
      const support = notifySupport();
      if (support === 'unsupported') return;
      if (support !== 'default') { writeStored(NOTIFY_KEY, support === 'granted' ? 'on' : 'off'); return; }
      void askNotifyPermission().then((answer) => {
        if (readStored(NOTIFY_KEY) === null) writeStored(NOTIFY_KEY, answer === 'granted' ? 'on' : 'off');
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
}

export function useAlerts(state: WorkshopState) {
  const needs = state.status === 'ready' ? needsYouCount(state) : 0;
  useEffect(() => { document.title = titleFor(needs); }, [needs]);
  useEffect(() => () => { document.title = BASE_TITLE; }, []);

  useAskOnFirstClick();

  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (state.status !== 'ready') return;
    const now = attentionKeys(state);
    const before = seen.current;
    seen.current = now;
    if (!before) return; // what was there when the page loaded never alerts
    const fresh = newAlerts(before, state);
    if (!fresh.length) return;
    if (readStored(CHIME_KEY) === 'on') alertOutputs.chime();
    if (readStored(NOTIFY_KEY) === 'on' && !pageInView()) for (const a of fresh) alertOutputs.notify(a);
  }, [state]);
}
