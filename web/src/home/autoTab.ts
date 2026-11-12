// Jobs' two tabs, Yours and Auto (design section 2), the part without a screen: which tab is
// chosen (remembered in this browser), which jobs Auto's tab takes, and its words. The group comes
// from the server (dashboard/lib/auto.js autoGroup, on the card as job.auto.group): the page never
// works it out. A job with no group (Auto never touched it, it is in Yours, or an older laptop sent
// no group) is under Yours. Tasks 16 and 17 read riskyWords, inAuto and AUTO_PAUSED_LINE from here.
import type { AutoGroup, AutoQueue, Job } from '../api/types';
import { useStored } from '../lib/stored';
import { AUTO_PAUSED } from '../views/Inbox';

export type JobsTab = 'yours' | 'auto';
export const JOBS_TAB_KEY = 'gc.jobs.tab';

/** The chosen tab, remembered in this browser; Yours by default. */
export function useJobsTab(): [JobsTab, (t: JobsTab) => void] {
  const [raw, set] = useStored(JOBS_TAB_KEY);
  return [raw === 'auto' ? 'auto' : 'yours', (t) => set(t === 'auto' ? 'auto' : null)];
}

/** The job shows under Auto: the server gave it one of Auto's groups. */
export const inAuto = (job: Job): boolean => Boolean(job.auto?.group);

export const AUTO_GROUPS: readonly AutoGroup[] = ['working', 'needs-you', 'ready'];

/** Auto's jobs by the server's group, each in the order given; jobs without a group are left out. */
export function autoGroups(jobs: readonly Job[]): Record<AutoGroup, Job[]> {
  const out: Record<AutoGroup, Job[]> = { working: [], 'needs-you': [], ready: [] };
  for (const j of jobs) {
    const g = j.auto?.group;
    if (g && g in out) out[g].push(j);
  }
  return out;
}

/** The risky calls Auto made on a job, in words. */
export const riskyWords = (n: number): string => (n === 0 ? 'No risky calls' : n === 1 ? '1 risky call' : `${n} risky calls`);

/** The Working group's heading with its places: "Working · 3 of 5"; with no max known, "Working · 3". */
export const workingHeading = (working: number, max: number | null): string => (max === null ? `Working · ${working}` : `Working · ${working} of ${max}`);

/** The design's words while Auto starts nothing near the usage limit. */
export const AUTO_PAUSED_LINE = 'Auto is paused: the usage limit is near';

/** Why Auto is paused, for the top of the tab: the limit in the design's words, Orbit and memory in the Inbox's; null when it isn't. */
export function autoPausedLine(paused: AutoQueue['paused'] | undefined): string | null {
  if (paused === 'limit' || paused === 'limit-reading') return AUTO_PAUSED_LINE;
  if (paused === 'orbit' || paused === 'memory') return AUTO_PAUSED[paused];
  return null;
}
