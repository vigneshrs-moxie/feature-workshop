// The line above the message box (talk any time, 18 Nov): one line, always there, where he types. In the
// terminal he can see whether Claude is working, on what, and for how long; this says the same here.
//   - a reply running: a pulsing dot, `Working` (`Waiting for your permission`, `Stopping…`), the time
//     since the reply started, what the Foreman is doing now (the run's lastAction), then Stop;
//   - no reply: the job's state in the payload's words (`Needs you · …`; at a go-ahead or a question,
//     `Waiting for you · since Tue 3:04 PM`).
// The run's start and last action come from the app's live run, each read on its own so only this line
// draws again (speed rule 5); the payload's run when the live one is missing. The time ticks once a second
// in its own small part, only while a reply runs and the tab is in view; a screen reader hears the words
// change, never the seconds.

import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import { useWorkshop } from '../../state/store';
import { useJob } from '../useJob';
import { STATE_WORDS } from './Header';
import { RUN_ACTIVE, useForemanRun } from './MessageBox';
import { StopReply } from './StopReply';
import { sinceWords } from './YourMove';

/** The time a reply has run, short: `12s`, `4m 12s`, `1h 03m`. */
export function elapsedWords(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/** The ticking time: it alone draws again each second, and only while the tab is in view. */
const Elapsed = memo(function Elapsed({ since }: { since: string }) {
  const start = new Date(since).getTime();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const go = () => {
      if (timer || hidden()) return;
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), 1000);
    };
    const halt = () => { if (timer) clearInterval(timer); timer = null; };
    const onVisibility = () => (hidden() ? halt() : go());
    go();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { halt(); document.removeEventListener('visibilitychange', onVisibility); };
  }, []);
  if (Number.isNaN(start)) return null;
  return <span className="jp2-now-time" aria-hidden="true">{' '}· {elapsedWords(now - start)}</span>;
});

export const NowLine = memo(function NowLine() {
  const { store: app } = useWorkshop();
  const slug = useJob((s) => s.slug);
  const run = useForemanRun();
  const runId = run && RUN_ACTIVE.has(run.status ?? '') ? run.id : null;
  const running = Boolean(run && RUN_ACTIVE.has(run.status ?? ''));
  // The live run's facts, each on its own, only for the reply running now.
  const liveStarted = useSyncExternalStore(app.subscribe, () => {
    const r = app.getState().runs[slug];
    return runId && r && r.id === runId ? r.startedAt ?? null : null;
  });
  const liveAction = useSyncExternalStore(app.subscribe, () => {
    const r = app.getState().runs[slug];
    return runId && r && r.id === runId ? r.lastAction ?? null : null;
  });
  const payloadStarted = useJob((s) => (runId && s.payload?.run?.id === runId ? s.payload.run.startedAt ?? null : null));
  const payloadAction = useJob((s) => (runId && s.payload?.run?.id === runId ? s.payload.run.lastAction ?? null : null));
  // No reply: the job's state in the payload's own words (one string, so only a change in it draws again).
  const idle = useJob((s) => {
    const p = s.payload;
    if (!p) return null;
    const move = p.move;
    if (p.state === 'needs-you' && move && 'since' in move && move.since) {
      const since = sinceWords(move.since);
      if (since) return `Waiting for you · since ${since}`;
    }
    const words = STATE_WORDS[p.state] ?? '';
    return p.stateLine ? `${words} · ${p.stateLine}` : words;
  });

  const started = liveStarted ?? payloadStarted;
  const action = liveAction ?? payloadAction;
  const what = run?.status === 'waiting_permission' ? 'Waiting for your permission' : run?.status === 'stopping' ? 'Stopping…' : 'Working';
  return (
    <div className="jp2-now">
      {running ? (
        <>
          <span className="jp2-now-say" role="status" aria-live="polite">
            <span className="jp2-now-dot" aria-hidden="true" />
            <span className="jp2-now-what">{what}</span>
            {started && <Elapsed key={started} since={started} />}
            {action && <span className="jp2-now-act" title={action}>{' '}· {action}</span>}
          </span>
          <StopReply />
        </>
      ) : (
        <span className="jp2-now-say" role="status" aria-live="polite">
          {idle && <span className="jp2-now-idle" title={idle}>{idle}</span>}
        </span>
      )}
    </div>
  );
});
