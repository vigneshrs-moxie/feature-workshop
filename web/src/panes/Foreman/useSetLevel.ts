// Changing an open job's level from the LevelCard or the header's level chip: one POST
// /api/job/:slug/options (app/jobActions.ts setJobLevel), then the line saying what changed
// ("Level set to L3 Large from the next stage. L2→L3 adds: …"), which stays until you close it.
import { useState } from 'react';
import type { JobOptions, LevelNumber } from '../../api/types';
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

export function useSetLevel(slug: string, from: LevelNumber | null, options: JobOptions | null | undefined): SetLevel {
  const { api } = useWorkshop();
  const { meta } = useWorkshopState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function set(level: LevelNumber) {
    setBusy(true);
    setError(null);
    try {
      await setJobLevel(api, slug, options, level);
      const change = levelChange(from, level, meta?.levels, lensNames(meta));
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
