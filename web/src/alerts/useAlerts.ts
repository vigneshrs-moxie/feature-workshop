// The page-wide side of alerts, used once by the shell:
//   - the tab title is the page and the product (app/brand.ts), with the Needs-you count: "(2) Jobs · Dashboard";
//   - on your first click anywhere, if you've never been asked, the browser asks whether this page
//     may show notifications, and the answer is remembered (fw.alerts.notify);
//   - when something new needs you, play the chime (if on) and show a notification (if allowed and
//     you're looking at another tab or window; on this page the row and the title already say so).
//     While the dashboard's own macOS notifications are on (Settings → Notifications) those tell
//     you instead, so the browser's never doubles them;
//   - while you're looking at the page it tells the dashboard (POST /api/presence every 20 seconds),
//     so the macOS notifications don't pop for what you can already see.
import { BRAND } from '../app/brand';
import { useEffect, useRef } from 'react';
import { readStored, writeStored } from '../lib/stored';
import { needsYouCount, type WorkshopState } from '../state/reducer';
import { alertOutputs, askNotifyPermission, attentionKeys, CHIME_KEY, newAlerts, notifySupport, NOTIFY_KEY } from './alerts';

export const BASE_TITLE = BRAND.name;

export function titleFor(needs: number, base: string = BASE_TITLE): string {
  return needs > 0 ? `(${needs}) ${base}` : base;
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

const PRESENCE_EVERY_MS = 20_000;

/** Tell the dashboard you're looking at the page, while you are. */
export function usePresence(post: (path: string, body: unknown) => Promise<unknown>) {
  useEffect(() => {
    const say = (visible: boolean) => Promise.resolve().then(() => post('/api/presence', { visible })).catch(() => {});
    const ping = () => { if (pageInView()) void say(true); };
    // Leaving the page (another tab, another app): notifications may pop again at once.
    const left = () => { if (!pageInView()) void say(false); };
    ping();
    const timer = setInterval(ping, PRESENCE_EVERY_MS);
    window.addEventListener('focus', ping);
    window.addEventListener('blur', left);
    const onVisibility = () => (pageInView() ? ping() : left());
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', ping);
      window.removeEventListener('blur', left);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [post]);
}

export function useAlerts(state: WorkshopState, title: string = BASE_TITLE) {
  const needs = state.status === 'ready' ? needsYouCount(state) : 0;
  useEffect(() => { document.title = titleFor(needs, title); }, [needs, title]);
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
    // The dashboard's own notifications tell you only where they can reach macOS (not in the demo).
    const macOS = state.meta?.settings?.notify?.enabled === true && Boolean(state.meta?.notifyMethod);
    if (readStored(NOTIFY_KEY) === 'on' && !macOS && !pageInView()) for (const a of fresh) alertOutputs.notify(a);
  }, [state]);
}
