// Which step the job page opens (design 3.2): your pick on this page wins; then the step the address
// names (the step page's old address, a link, Back); then the step the job is at while it works or
// waits; then the one you last opened on this job (sb.job.step.<slug>); then the job's own step; else
// Spec. A value that is not a step counts as not set.
import type { StopId } from '../../api/types';
import { isStopId } from '../../components/stops/stops';

/** Where the step you last opened on a job is kept. */
export const lastStepKey = (slug: string) => `sb.job.step.${slug}`;

type Sources = 'picked' | 'address' | 'live' | 'last' | 'current';
const ORDER: readonly Sources[] = ['picked', 'address', 'live', 'last', 'current'];

export function pickOpenStep(from: Partial<Record<Sources, StopId | null | undefined>>): StopId {
  for (const k of ORDER) {
    const v = from[k];
    if (isStopId(v)) return v;
  }
  return 'spec';
}
