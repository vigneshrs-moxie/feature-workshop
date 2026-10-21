import { describe, expect, it } from 'vitest';
import type { FlowLane, FlowPr, FlowView, Job } from '../api/types';
import { job, permission } from '../state/test-fixtures';
import { countsWords, deskQueue, filterRows, mapRepos, oneKeyApprove, prText, prTone, sortRows, tableRows, whereText } from './homeModel';

const pr = (number: number, state: FlowPr['state'], extra: Partial<FlowPr> = {}): FlowPr => ({ number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, state, head: 'feature/x', base: 'staging', review: null, checks: null, mergedAt: null, updatedAt: null, ...extra });
const lane = (slug: string, extra: Partial<FlowLane> = {}): FlowLane => ({
  slug, title: null, branch: `feature/${slug}`, worktree: null, position: 'local', reached: 0, vsMain: { ahead: 2, behind: 0 }, vsStaging: null,
  unpushed: null, forkBehind: null, dirty: null, pushed: false, orgBranch: false, pr1: null, pr2: null, ...extra,
});
const flow = (lanes: FlowLane[]): FlowView => ({
  repos: [{ repo: '/r/app', name: 'app', org: { remote: 'moxie', slug: 'o/app' }, fork: { remote: 'origin', slug: 'me/app' }, main: { ref: 'moxie/main', tip: null }, staging: { ref: 'moxie/staging', tip: null, vsMain: { ahead: 4, behind: 0 } }, release: null, prsKnown: true, lanes, errors: [] }],
  fetchedAt: null, checkedAt: null, refreshing: false, nextFetchAt: null,
});

describe('homeModel', () => {
  it('says where a job is and what a PR is doing, in words', () => {
    expect(whereText(lane('a'))).toBe('Only on your machine');
    expect(whereText(lane('a', { position: 'org' }), { org: { remote: 'moxie', slug: null }, staging: null })).toBe('On the moxie branch');
    expect(whereText(lane('a', { position: 'staging' }))).toBe('In staging');
    expect(prText(null)).toBe('No PR yet');
    expect(prText(pr(135, 'merged'))).toBe('#135 merged');
    expect(prText(pr(141, 'open', { checks: 'failing', review: 'changes_requested' }))).toBe('#141 open · checks failing · changes requested');
    expect(prTone(pr(141, 'open', { checks: 'failing' }))).toBe('problem');
    expect(prTone(pr(141, 'draft'))).toBe('open');
    expect(countsWords({ ahead: 1, behind: 2 }, 'main')).toMatch(/1 commit ahead of main, 2 commits behind it\. main has moved on/);
    expect(countsWords(null, 'main')).toBe('Not compared with main yet.');
  });

  it('orders the map’s lanes like the Jobs list and leaves done jobs out unless asked', () => {
    const jobs: Job[] = [job('idle-one', 'idle'), job('needs', 'needs-you'), job('done', 'done'), job('run', 'running')];
    const f = flow([lane('idle-one'), lane('done'), lane('run'), lane('needs'), lane('unknown')]);
    expect(mapRepos(f, jobs)[0].lanes.map((l) => l.lane.slug)).toEqual(['needs', 'run', 'idle-one']);
    expect(mapRepos(f, jobs, 'all')[0].lanes.map((l) => l.lane.slug)).toEqual(['needs', 'run', 'idle-one', 'done', 'unknown']);
    expect(mapRepos(null, jobs)).toEqual([]);
    // A repo with no lane left is left out.
    expect(mapRepos(flow([lane('done')]), jobs)).toEqual([]);
  });

  it('builds the table’s rows, filters, searches and sorts them', () => {
    const jobs: Job[] = [
      { ...job('b', 'needs-you'), title: 'Bravo', level: 2, stage: 'plan', updatedAt: '2026-10-21T10:00:00Z' },
      { ...job('a', 'running'), title: 'Alpha', level: 0, stage: 'implement', updatedAt: '2026-10-21T11:00:00Z' },
      { ...job('c', 'idle'), title: 'Charlie', level: null, updatedAt: '2026-10-20T11:00:00Z' },
      { ...job('d', 'shipping'), title: 'Delta', level: 1, stage: 'pr2', updatedAt: '2026-10-19T11:00:00Z', finish: { reached: true, at: null, by: 'pr1-merged', landed: null } },
    ];
    const rows = tableRows(jobs, flow([lane('a', { position: 'fork', reached: 1, pr1: pr(5, 'open'), vsMain: { ahead: 1, behind: 3 } }), lane('b')]));
    expect(rows.find((r) => r.slug === 'a')).toMatchObject({ repo: 'app', where: 'On your fork', inReview: true, level: 0, stage: 'Build' });
    expect(rows.find((r) => r.slug === 'c')).toMatchObject({ where: '', vsMain: null, inReview: false });
    expect(filterRows(rows, 'review').map((r) => r.slug)).toEqual(['a']);
    expect(filterRows(rows, 'needs-you').map((r) => r.slug)).toEqual(['b']);
    expect(filterRows(rows, 'shipping').map((r) => r.slug)).toEqual(['d']);
    expect(filterRows(rows, 'done').map((r) => r.slug)).toEqual([]);
    expect(filterRows(rows, 'all', 'charl').map((r) => r.slug)).toEqual(['c']);
    expect(filterRows(rows, 'all', 'feature/b').map((r) => r.slug)).toEqual(['b']);
    expect(sortRows(rows, 'job', 'asc').map((r) => r.slug)).toEqual(['a', 'b', 'c', 'd']);
    expect(sortRows(rows, 'status', 'asc').map((r) => r.slug)).toEqual(['b', 'a', 'c', 'd']); // shipping after idle, before done
    expect(sortRows(rows, 'updated', 'desc').map((r) => r.slug)).toEqual(['a', 'b', 'c', 'd']);
    expect(sortRows(rows, 'main', 'desc')[0].slug).toBe('a'); // the most behind first
    expect(sortRows(rows, 'level', 'asc').map((r) => r.slug)).toEqual(['a', 'd', 'b', 'c']); // no level sorts last
  });

  it('queues every decision for the Desk, oldest first, and never one-key-approves a hard line or a question', () => {
    const jobs: Job[] = [
      { ...job('gate', 'needs-you'), waitingFor: 'approval', stage: 'plan', waitingSince: '2026-10-21T09:00:00Z' },
      { ...job('ask', 'needs-you'), waitingFor: 'answers', waitingSince: '2026-10-21T11:00:00Z' },
      { ...job('perm', 'needs-you'), waitingFor: 'permission' },
      job('busy', 'running'),
    ];
    const perms = [
      { ...permission('p1', 'perm'), createdAt: '2026-10-21T10:00:00Z' },
      { ...permission('p2', 'perm'), createdAt: '2026-10-21T08:00:00Z', hardLine: { line: 'git-push', reason: 'x' } },
      { ...permission('q1', 'ask'), kind: 'question' as const, createdAt: '2026-10-21T12:00:00Z' },
    ];
    const q = deskQueue(jobs, perms);
    expect(q.map((i) => i.key)).toEqual(['perm:p2', 'gate:gate', 'perm:p1', 'gate:ask', 'perm:q1']);
    expect(q.find((i) => i.key === 'gate:gate')?.what).toBe('Go-ahead on Plan');
    // a hard line, a go-ahead, a permission, the Foreman's questions, a crew question
    expect(q.map(oneKeyApprove)).toEqual([false, true, true, false, false]);
  });
});
