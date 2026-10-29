// The status strip (packet M, Play full only): one thin line under the top bar, like a control
// room's board. The jobs in each lane in words and numbers, the time here and in UTC, and the week's
// usage when the dashboard reads it. Everything in it is also elsewhere in words; it is decoration
// that informs, never the only place a status shows. It never moves; reduced motion changes nothing.
import { laneOf, LANE_INFO } from '../home/JobsPage';
import { useNow } from '../lib/time';
import { useWorkshopState } from '../state/store';
import { usePlay } from './usePlay';

const LANES = ['working', 'needs-you', 'in-review', 'ready'] as const;

const hhmm = (d: Date, utc: boolean) => {
  const h = utc ? d.getUTCHours() : d.getHours();
  const m = utc ? d.getUTCMinutes() : d.getMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export function StatusStrip() {
  const state = useWorkshopState();
  const play = usePlay();
  const now = useNow(30_000);
  if (!play.full || state.status !== 'ready') return null;
  const counts = Object.fromEntries(LANES.map((l) => [l, 0])) as Record<(typeof LANES)[number], number>;
  for (const j of state.jobs) {
    const lane = laneOf(j);
    if (lane in counts) counts[lane as (typeof LANES)[number]] += 1;
  }
  const week = state.planUsage?.enabled ? state.planUsage.week : null;
  return (
    <div className="status-strip" role="status" aria-label="The board at a glance">
      <span className="strip-cell strip-label">Boards</span>
      {LANES.map((l) => (
        <span key={l} className={`strip-cell is-${l}`} title={LANE_INFO[l].hint}>{LANE_INFO[l].word} <b>{counts[l]}</b></span>
      ))}
      <span className="strip-sep" aria-hidden="true" />
      <span className="strip-cell" title="The time here.">{hhmm(now, false)} <span className="strip-unit">local</span></span>
      <span className="strip-cell" title="The time in UTC.">{hhmm(now, true)} <span className="strip-unit">UTC</span></span>
      {week && (
        <>
          <span className="strip-sep" aria-hidden="true" />
          <span className="strip-cell" title="How much of this week’s usage is spent.">Week gauge <b>{Math.round(week.percent)}%</b></span>
        </>
      )}
    </div>
  );
}
