// @vitest-environment node
// Who the conversation draws where (play/crewLines.ts): pure, from invented jobs and lines.
import { describe, expect, it } from 'vitest';
import type { Job, Run } from '../api/types';
import { dispatchType, foremanMood, handoffLine, liveCrew, nameList, reviewLineup } from './crewLines';

const job = (group: Job['group'], extra: Partial<Job> = {}): Job => ({ slug: 'alpha', title: 'Alpha', group, ...extra });
const run = (status: string): Run => ({ id: 'r', slug: 'alpha', status });
const at = (m: number) => new Date(Date.UTC(2026, 9, 15, 12, m)).toISOString();

describe('crew lines', () => {
  it('reads the worker a routine step started', () => {
    expect(dispatchType('Start a helper: feature-investigator')).toBe('feature-investigator');
    expect(dispatchType('Run git status')).toBeNull();
    expect(dispatchType(null)).toBeNull();
  });

  it('says who started what, by name', () => {
    expect(handoffLine('feature-investigator')).toBe('Sleuth started investigating');
    expect(handoffLine('feature-implementer')).toBe('Builder started building');
    expect(handoffLine('feature-review-db')).toBe('Mason started reviewing');
    expect(handoffLine('general-purpose')).toBe('general-purpose started working');
    expect(nameList(['feature-review-errors'])).toBe('Fuse');
    expect(nameList(['feature-review-errors', 'feature-review-db'])).toBe('Fuse and Mason');
    expect(nameList(['feature-review-errors', 'feature-review-db', 'feature-review-ui', 'feature-reviewer'])).toBe('Fuse, Mason and 2 more');
  });

  it('the live row: workers at work, else the Foreman thinking; waiting on you; asleep in a usage pause', () => {
    expect(liveCrew(job('running'), null)).toBeNull();
    expect(liveCrew(job('running', { nowDoing: [{ who: 'conductor' }, { who: 'feature-tester' }] }), run('running'))).toEqual({ types: ['feature-tester'], state: 'working', text: 'Tester at work' });
    expect(liveCrew(job('running', { nowDoing: [{ who: 'conductor' }] }), run('running'))).toEqual({ types: ['conductor'], state: 'thinking', text: null });
    expect(liveCrew(job('running', { nowDoing: [{ who: 'feature-tester' }] }), run('waiting_permission'))?.state).toBe('waiting');
    expect(liveCrew(job('needs-you', { permissions: 1 }), run('running'))?.types).toEqual(['conductor']);
    expect(liveCrew(job('paused', { limitPaused: at(1) }), null)).toEqual({ types: ['conductor'], state: 'asleep', text: null });
    const usage = { limited: true, blocking: true, label: null, resetsAt: null, jobs: [{ slug: 'alpha', title: 'Alpha' }] };
    expect(liveCrew(job('idle'), null, usage)?.state).toBe('asleep');
  });

  it('the Foreman’s mood follows the job', () => {
    expect(foremanMood(job('needs-you'))).toBe('waiting');
    expect(foremanMood(job('running'))).toBe('thinking');
    expect(foremanMood(job('paused'))).toBe('asleep');
    expect(foremanMood(job('idle'))).toBe('idle');
    expect(foremanMood(job('done', { closed: { as: 'done', at: at(1) } }))).toBe('celebrating');
    expect(foremanMood(job('done', { closed: { as: 'dropped', at: at(1) } }))).toBe('idle');
  });

  it('a review brief’s lineup: the lenses that started since the review brief before it, in the dashboard’s order', () => {
    const activity = [
      { who: 'feature-review-db', startedAt: at(5) },
      { who: 'feature-reviewer', startedAt: at(4) },
      { who: 'feature-tester', startedAt: at(3) },
      { who: 'feature-review-ui', startedAt: at(30) },
      { who: 'feature-review-db', startedAt: at(6) },
    ];
    expect(reviewLineup(activity, at(20))).toEqual(['feature-reviewer', 'feature-review-db']);
    expect(reviewLineup(activity, at(40), at(20))).toEqual(['feature-review-ui']);
    expect(reviewLineup(null, at(20))).toEqual([]);
  });
});
