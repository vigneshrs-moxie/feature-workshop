// The lock card: the job is being driven somewhere else (dashboard/lib/lock.js, plan D12), so the
// dashboard refused to start a reply. A send that comes back 409 with code 'job-locked' carries the
// lock ({ owner, pid, branch, acquiredAt }); lockFromError picks it out, and the card says who has
// the job, since when, and what to do. Plain text says it, not colour: the headline names the holder.
import { ApiError } from '../../api/client';
import { clockTime, fullTime } from '../../lib/time';

export type { JobLockInfo } from '../../api/types';
import type { JobLockInfo } from '../../api/types';

/** The lock a refused send carries, or null when the error is something else. */
export function lockFromError(err: unknown): JobLockInfo | null {
  if (!(err instanceof ApiError) || err.status !== 409 || err.body.code !== 'job-locked') return null;
  const raw = (err.body.lock ?? {}) as Record<string, unknown>;
  return {
    owner: raw.owner === 'terminal' ? 'terminal' : 'runner',
    pid: typeof raw.pid === 'number' ? raw.pid : null,
    branch: typeof raw.branch === 'string' && raw.branch ? raw.branch : null,
    acquiredAt: typeof raw.acquiredAt === 'string' ? raw.acquiredAt : null,
  };
}

/** "This job is open in a terminal (pid N, since T)" (or another dashboard). */
export function lockHeadline(lock: JobLockInfo, now: Date = new Date()): string {
  const since = clockTime(lock.acquiredAt, now) || 'a while ago';
  const facts = `(pid ${lock.pid ?? 'unknown'}, since ${since})`;
  return lock.owner === 'terminal'
    ? `This job is open in a terminal ${facts}`
    : `This job is being run by another copy of the dashboard ${facts}`;
}

export function LockCard({ lock, now }: { lock: JobLockInfo; now?: Date }) {
  const terminal = lock.owner === 'terminal';
  return (
    <section className="perm-card lock-card" data-ask="lock" role="status" aria-label="Job open elsewhere">
      <header className="perm-head">
        <p className="perm-who">Open somewhere else</p>
      </header>
      <h3 className="perm-headline" title={lock.acquiredAt ? `Since ${fullTime(lock.acquiredAt)}.` : undefined}>{lockHeadline(lock, now)}</h3>
      <p>Only one place can work on a job at a time, so nothing was sent.</p>
      <p className="muted">
        {terminal
          ? 'Finish there, or close that Claude Code session (/exit), then send again. Once that session has ended, sending again takes the job over.'
          : 'Stop it in that dashboard first, then send again. Once that dashboard has stopped, sending again takes the job over.'}
      </p>
      {lock.branch && <p className="muted">Branch there: <code className="inline-code num">{lock.branch}</code></p>}
    </section>
  );
}
