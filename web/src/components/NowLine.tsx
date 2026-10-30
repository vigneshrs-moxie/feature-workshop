// The one "now" line (packet R, principle 9): who is at work on a job and on what, for how long:
// "Builder · editing merge.ts · 2m", or "Foreman · waiting for you · 35m". The job's whole activity
// is elsewhere, folded; this line is what a terminal's current line gives you.
import type { Job } from '../api/types';
import { laneOf } from '../home/JobsPage';
import { relativeTime } from '../lib/time';
import { Icon, type IconName } from './Icon';

export interface Now { who: string; what: string; since: string | null; icon: IconName; tone: 'working' | 'waiting' | 'quiet' }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The job's now line, in words. */
export function nowOf(job: Job): Now {
  const lane = laneOf(job);
  const c = job.nowDoing?.[0];
  if (c && (c.doing || c.name || c.who)) {
    return { who: cap(c.name || c.who), what: c.doing ? lowerStart(c.doing) : 'at work', since: c.since ?? c.lastAt ?? null, icon: 'loader', tone: 'working' };
  }
  if (lane === 'needs-you') return { who: 'Foreman', what: 'waiting for you', since: job.waitingSince ?? job.updatedAt ?? null, icon: 'hand', tone: 'waiting' };
  if (lane === 'working') return { who: 'The crew', what: job.laneReason ? lowerStart(job.laneReason) : 'at work', since: job.updatedAt ?? null, icon: 'loader', tone: 'working' };
  return { who: 'Nobody', what: job.laneReason ? lowerStart(job.laneReason) : 'nothing happening', since: job.updatedAt ?? null, icon: 'clock', tone: 'quiet' };
}

/** "Editing merge.ts" → "editing merge.ts", but "PR #2 is open" keeps its capital. */
function lowerStart(s: string): string {
  return /^[A-Z][a-z]/.test(s) && !/^(PR|CI|Opus|Sonnet|Haiku|GitHub)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

export function NowLine({ job, now, className = '' }: { job: Job; now: Date; className?: string }) {
  const n = nowOf(job);
  return (
    <p className={`now-line is-${n.tone} ${className}`.trim()} aria-label="Now">
      <Icon name={n.icon} size={14} className="now-icon" />
      <b className="now-who">{n.who}</b>
      <span className="now-sep" aria-hidden="true">·</span>
      <span className="now-what">{n.what}</span>
      {n.since && (
        <>
          <span className="now-sep" aria-hidden="true">·</span>
          <time className="now-time num" dateTime={n.since}>{relativeTime(n.since, now)}</time>
        </>
      )}
    </p>
  );
}
