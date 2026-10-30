// useFloorBenches(): the floor's benches from the workshop's live state (the job cards, the
// waiting permissions, the usage limit, the Foreman's replies), each at its stable bench
// (benches.ts), with every figure's pose and words (model.ts). extra: the floor lab's made-up jobs
// for states the data doesn't have.
import { useMemo, useRef } from 'react';
import type { Job, Permission, Usage } from '../../api/types';
import { useNow } from '../../lib/time';
import { useWorkshopState } from '../../state/store';
import { assignBenches, loadBenchMemory, saveBenchMemory, VISIT, type BenchMemory } from './benches';
import { benchFor } from './model';
import type { FloorBench } from './types';

export interface FloorExtras { jobs?: readonly Job[]; permissions?: readonly Permission[]; usage?: Usage | null }

export function floorBenches(jobs: readonly Job[], memory: BenchMemory, facts: { permissions?: readonly Permission[]; usage?: Usage | null; runs?: Record<string, { status: string } | undefined>; now: Date }): FloorBench[] {
  return jobs
    .filter((j) => memory.slots[j.slug] !== undefined)
    .map((j) => benchFor(j, memory.slots[j.slug], { permissions: facts.permissions, usage: facts.usage, run: (facts.runs?.[j.slug] ?? null) as never, now: facts.now }))
    .sort((a, b) => a.index - b.index);
}

export function useFloorBenches(extra?: FloorExtras): FloorBench[] {
  const state = useWorkshopState();
  const now = useNow();
  const memory = useRef<BenchMemory | null>(null);
  return useMemo(() => {
    const jobs = [...state.jobs, ...(extra?.jobs ?? [])];
    const prev = memory.current ?? loadBenchMemory();
    // The lab's made-up jobs always get a bench, finished ones too.
    const made = new Set((extra?.jobs ?? []).map((j) => j.slug));
    const next = assignBenches(prev, jobs, VISIT, (j) => j.group !== 'done' || made.has(j.slug));
    memory.current = next;
    if (!extra) saveBenchMemory(next);
    return floorBenches(jobs, next, {
      permissions: [...state.permissions, ...(extra?.permissions ?? [])],
      usage: extra?.usage ?? state.usage,
      runs: state.runs,
      now,
    });
  }, [state.jobs, state.permissions, state.usage, state.runs, now, extra]);
}
