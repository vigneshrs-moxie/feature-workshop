import { describe, expect, it } from 'vitest';
import type { Run } from '../api/types';
import { runTiming } from './runTiming';

const now = new Date('2026-10-26T12:00:00Z');
const run = (mins: number, kind = 'approve'): Run => ({ id: 'r', slug: 's', status: 'running', kind, startedAt: new Date(now.getTime() - mins * 60_000).toISOString(), endedAt: null });

describe('runTiming', () => {
  it('time so far and the usual for its kind, else for all kinds', () => {
    expect(runTiming(run(4), { all: 60_000, byKind: { approve: 120_000 } }, now)?.text).toBe('4m · usually 2m');
    expect(runTiming(run(4, 'nudge'), { all: 60_000, byKind: { approve: 120_000 } }, now)?.text).toBe('4m · usually 1m');
    expect(runTiming(run(4), { all: 600_000, byKind: {} }, now)?.over).toBe(false);
    expect(runTiming(run(70), { all: 600_000, byKind: {} }, now)?.text).toBe('1h 10m · usually 10m');
  });
  it('no usual: time so far only; ended or unknown: nothing', () => {
    expect(runTiming(run(3), null, now)?.text).toBe('3m');
    expect(runTiming({ ...run(3), endedAt: now.toISOString() }, null, now)).toBeNull();
    expect(runTiming(null, null, now)).toBeNull();
  });
});
