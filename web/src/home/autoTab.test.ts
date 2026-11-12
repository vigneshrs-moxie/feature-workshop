// Jobs' Auto tab, the pure part: which jobs it takes (the server's group, never worked out here),
// the risky calls and the Working heading in words, and the paused line.
import { describe, expect, it } from 'vitest';
import { job } from '../state/test-fixtures';
import { AUTO_PAUSED } from '../views/Inbox';
import { AUTO_PAUSED_LINE, autoGroups, autoPausedLine, inAuto, riskyWords, workingHeading } from './autoTab';

describe('Jobs: the Auto tab, in words', () => {
  it('inAuto and autoGroups follow the server\'s group', () => {
    const jobs = [
      job('w1', 'running', { auto: { on: true, group: 'working' } }),
      job('n1', 'needs-you', { auto: { on: true, stopped: { reason: 'blocked' }, group: 'needs-you' } }),
      job('t1', 'idle', { auto: { on: false, tooBig: { at: 'x', reason: 'Big.' }, group: 'needs-you' } }),
      job('r1', 'shipping', { auto: { on: false, finished: 'x', group: 'ready' } }),
      job('w2', 'running', { auto: { on: true, group: 'working' } }),
      // Auto is on and it isn't stopped, but the server put it in no group: it is Yours.
      job('mine', 'running', { auto: { on: true, group: null } }),
      job('plain', 'idle'),
    ];
    expect(jobs.filter(inAuto).map((j) => j.slug)).toEqual(['w1', 'n1', 't1', 'r1', 'w2']);
    const g = autoGroups(jobs);
    expect(g.working.map((j) => j.slug)).toEqual(['w1', 'w2']);
    expect(g['needs-you'].map((j) => j.slug)).toEqual(['n1', 't1']);
    expect(g.ready.map((j) => j.slug)).toEqual(['r1']);
  });

  it('a job from an older laptop with no group is Yours', () => {
    const older = job('old', 'running', { auto: { on: true, by: 'tag', ran: true } });
    expect(inAuto(older)).toBe(false);
    expect(inAuto(job('none', 'idle'))).toBe(false);
    expect(Object.values(autoGroups([older])).flat()).toEqual([]);
  });

  it('riskyWords', () => {
    expect(riskyWords(0)).toBe('No risky calls');
    expect(riskyWords(1)).toBe('1 risky call');
    expect(riskyWords(2)).toBe('2 risky calls');
    expect(riskyWords(12)).toBe('12 risky calls');
  });

  it('workingHeading with and without a max', () => {
    expect(workingHeading(3, 5)).toBe('Working · 3 of 5');
    expect(workingHeading(0, 5)).toBe('Working · 0 of 5');
    expect(workingHeading(3, null)).toBe('Working · 3');
  });

  it('the paused line: the usage limit in the design\'s words, Orbit and memory in the Inbox\'s', () => {
    expect(AUTO_PAUSED_LINE).toBe('Auto is paused: the usage limit is near');
    expect(autoPausedLine('limit')).toBe(AUTO_PAUSED_LINE);
    expect(autoPausedLine('limit-reading')).toBe(AUTO_PAUSED_LINE);
    expect(autoPausedLine('orbit')).toBe(AUTO_PAUSED.orbit);
    expect(autoPausedLine('memory')).toBe(AUTO_PAUSED.memory);
    expect(autoPausedLine(null)).toBeNull();
    expect(autoPausedLine(undefined)).toBeNull();
  });
});
