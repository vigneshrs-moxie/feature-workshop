// useFloorBenches(): the station's bays from the workshop's live state (the job cards, the
// waiting permissions, the usage limit, the Foreman's replies, the stacks), each at its stable bay
// (benches.ts), with every figure's pose and words (model.ts). A stack is one bay: its own job
// builds a larger module, a section per part, so its parts take no bays of their own. extra: the
// station lab's made-up jobs for states the data doesn't have.
import { useMemo, useRef } from 'react';
import type { Job, Permission, StackSummary, Usage } from '../../api/types';
import { useStacksList } from '../../views/Stack/useStacks';
import { useNow } from '../../lib/time';
import { useWorkshopState } from '../../state/store';
import { assignBenches, loadBenchMemory, saveBenchMemory, VISIT, type BenchMemory } from './benches';
import { benchFor, stackBench } from './model';
import type { FloorBench } from './types';

export interface FloorExtras { jobs?: readonly Job[]; permissions?: readonly Permission[]; usage?: Usage | null }

export function floorBenches(jobs: readonly Job[], memory: BenchMemory, facts: { permissions?: readonly Permission[]; usage?: Usage | null; runs?: Record<string, { status: string } | undefined>; now: Date; stacks?: readonly StackSummary[] }): FloorBench[] {
  const stacks = new Map((facts.stacks ?? []).map((s) => [s.slug, s]));
  const bySlug = new Map(jobs.map((j) => [j.slug, j]));
  return jobs
    .filter((j) => memory.slots[j.slug] !== undefined)
    .map((j) => {
      const f = { permissions: facts.permissions, usage: facts.usage, run: (facts.runs?.[j.slug] ?? null) as never, now: facts.now };
      const stack = stacks.get(j.slug);
      return stack?.sections?.length ? stackBench(j, memory.slots[j.slug], stack.sections, bySlug, f) : benchFor(j, memory.slots[j.slug], f);
    })
    .sort((a, b) => a.index - b.index);
}

/**
 * The jobs that are parts of a stack: they are sections of their stack's module, not bays of their
 * own. From the stacks list, and before it has answered from the parts' own names
 * (<stack>--<part>, dashboard/lib/stack.js), so a part never takes a bay it must give back later
 * (bays never reshuffle within a visit).
 */
export function partSlugs(stacks: readonly StackSummary[], jobs: readonly Pick<Job, 'slug'>[] = []): Set<string> {
  const out = new Set<string>();
  for (const s of stacks) for (const p of s.sections ?? []) out.add(p.slug ?? `${s.slug}--${p.name}`);
  const slugs = new Set(jobs.map((j) => j.slug));
  for (const j of jobs) {
    const at = j.slug.indexOf('--');
    if (at > 0 && slugs.has(j.slug.slice(0, at))) out.add(j.slug);
  }
  return out;
}

export function useFloorBenches(extra?: FloorExtras): FloorBench[] {
  const state = useWorkshopState();
  const now = useNow();
  const memory = useRef<BenchMemory | null>(null);
  const { list } = useStacksList();
  const stacks = list?.stacks;
  return useMemo(() => {
    const all = [...state.jobs, ...(extra?.jobs ?? [])];
    const parts = partSlugs(stacks ?? [], all);
    const jobs = all.filter((j) => !parts.has(j.slug));
    const prev = memory.current ?? loadBenchMemory();
    // The lab's made-up jobs always get a bench, finished ones too.
    const made = new Set((extra?.jobs ?? []).map((j) => j.slug));
    const next = assignBenches(prev, jobs, VISIT, (j) => j.group !== 'done' || made.has(j.slug));
    memory.current = next;
    if (!extra) saveBenchMemory(next);
    // The parts' own job cards go along, so a section at work can bring its crew.
    return floorBenches([...jobs, ...all.filter((j) => parts.has(j.slug))], next, {
      permissions: [...state.permissions, ...(extra?.permissions ?? [])],
      usage: extra?.usage ?? state.usage,
      runs: state.runs,
      now,
      stacks,
    });
  }, [state.jobs, state.permissions, state.usage, state.runs, now, extra, stacks]);
}
