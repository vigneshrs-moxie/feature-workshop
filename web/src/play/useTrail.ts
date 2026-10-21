// The job's trail for the page (play/trailModel.ts), with what only the page knows: the levels, the
// usage limit, and whether the shared play ledger counts the quest done. One place, so the trail
// and the Jobs list row always agree on who stands where. Null with Play Off. The caller passes
// `now` (one clock for a whole list, not one timer per row).
import type { Job } from '../api/types';
import { useWorkshopState } from '../state/store';
import { jobTrail, type Trail } from './trailModel';
import { usePlayIfAny } from './usePlay';
import { usePlayLedger } from './usePlayLedger';

export function useTrail(job: Job, now: Date, where: 'header' | 'card' = 'header'): Trail | null {
  const play = usePlayIfAny();
  const { meta, usage } = useWorkshopState();
  // The page's shared ledger only: this never fetches one of its own.
  const { load } = usePlayLedger(false);
  if (!play?.on) return null;
  const slugs = load.state === 'ready' ? load.view.quests.slugs : undefined;
  return jobTrail(job, { levels: meta?.levels, done: slugs ? slugs.includes(job.slug) : undefined, finishLine: meta?.settings?.workflow?.finishLine, usage, now, where });
}
