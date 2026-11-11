// The Auto line the Jobs card shows: the job's lane reason when it is about Auto ("Auto stopped: …",
// written by dashboard/lib/snapshot.js laneFor, or "Auto is deciding: …"). The job page's bar and the
// Desk card show the same line, so a stopped Auto job says why where he decides.
import type { Job } from '../api/types';

/** The lane reason when it is Auto's ("Auto stopped: …", "Auto is deciding: …"), else null. */
export function autoLaneReason(job: Pick<Job, 'laneReason'>): string | null {
  const r = job.laneReason;
  return typeof r === 'string' && r.startsWith('Auto ') ? r : null;
}

/** Auto is deciding the step that waits (the Approver is at work): his own answer still counts. */
export function autoDeciding(job: Pick<Job, 'laneReason'>): boolean {
  return autoLaneReason(job)?.startsWith('Auto is deciding') ?? false;
}

export const AUTO_DECIDING_NOTE = 'Auto is deciding this step. Your own answer still counts.';
