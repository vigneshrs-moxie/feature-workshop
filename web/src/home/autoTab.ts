// Jobs' two tabs, Yours and Auto (design section 2), the part without a screen: which tab is
// chosen (remembered in this browser), which jobs Auto's tab takes, and its words. The group comes
// from the server (dashboard/lib/auto.js autoGroup, on the card as job.auto.group): the page never
// works it out. A job with no group (Auto never touched it, it is in Yours, or an older laptop sent
// no group) is under Yours. Tasks 16 and 17 read riskyWords, inAuto and AUTO_PAUSED_LINE from here.
// Auto's words the Inbox shares (AUTO_PAUSED, TOO_BIG) live here too, so this file imports nothing
// from the Inbox.
import type { AutoGroup, AutoQueue, Job } from '../api/types';
import { BRAND } from '../app/brand';
import { useStored } from '../lib/stored';

/** Why Auto start is paused, in the Inbox's words (also the Auto tabs' line for Orbit and memory). */
export const AUTO_PAUSED = { limit: 'Auto start is paused: the Claude limit warning is showing.', orbit: 'Auto start is paused: Orbit can\'t be reached.',
  'limit-reading': `Auto start is paused: ${BRAND.name} can't read your Claude limit right now.`, memory: `Auto start is paused: ${BRAND.name} couldn't read its list of started tickets.` } as const;

/** A ticket or job set aside because its first brief says it needs a stack. */
export const TOO_BIG = 'Too big for Auto';

/** How many Auto jobs work at once (Settings, Auto start): 1 to 10, 5 when the setting has none. */
export const AUTO_MAX = Object.freeze({ min: 1, max: 10, default: 5 });

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
