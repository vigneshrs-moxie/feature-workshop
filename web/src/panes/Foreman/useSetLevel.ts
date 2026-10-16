// Changing an open job's level from the LevelCard or the header's level chip: one POST
// /api/job/:slug/options (app/jobActions.ts setJobLevel), then the line saying what changed
// ("Level set to L3 Large from the next stage. L2→L3 adds: …"), which stays until you close it.
import { useState } from 'react';
import type { LevelNumber } from '../../api/types';
import { setJobLevel } from '../../app/jobActions';
import { levelChange, levelLabel, lensNames } from '../../lib/levels';
import { useWorkshop, useWorkshopState } from '../../state/store';

export interface SetLevel {
  busy: boolean;
  error: string | null;
  /** What the last change did, in words; null before one (or once cleared). */
  done: string | null;
  set(level: LevelNumber): Promise<boolean>;
  clear(): void;
}

/** stage: the job's current stage (finished stages are left out of what the change adds or drops). */
export function useSetLevel(slug: string, from: LevelNumber | null, stage: string | null = null): SetLevel {
  const { api } = useWorkshop();
  const { meta } = useWorkshopState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function set(level: LevelNumber) {
    setBusy(true);
    setError(null);
    try {
      await setJobLevel(api, slug, level);
      const change = levelChange(from, level, meta?.levels, lensNames(meta), stage);
      setDone(`Level set to ${levelLabel(level, meta?.levels)}, from the next stage. ${change.text}.`);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, done, set, clear: () => { setDone(null); setError(null); } };
}
