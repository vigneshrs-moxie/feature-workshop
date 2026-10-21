// The Desk's nudge items and side column (home/nudges.ts): order, one-key rules, the job's facts
// and where its work is, and the session's Decided today log. Pure; invented jobs.
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Job, Nudge } from '../api/types';
import { job, permission } from '../state/test-fixtures';
import { deskQueue } from './homeModel';
import { clearDecisions, deskEntries, isShipping, jobFacts, nudgeItems, nudgePath, oneKeyDecide, recordDecision, useDecidedToday, whereLine } from './nudges';

const nudge = (id: Nudge['id'], extra: Partial<Nudge> = {}): Nudge => ({
  id, kind: id.endsWith('merge') ? 'link' : 'ask', title: `Nudge ${id}`, text: 'Why.', link: id.endsWith('merge') ? 'https://github.com/x/y/pull/1' : null,
  action: id.endsWith('merge') ? null : { send: 'Please.' }, afterLine: false, ...extra,
});

afterEach(clearDecisions);

describe('nudge items', () => {
  it('lists every job’s nudges after the decisions, oldest first, those after the finish line last', () => {
    const jobs: Job[] = [
      job('late', 'shipping', { updatedAt: '2026-10-21T10:00:00Z', nudges: [nudge('pr2-review', { afterLine: true })], finish: { reached: true, at: '2026-10-21T08:00:00Z', by: 'pr1-merged', landed: null } }),
      job('early', 'idle', { updatedAt: '2026-10-19T10:00:00Z', nudges: [nudge('pr1-merge')] }),
      job('mid', 'idle', { updatedAt: '2026-10-20T10:00:00Z', nudges: [nudge('pr1-merge')] }),
      job('alpha', 'needs-you', { waitingFor: 'approval', waitingSince: '2026-10-21T12:00:00Z' }),
    ];
    const items = nudgeItems(jobs);
    expect(items.map((i) => i.slug)).toEqual(['early', 'mid', 'late']);
    expect(items[0]).toMatchObject({ kind: 'nudge', key: 'nudge:early:pr1-merge', title: 'Job early', what: 'Nudge pr1-merge', since: '2026-10-19T10:00:00Z' });
    expect(items[2].since, 'a job past the line: when it crossed it').toBe('2026-10-21T08:00:00Z');
    const all = deskEntries(deskQueue(jobs, [permission('p1', 'alpha')]), jobs);
    expect(all.map((e) => e.key)).toEqual(['gate:alpha', 'perm:p1', 'nudge:early:pr1-merge', 'nudge:mid:pr1-merge', 'nudge:late:pr2-review']);
    expect(all.map(isShipping)).toEqual([false, false, false, false, true]);
    expect(deskEntries([], [job('beta', 'running')])).toEqual([]);
  });

  it('a nudge is one-key when the Foreman can take it on; links and the usual rules otherwise', () => {
    const [ask, link] = nudgeItems([job('a', 'idle', { nudges: [nudge('pr2-open'), nudge('pr2-merge')] })]);
    expect(oneKeyDecide(ask)).toBe(true);
    expect(oneKeyDecide(link)).toBe(false);
    const [gate, perm] = deskQueue([job('alpha', 'needs-you', { waitingFor: 'approval' })], [permission('p1', 'alpha')]);
    expect(oneKeyDecide(gate)).toBe(true);
    expect(oneKeyDecide(perm)).toBe(true);
    expect(oneKeyDecide({ ...perm, kind: 'permission', permission: { ...permission('p2', 'alpha'), hardLine: { line: 'git-push', reason: 'r' } } })).toBe(false);
    expect(nudgePath('my job', 'pr2-open', 'yes')).toBe('/api/job/my%20job/nudge/pr2-open/yes');
  });
});

describe('the job’s facts and where its work is', () => {
  it('facts: status, kind, level, repo, branch, and the cost only over 10 cents', () => {
    expect(jobFacts(job('a', 'running', { kind: 'bug', level: 2, repo: { name: 'portal', branch: 'fix/a' }, cost: { totalUsd: 0.09 } }))).toEqual(['Running', 'Bug fix', 'L2', 'portal', 'fix/a']);
    expect(jobFacts(job('a', 'shipping', { kind: 'feature', cost: { totalUsd: 2.5, source: 'claude-code' } }))).toEqual(['Shipping', 'Feature', '$2.50']);
    expect(jobFacts(job('a', 'idle', { cost: { totalUsd: 3, source: 'none' } }))).toEqual(['Idle']);
  });

  it('where: from the finish line when it says, else the branch and the stage', () => {
    expect(whereLine(job('a', 'done', { finish: { reached: true, at: null, by: 'main', landed: 'main' } }))).toBe('Released to main');
    expect(whereLine(job('a', 'shipping', { finish: { reached: true, at: null, by: 'pr1-merged', landed: 'staging' } }))).toBe('In staging, waiting for the release');
    expect(whereLine(job('a', 'shipping', { finish: { reached: true, at: null, by: 'pr1-merged', landed: null } }))).toBe('On the Moxie branch');
    expect(whereLine(job('a', 'shipping', { finish: { reached: true, at: null, by: 'pr1-open', landed: null } }))).toBe('PR #1 open from your fork');
    expect(whereLine(job('a', 'done', { finish: { reached: true, at: null, by: 'marked', landed: null } }))).toBe('Marked done');
    expect(whereLine(job('a', 'running', { stage: 'implement', repo: { name: 'portal', branch: 'feature/a' }, finish: { reached: false, at: null, by: null, landed: null } }))).toBe('feature/a · Build');
    expect(whereLine(job('a', 'running', { stage: 'plan' }))).toBe('Plan');
    expect(whereLine(job('a', 'idle'))).toBe('No branch yet');
  });
});

describe('Decided today', () => {
  it('keeps this session’s decisions, newest first, at most 50, and tells the hook', () => {
    const { result } = renderHook(() => useDecidedToday());
    expect(result.current).toEqual([]);
    act(() => recordDecision({ title: 'Job a', what: 'Allowed once', at: '2026-10-21T10:00:00Z' }));
    act(() => recordDecision({ title: 'Job b', what: 'Approved', at: '2026-10-21T10:05:00Z' }));
    expect(result.current.map((d) => d.title)).toEqual(['Job b', 'Job a']);
    act(() => { for (let i = 0; i < 60; i++) recordDecision({ title: `Job ${i}`, what: 'x' }); });
    expect(result.current).toHaveLength(50);
    expect(result.current[0].title).toBe('Job 59');
    expect(result.current[0].at, 'stamped now when no time is given').toMatch(/^\d{4}-/);
    act(clearDecisions);
    expect(result.current).toEqual([]);
  });
});
