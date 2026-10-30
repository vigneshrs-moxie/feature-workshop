// The top bar's usage meters: how much of the Claude plan's 5-hour and weekly limits is used, and
// when each resets. The dashboard reads it once a minute (dashboard/lib/plan-usage.js, read-only)
// and sends it live; clicking a meter reads it again now. The percentage is always in words next to
// the bar, and a meter at 80% or more adds a ⚠ as well as the warning colour. Clicking opens a panel
// with each limit in full (used, left, when it resets) and Read now; Escape or a click outside closes it.
import { useEffect, useRef, useState } from 'react';
import type { PlanUsage, UsageMeter } from '../api/types';
import { clockTime, fullTime, useNow } from '../lib/time';
import { useWorkshop, useWorkshopState } from '../state/store';
import { Button } from './Button';

export const WARN_AT = 80;

/** "in 2h 14m", "in 9m", "now". */
export function resetsIn(iso: string | null, now: Date): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - now.getTime();
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'now';
  const mins = Math.ceil(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `in ${h}h${m ? ` ${m}m` : ''}` : `in ${m}m`;
}

function Meter({ name, long, meter, when }: { name: string; long: string; meter: UsageMeter; when: string }) {
  const level = meter.percent >= 100 ? 'full' : meter.percent >= WARN_AT ? 'warn' : 'ok';
  const words = meter.percent >= 100 ? 'limit reached' : `${meter.percent}% used`;
  return (
    <span className={`usage-meter is-${level}`} data-meter={name}>
      <span className="usage-meter-name">{name}</span>
      <span className="usage-meter-bar" aria-hidden="true">
        <span className="usage-meter-fill" style={{ width: `${Math.min(100, meter.percent)}%` }} />
      </span>
      <span className="usage-meter-value num">
        {level !== 'ok' && <span aria-hidden="true">⚠ </span>}
        {meter.percent}%
      </span>
      {when && <span className="usage-meter-reset">{when}</span>}
      <span className="sr-only">{`${long}: ${words}${when ? `, resets ${when}` : ''}.`}</span>
    </span>
  );
}

function LimitDetail({ long, meter, now }: { long: string; meter: UsageMeter | null; now: Date }) {
  if (!meter) return <div className="usage-detail-row"><span className="usage-detail-name">{long}</span><span className="muted">Not read yet</span></div>;
  const level = meter.percent >= 100 ? 'full' : meter.percent >= WARN_AT ? 'warn' : 'ok';
  return (
    <div className={`usage-detail-row is-${level}`}>
      <div className="usage-detail-head">
        <span className="usage-detail-name">{long}</span>
        <span className="usage-detail-value num">{level !== 'ok' && <span aria-hidden="true">⚠ </span>}{meter.percent >= 100 ? 'Limit reached' : `${meter.percent}% used`}</span>
      </div>
      <span className="usage-detail-bar" aria-hidden="true"><span className="usage-meter-fill" style={{ width: `${Math.min(100, meter.percent)}%` }} /></span>
      <span className="muted">{meter.resetsAt ? `Resets ${resetsIn(meter.resetsAt, now)} · ${fullTime(meter.resetsAt)}` : 'Reset time unknown'}</span>
    </div>
  );
}

export function UsageMeters() {
  const { planUsage } = useWorkshopState();
  const { api, store } = useWorkshop();
  const now = useNow(30_000);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  if (!planUsage?.enabled) return null;
  const u: PlanUsage = planUsage;

  async function checkNow() {
    setChecking(true);
    try {
      const fresh = await api.post<PlanUsage>('/api/usage/check', {});
      store.dispatch({ type: 'plan-usage', planUsage: fresh });
    } catch { /* the next minute's reading tries again */ } finally {
      setChecking(false);
    }
  }

  const hasData = Boolean(u.fiveHour || u.week);
  const hint = [
    'Your Claude plan’s usage, read once a minute. Click to read it now.',
    u.fiveHour ? `5-hour limit: ${u.fiveHour.percent}% used, resets ${fullTime(u.fiveHour.resetsAt)}.` : '',
    u.week ? `Weekly limit: ${u.week.percent}% used, resets ${fullTime(u.week.resetsAt)}.` : '',
    u.checkedAt ? `Last read ${clockTime(u.checkedAt, now)}.` : '',
    u.error ? `The last read failed: ${u.error}` : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="usage-box" ref={box}>
      <button type="button" className={`usage-meters${u.error ? ' is-stale' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog" title={hint} aria-label={hasData ? undefined : 'Claude usage unavailable'}>
        {u.fiveHour && <Meter name="5h" long="5-hour limit" meter={u.fiveHour} when={resetsIn(u.fiveHour.resetsAt, now)} />}
        {u.week && <Meter name="Week" long="Weekly limit" meter={u.week} when={clockTime(u.week.resetsAt, now)} />}
        {!hasData && <span className="usage-meter-none">{u.error ? 'Usage unavailable' : 'Reading usage…'}</span>}
        {hasData && u.error && <span className="usage-meter-stale" aria-hidden="true">·</span>}
      </button>
      {open && (
        <div className="usage-panel" role="dialog" aria-label="Claude plan usage">
          <h3 className="usage-panel-title">Claude plan usage</h3>
          <LimitDetail long="5-hour limit" meter={u.fiveHour} now={now} />
          <LimitDetail long="Weekly limit" meter={u.week} now={now} />
          {u.error && <p className="perm-warn" role="alert">⚠ The last read failed: {u.error}</p>}
          <div className="usage-panel-foot">
            <span className="muted">{u.checkedAt ? `Read ${clockTime(u.checkedAt, now)} · every minute` : 'Read every minute'}</span>
            <Button onClick={() => void checkNow()} disabled={checking}>{checking ? 'Reading…' : 'Read now'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
