import { describe, expect, it } from 'vitest';
import type { Job } from '../../api/types';
import { assignBenches, type BenchMemory } from './benches';

const j = (slug: string, group: Job['group'] = 'running'): Job => ({ slug, title: slug, group });

describe('assignBenches', () => {
  it('gives open jobs the benches in order, leaving finished ones out the first time', () => {
    const m = assignBenches(null, [j('a'), j('b', 'done'), j('c', 'needs-you')], 'v1');
    expect(m.slots).toEqual({ a: 0, c: 1 });
  });

  it('follows the start time when the card has one', () => {
    const m = assignBenches(null, [{ ...j('late'), createdAt: '2026-10-02T00:00:00Z' }, { ...j('early'), createdAt: '2026-10-01T00:00:00Z' }], 'v1');
    expect(m.slots).toEqual({ early: 0, late: 1 });
  });

  it('never reshuffles as jobs come, wait and finish within a visit', () => {
    let jobs = [j('a'), j('b'), j('c')];
    let m: BenchMemory = assignBenches(null, jobs, 'v1');
    const first = { ...m.slots };
    // b starts waiting for you, c finishes, d arrives.
    jobs = [j('a'), j('b', 'needs-you'), j('c', 'done'), j('d')];
    m = assignBenches(m, jobs, 'v1');
    expect(m.slots.a).toBe(first.a);
    expect(m.slots.b).toBe(first.b);
    expect(m.slots.c).toBe(first.c);
    expect(m.slots.d).toBe(3);
    // The list's order changing (needs-you first) moves nothing.
    m = assignBenches(m, [j('d'), j('b', 'needs-you'), j('a', 'paused'), j('c', 'done')], 'v1');
    expect(m.slots).toEqual({ a: 0, b: 1, c: 2, d: 3 });
    // A job that's gone frees its bench; the next new job takes the first free one.
    m = assignBenches(m, [j('a'), j('c', 'done'), j('d'), j('e')], 'v1');
    expect(m.slots).toEqual({ a: 0, c: 2, d: 3, e: 1 });
  });

  it('keeps a finished job’s bench until the next visit, then closes up in the same order', () => {
    const v1 = assignBenches(null, [j('a'), j('b'), j('c')], 'v1');
    const done = assignBenches(v1, [j('a'), j('b', 'done'), j('c')], 'v1');
    expect(done.slots.b).toBe(1);
    const v2 = assignBenches(done, [j('c'), j('b', 'done'), j('a'), j('n')], 'v2');
    expect(v2.slots).toEqual({ a: 0, c: 1, n: 2 });
  });

  it('places finished jobs too when asked (the floor lab)', () => {
    const m = assignBenches(null, [j('a', 'done')], 'v1', () => true);
    expect(m.slots).toEqual({ a: 0 });
  });
});
