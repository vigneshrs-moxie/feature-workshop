// Which bench each job stands at: a fixed grid, in the order the jobs started. A new job takes the
// first free bench; a finished job keeps its bench (shown as done) until the next visit; benches
// never reshuffle while you look (the design philosophy's "nothing moves that you didn't move").
// On a new visit, finished jobs leave and the rest close up in the same order.
// assignBenches() is pure; the memory between visits is in localStorage (remembered per browser).
import type { Job } from '../../api/types';

export interface BenchMemory {
  /** The page load these places were given in. */
  visit: string;
  /** Each job's bench, by slug. */
  slots: Record<string, number>;
}

const isOpen = (j: Job) => j.group !== 'done';

/** When a job started, if the card says (dashboards may send none; then the list's order stands). */
function startedAt(j: Job): number {
  for (const k of ['createdAt', 'startedAt', 'created']) {
    const v = j[k];
    if (typeof v === 'string' && Number.isFinite(Date.parse(v))) return Date.parse(v);
  }
  return Number.NaN;
}

function startOrder(jobs: readonly Job[]): Job[] {
  return jobs
    .map((j, i) => ({ j, i, t: startedAt(j) }))
    .sort((a, b) => (Number.isNaN(a.t) || Number.isNaN(b.t) ? a.i - b.i : a.t - b.t || a.i - b.i))
    .map(({ j }) => j);
}

/** The benches for this visit, given the last places (null the first time). place: which jobs get a new bench (open ones). */
export function assignBenches(prev: BenchMemory | null, jobs: readonly Job[], visit: string, place: (j: Job) => boolean = isOpen): BenchMemory {
  const bySlug = new Map(jobs.map((j) => [j.slug, j]));
  const slots: Record<string, number> = {};
  if (prev && prev.visit === visit) {
    // The same visit: everyone keeps their bench, finished jobs included; jobs that are gone free theirs.
    for (const [slug, i] of Object.entries(prev.slots)) if (bySlug.has(slug)) slots[slug] = i;
  } else if (prev) {
    // A new visit: finished jobs leave, the rest close up in their old order.
    Object.entries(prev.slots)
      .filter(([slug]) => { const j = bySlug.get(slug); return j && isOpen(j); })
      .sort((a, b) => a[1] - b[1])
      .forEach(([slug], i) => { slots[slug] = i; });
  }
  const taken = new Set(Object.values(slots));
  let next = 0;
  for (const j of startOrder(jobs)) {
    if (j.slug in slots || !place(j)) continue;
    while (taken.has(next)) next++;
    slots[j.slug] = next;
    taken.add(next);
  }
  return { visit, slots };
}

export const BENCH_KEY = 'fw.floor.benches';

export function loadBenchMemory(): BenchMemory | null {
  try {
    const raw = localStorage.getItem(BENCH_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.visit === 'string' && v.slots && typeof v.slots === 'object' ? v as BenchMemory : null;
  } catch { return null; }
}

export function saveBenchMemory(m: BenchMemory) {
  try { localStorage.setItem(BENCH_KEY, JSON.stringify(m)); } catch { /* private window: not remembered */ }
}

/** This page load: one visit. */
export const VISIT = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
