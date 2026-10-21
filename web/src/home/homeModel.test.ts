import { describe, expect, it } from 'vitest';
import type { FlowLane, FlowPr, FlowRepo, FlowView, Job } from '../api/types';
import { job, permission } from '../state/test-fixtures';
import {
  countsSuffix, countsWords, deskQueue, filterRepos, filterRows, finishStop, groupLanes, knownChip, mapChips, mapRepos, newestPr, nextHint, oneKeyApprove,
  prPhrase, prText, prTone, releaseLineText, sortRows, tableRows, trackStops, whereLine, whereText,
} from './homeModel';

const pr = (number: number, state: FlowPr['state'], extra: Partial<FlowPr> = {}): FlowPr => ({ number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, state, head: 'feature/x', base: 'staging', review: null, checks: null, mergedAt: null, updatedAt: null, ...extra });
const lane = (slug: string, extra: Partial<FlowLane> = {}): FlowLane => ({
  slug, title: null, branch: `feature/${slug}`, worktree: null, position: 'local', reached: 0, vsMain: { ahead: 2, behind: 0 }, vsStaging: null,
  unpushed: null, forkBehind: null, dirty: null, pushed: false, orgBranch: false, pr1: null, pr2: null, ...extra,
});
const repoOf = (lanes: FlowLane[], extra: Partial<FlowRepo> = {}): FlowRepo => ({ repo: '/r/app', name: 'app', org: { remote: 'moxie', slug: 'o/app' }, fork: { remote: 'origin', slug: 'me/app' }, main: { ref: 'moxie/main', tip: null }, staging: { ref: 'moxie/staging', tip: null, vsMain: { ahead: 4, behind: 0 } }, release: null, prsKnown: true, lanes, errors: [], ...extra });
const flow = (lanes: FlowLane[], extra: Partial<FlowRepo> = {}): FlowView => ({ repos: [repoOf(lanes, extra)], fetchedAt: null, checkedAt: null, refreshing: false, nextFetchAt: null });
const SIMPLE: Pick<FlowRepo, 'org' | 'staging'> = { org: null, staging: null };
const NOW = new Date('2026-10-21T12:00:00Z');

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

  it('orders the map’s lanes like the Jobs list; closed jobs and unknown lanes only when asked', () => {
    const jobs: Job[] = [job('idle-one', 'idle'), job('needs', 'needs-you'), job('done', 'done', { closed: { as: 'done' } }), job('run', 'running'), job('landed', 'done', { finish: { reached: true, at: null, by: 'pr1-merged', landed: 'main' } })];
    const f = flow([lane('idle-one'), lane('done'), lane('run'), lane('landed', { position: 'main', reached: 4 }), lane('needs'), lane('unknown')]);
    // A job in main that isn't marked done is still open: it stays, under Done.
    expect(mapRepos(f, jobs)[0].lanes.map((l) => l.lane.slug)).toEqual(['needs', 'run', 'idle-one', 'landed']);
    expect(mapRepos(f, jobs, 'all')[0].lanes.map((l) => l.lane.slug)).toEqual(['needs', 'run', 'idle-one', 'done', 'landed', 'unknown']);
    expect(mapRepos(null, jobs)).toEqual([]);
    // A repo with no lane left is left out.
    expect(mapRepos(flow([lane('done')]), jobs)).toEqual([]);
  });

  it('groups the rows under Needs you · Running · Idle · Shipping · Done, Paused with Idle, a lane without a job under Done', () => {
    const lanes = [
      { lane: lane('a'), job: job('a', 'paused') }, { lane: lane('b'), job: job('b', 'needs-you') }, { lane: lane('c'), job: job('c', 'shipping') },
      { lane: lane('d'), job: null }, { lane: lane('e'), job: job('e', 'idle') }, { lane: lane('f'), job: job('f', 'running') },
    ];
    expect(groupLanes(lanes).map((g) => [g.label, g.lanes.map((l) => l.lane.slug)])).toEqual([
      ['Needs you', ['b']], ['Running', ['f']], ['Idle', ['a', 'e']], ['Shipping', ['c']], ['Done', ['d']],
    ]);
    expect(groupLanes([{ lane: lane('x'), job: job('x', 'idle') }]).map((g) => g.group)).toEqual(['idle']);
  });

  it('chips: All · Needs you · Shipping, one per repo when there is more than one, with counts; a forgotten chip reads as All', () => {
    const jobs = [job('n', 'needs-you'), job('s', 'shipping'), job('i', 'idle')];
    const one = mapRepos(flow([lane('n'), lane('s'), lane('i')]), jobs);
    expect(mapChips(one).map((c) => [c.id, c.count])).toEqual([['all', 3], ['needs-you', 1], ['shipping', 1]]);
    const two: FlowView = { ...flow([lane('n'), lane('s')]), repos: [repoOf([lane('n'), lane('s')]), repoOf([lane('i')], { repo: '/r/web', name: 'web' })] };
    const repos = mapRepos(two, jobs);
    const chips = mapChips(repos);
    expect(chips.map((c) => [c.label, c.count])).toEqual([['All', 3], ['Needs you', 1], ['Shipping', 1], ['app', 2], ['web', 1]]);
    expect(filterRepos(repos, 'needs-you').map((r) => [r.repo.name, r.lanes.map((l) => l.lane.slug)])).toEqual([['app', ['n']]]);
    expect(filterRepos(repos, 'repo:web').map((r) => r.repo.name)).toEqual(['web']);
    expect(filterRepos(repos, 'all')).toEqual(repos);
    expect(knownChip('repo:gone', chips)).toBe('all');
    expect(knownChip('shipping', chips)).toBe('shipping');
    expect(knownChip(null, chips)).toBe('all');
  });

  it('the ship track: five stops, three on a repo without staging; the finish-line flag on the stop the setting means', () => {
    expect(trackStops(repoOf([]))).toEqual(['local', 'fork', 'org', 'staging', 'main']);
    expect(trackStops(SIMPLE)).toEqual(['local', 'fork', 'main']);
    expect(finishStop('pr1-open')).toBe('org');
    expect(finishStop('pr1-merged')).toBe('org');
    expect(finishStop(undefined)).toBe('org'); // the default
    expect(finishStop('staging')).toBe('staging');
    expect(finishStop('main')).toBe('main');
    expect(finishStop('marked')).toBeNull();
    expect(finishStop('pr1-merged', SIMPLE)).toBe('main');
  });

  it('the words line: where, then the PR that matters with its number; the counts as a suffix', () => {
    const repo = repoOf([]);
    expect(whereLine(lane('a'), repo)).toBe('Only on your machine');
    expect(whereLine(lane('a', { position: 'fork', pr1: pr(141, 'open', { checks: 'failing' }) }), repo)).toBe('On your fork · PR #1 (#141) open, checks failing');
    expect(whereLine(lane('a', { position: 'org', pr1: pr(135, 'merged') }), repo)).toBe('On the moxie branch · PR #1 (#135) merged');
    expect(whereLine(lane('a', { position: 'org', pr1: pr(135, 'merged'), pr2: pr(136, 'open', { review: 'review_required' }) }), repo)).toBe('On the moxie branch · PR #2 (#136) open, review needed');
    // A new round: PR #1 open again after PR #2 merged: PR #1 is the one that matters.
    expect(whereLine(lane('a', { position: 'fork', pr1: pr(150, 'open'), pr2: pr(136, 'merged') }), repo)).toBe('On your fork · PR #1 (#150) open');
    expect(whereLine(lane('a', { position: 'fork', pr2: pr(7, 'draft') }), SIMPLE)).toBe('On your fork · PR (#7) draft');
    expect(whereLine(null)).toBe('');
    expect(prPhrase(pr(1, 'open', { checks: 'pending', review: 'approved' }))).toBe('open, checks running, approved');
    expect(countsSuffix(lane('a', { vsMain: { ahead: 3, behind: 0 }, unpushed: 2, dirty: 1 }))).toBe('main ↑3 ↓0 · 2 not pushed · 1 uncommitted');
    expect(countsSuffix(lane('a', { vsMain: null, unpushed: 0, dirty: null }))).toBe('');
    expect(newestPr(lane('a', { pr1: pr(1, 'merged'), pr2: pr(2, 'open') }), repo)?.number).toBe(2);
    expect(newestPr(null)).toBeNull();
  });

  it('the next hint: one plain sentence from the facts', () => {
    const repo = repoOf([]);
    const idle = job('a', 'idle');
    const cases: [FlowLane, Job | null, string][] = [
      [lane('a', { branch: null }), idle, 'No branch yet'],
      [lane('a', { dirty: 3 }), idle, 'Commit 3 changed files'],
      [lane('a', { vsMain: { ahead: 2, behind: 6 }, unpushed: 2 }), idle, 'Bring main in: it moved 6 commits'],
      [lane('a', { unpushed: 2 }), idle, 'Push 2 commits'],
      [lane('a', { unpushed: 1 }), idle, 'Push 1 commit'],
      [lane('a', { unpushed: null }), idle, 'Push the branch'],
      [lane('a', { vsMain: { ahead: 0, behind: 0 } }), idle, 'Nothing to push yet'],
      [lane('a', { position: 'fork', reached: 1, pushed: true, unpushed: 0 }), idle, 'Open PR #1'],
      [lane('a', { position: 'fork', reached: 1, pr1: pr(141, 'open', { checks: 'failing' }) }), idle, 'PR #1 checks failing'],
      [lane('a', { position: 'fork', reached: 1, pr1: pr(141, 'open', { checks: 'pending' }) }), idle, 'PR #1 checks running'],
      [lane('a', { position: 'fork', reached: 1, pr1: pr(141, 'open', { review: 'changes_requested' }) }), idle, 'PR #1: changes requested'],
      [lane('a', { position: 'fork', reached: 1, pr1: pr(141, 'draft') }), idle, 'PR #1 is a draft: mark it ready'],
      [lane('a', { position: 'fork', reached: 1, pr1: pr(141, 'open', { checks: 'passing' }) }), idle, 'Merge PR #1 on GitHub'],
      [lane('a', { position: 'org', reached: 2, pr1: pr(135, 'merged') }), idle, 'Open PR #2'],
      [lane('a', { position: 'org', reached: 2, pr1: pr(135, 'merged'), pr2: pr(136, 'open', { review: 'review_required', updatedAt: '2026-10-18T12:00:00Z' }) }), idle, 'Waiting for a review on PR #2 · 3d'],
      [lane('a', { position: 'org', reached: 2, pr1: pr(135, 'merged'), pr2: pr(136, 'open', { review: 'approved' }) }), idle, 'Merge PR #2 on GitHub'],
      [lane('a', { position: 'org', reached: 2, pr1: pr(135, 'merged'), pr2: pr(136, 'open', { checks: 'failing' }) }), idle, 'PR #2 checks failing'],
      [lane('a', { position: 'staging', reached: 3 }), idle, 'Nothing to do: waiting for the release'],
      [lane('a', { position: 'main', reached: 4 }), idle, 'Landed in main'],
      // The Foreman's ask comes before the track's.
      [lane('a', { unpushed: 2 }), job('a', 'needs-you', { waitingFor: 'approval', stage: 'plan' }), 'Give the go-ahead on Plan'],
      [lane('a'), job('a', 'needs-you', { waitingFor: 'answers' }), 'Answer the Foreman’s questions'],
      [lane('a'), job('a', 'needs-you', { permissions: 2 }), 'Allow or deny a permission'],
      [lane('a'), job('a', 'needs-you'), 'Reply to the Foreman'],
      [lane('a', { unpushed: 2 }), job('a', 'running'), 'Nothing to do: the Foreman is working'],
      [lane('a'), job('a', 'paused'), 'Paused by the usage limit'],
      [lane('a', { position: 'org', reached: 2 }), job('a', 'shipping', { finish: { reached: true, at: null, by: 'pr1-merged', landed: null } }), 'Open PR #2'],
      [lane('a', { position: 'main', reached: 4 }), job('a', 'done', { finish: { reached: true, at: null, by: 'pr1-merged', landed: 'main' } }), 'In main'],
      [lane('a'), job('a', 'done', { closed: { as: 'done' } }), 'Marked done'],
      [lane('a'), job('a', 'done', { closed: { as: 'dropped' } }), 'Dropped'],
      [lane('a'), null, 'Push the branch'],
    ];
    for (const [l, j, want] of cases) expect(nextHint(l, j, { repo, now: NOW }), want).toBe(want);
    expect(nextHint(lane('a', { position: 'staging', reached: 3 }), idle, { repo, release: pr(158, 'open'), now: NOW })).toBe('Waiting for the release · #158 open');
    expect(nextHint(lane('a', { position: 'fork', reached: 1, pushed: true, unpushed: 0 }), idle, { repo: SIMPLE, now: NOW })).toBe('Open the PR');
    expect(nextHint(lane('a', { position: 'fork', reached: 1, pr2: pr(9, 'open', { review: 'review_required' }) }), idle, { repo: SIMPLE, now: NOW })).toBe('Waiting for a review on the PR');
    expect(nextHint(lane('a', { position: 'fork', reached: 1, pr2: pr(9, 'open', { checks: 'failing' }) }), idle, { repo: SIMPLE, now: NOW })).toBe('The PR checks failing');
    expect(nextHint(null, null)).toBe('');
  });

  it('the repo header: the release train from what the map has', () => {
    const full = repoOf([], { release: pr(158, 'open'), main: { ref: 'moxie/main', tip: { sha: 'a', at: '2026-10-20T10:00:00Z', subject: 'Release (#139)' } }, staging: { ref: 'moxie/staging', tip: null, vsMain: { ahead: 14, behind: 0 } } });
    expect(releaseLineText(full)).toBe('staging: 14 commits waiting · release #158 open · last release 2026-10-20 (#139)');
    expect(releaseLineText(repoOf([], { staging: { ref: 'moxie/staging', tip: null, vsMain: { ahead: 1, behind: 0 } } }))).toBe('staging: 1 commit waiting');
    expect(releaseLineText(repoOf([], { staging: null, main: { ref: 'main', tip: { sha: 'a', at: '2026-10-20T10:00:00Z', subject: 'Fix a typo' } } }))).toBe('last release 2026-10-20');
    expect(releaseLineText(repoOf([], { staging: null, main: null }))).toBe('');
  });

  it('builds the table’s rows, filters, searches and sorts them', () => {
    const jobs: Job[] = [
      { ...job('b', 'needs-you'), title: 'Bravo', level: 2, stage: 'plan', updatedAt: '2026-10-21T10:00:00Z' },
      { ...job('a', 'running'), title: 'Alpha', level: 0, stage: 'implement', updatedAt: '2026-10-21T11:00:00Z' },
      { ...job('c', 'idle'), title: 'Charlie', level: null, updatedAt: '2026-10-20T11:00:00Z' },
      { ...job('d', 'shipping'), title: 'Delta', level: 1, stage: 'pr2', updatedAt: '2026-10-19T11:00:00Z', finish: { reached: true, at: null, by: 'pr1-merged', landed: null } },
    ];
    const rows = tableRows(jobs, flow([lane('a', { position: 'fork', reached: 1, pr1: pr(5, 'open'), vsMain: { ahead: 1, behind: 3 } }), lane('b')]));
    expect(rows.find((r) => r.slug === 'a')).toMatchObject({ repo: 'app', where: 'On your fork · PR #1 (#5) open', inReview: true, level: 0, stage: 'Build' });
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
