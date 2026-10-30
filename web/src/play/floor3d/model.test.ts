import { describe, expect, it } from 'vitest';
import type { Job, Permission } from '../../api/types';
import { askWords, benchFor, kindOf, labelFor, poseFor, QUIET_MS, stuckReason } from './model';

const NOW = new Date(2026, 9, 29, 12, 0, 0);
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString();
const job = (over: Partial<Job> = {}): Job => ({ slug: 'customer-merge', title: 'Customer merge', group: 'running', stage: 'implement', stageState: 'working', ...over });
const facts = (j: Job, more: { permissions?: Permission[]; usage?: never; run?: never } = {}) => ({ job: j, now: NOW, ...more });

describe('poseFor and labelFor: every row of the pose table', () => {
  it('reading files or searching: holds a sheet', () => {
    const f = facts(job());
    const a = { who: 'feature-implementer', doing: 'Reading merge.ts' };
    expect(poseFor(a, f)).toBe('reading');
    expect(labelFor(a, f)).toBe('Builder · reading merge.ts');
    expect(poseFor({ who: 'feature-investigator', doing: 'Searching the code for “merge”' }, f)).toBe('reading');
  });

  it('editing files: works at the bench', () => {
    const f = facts(job());
    const a = { who: 'feature-implementer', doing: 'Editing merge.ts' };
    expect(poseFor(a, f)).toBe('editing');
    expect(labelFor(a, f)).toBe('Builder · editing merge.ts');
    expect(poseFor({ who: 'feature-spec-writer', doing: 'Writing spec.md' }, f)).toBe('editing');
  });

  it('running a command or tests: turns the crank, with the count', () => {
    const f = facts(job({ stage: 'test' }));
    expect(poseFor({ who: 'feature-tester', doing: 'Running npm test · 212 of 577' }, f)).toBe('running');
    expect(labelFor({ who: 'feature-tester', doing: 'Running npm test · 212 of 577' }, f)).toBe('Tester · running npm test · 212 of 577');
    expect(labelFor({ who: 'feature-tester', doing: 'Running npm test', progress: { done: 212, total: 577 } }, f)).toBe('Tester · running npm test · 212 of 577');
    // A Bash step with a description is a command too.
    expect(poseFor({ who: 'feature-implementer', doing: 'Run the unit tests' }, f)).toBe('running');
  });

  it('waiting for you (a gate, a question): turns to you, hand up, with how long', () => {
    const f = facts(job({ group: 'needs-you', waitingFor: 'approval', waitingSince: ago(35) }));
    expect(poseFor({ who: 'conductor' }, f)).toBe('waiting');
    expect(labelFor({ who: 'conductor' }, f)).toBe('Foreman · waiting for your go-ahead · 35m');
    const q = facts(job({ group: 'needs-you', waitingFor: 'answers', waitingSince: ago(5) }));
    expect(labelFor({ who: 'conductor' }, q)).toBe('Foreman · waiting for your answer · 5m');
  });

  it('asking permission: holds up a card', () => {
    const j = job({ group: 'needs-you', waitingFor: 'permission', permissions: 1 });
    const p: Permission = { id: 'p1', slug: j.slug, kind: 'permission', toolName: 'Bash', agentType: 'feature-implementer' };
    const f = facts(j, { permissions: [p] });
    const a = { who: 'feature-implementer', doing: 'Run the linter' };
    expect(poseFor(a, f)).toBe('asking');
    expect(labelFor(a, f)).toBe('Builder · asks to run a command');
    // The Foreman watches, and says whom it waits on.
    expect(poseFor({ who: 'conductor' }, f)).toBe('watching');
    expect(labelFor({ who: 'conductor' }, f)).toBe('Foreman · waiting for you to answer the Builder');
    // Another job's permission is not this figure's.
    expect(poseFor(a, facts(j, { permissions: [{ ...p, slug: 'other' }] }))).toBe('running');
  });

  it('a step quiet for minutes reads as maybe asking in its terminal, in words that say maybe', () => {
    const f = facts(job());
    const a = { who: 'feature-implementer', doing: 'Run the database tests', quietMs: QUIET_MS + 23 * 60000 };
    expect(poseFor(a, f)).toBe('asking');
    expect(labelFor(a, f)).toBe('Builder · may need you in its terminal · quiet 28m');
  });

  it('stuck or failed: sits on a crate, with a "!" sign', () => {
    const j = job({ group: 'idle', stage: 'test', stageState: 'blocked', headline: 'Customer merge · 3 tests failed' });
    const f = facts(j);
    expect(stuckReason(j)).toBe('3 tests failed');
    const tester = { who: 'feature-tester', status: 'stopped' as const };
    expect(poseFor(tester, f)).toBe('stuck');
    expect(labelFor(tester, f)).toBe('Tester · stopped: 3 tests failed');
    expect(labelFor({ who: 'conductor' }, f)).toBe('Foreman · waiting with the Tester');
    // A failing PR check is the Foreman's.
    const pr = job({ group: 'idle', stage: 'pr1', stageState: 'blocked', laneReason: 'PR #1’s checks are failing' });
    expect(poseFor({ who: 'conductor' }, facts(pr))).toBe('stuck');
    expect(labelFor({ who: 'conductor' }, facts(pr))).toBe('Foreman · stopped: PR #1’s checks are failing');
    // The Foreman's reply ended with a problem.
    const err = facts(job({ group: 'idle' }), { run: { id: 'r', slug: 'customer-merge', status: 'error' } as never });
    expect(labelFor({ who: 'conductor' }, err)).toBe('Foreman · stopped: the last reply ended with a problem');
  });

  it('paused for the usage limit: sits, with a small clock', () => {
    const reset = new Date(2026, 9, 29, 16, 0, 0).toISOString();
    const f = facts(job({ group: 'paused', limitPaused: reset }));
    expect(poseFor({ who: 'conductor' }, f)).toBe('paused');
    expect(labelFor({ who: 'conductor' }, f)).toBe('Paused until the limit resets, 4:00pm');
    expect(labelFor({ who: 'feature-implementer', doing: 'Editing a.ts' }, f)).toBe('Builder · paused for the usage limit');
  });

  it('finished: tidies the bench, then rests', () => {
    const f = facts(job({ group: 'done', closed: { as: 'done' } as Job['closed'] }));
    expect(poseFor({ who: 'conductor' }, f)).toBe('done');
    expect(labelFor({ who: 'conductor' }, f)).toBe('Done');
    expect(labelFor({ who: 'conductor' }, facts(job({ group: 'done', closed: { as: 'dropped' } as Job['closed'] })))).toBe('Dropped');
  });

  it('the Foreman watches its crew, sends work, and rests past the finish line', () => {
    const f = facts(job());
    expect(poseFor({ who: 'conductor' }, f)).toBe('watching');
    expect(labelFor({ who: 'conductor' }, f, ['feature-implementer'])).toBe('Foreman · watching the Builder');
    expect(labelFor({ who: 'conductor' }, f, ['feature-reviewer', 'feature-review-db', 'feature-review-ui'])).toBe('Foreman · watching the Reviewer and 2 more');
    expect(labelFor({ who: 'conductor', doing: 'Sending work to feature-tester: Run checks' }, f)).toBe('Foreman · sending work to the Tester');
    expect(labelFor({ who: 'conductor' }, f)).toBe('Foreman · thinking');
    const ship = facts(job({ group: 'shipping', laneReason: 'In staging, on its way to main' }));
    expect(poseFor({ who: 'conductor' }, ship)).toBe('done');
    expect(labelFor({ who: 'conductor' }, ship)).toBe('Foreman · in staging, on its way to main');
    expect(labelFor({ who: 'conductor' }, facts(job({ group: 'idle' })))).toBe('Foreman · idle');
  });

  it('every label has words, and every one but Done, Dropped and the pause starts with its role', () => {
    const cases: Job[] = [job(), job({ group: 'needs-you', waitingFor: 'approval' }), job({ group: 'idle' }), job({ group: 'shipping' }), job({ group: 'paused' }), job({ group: 'done' })];
    for (const j of cases) for (const who of ['conductor', 'feature-tester']) {
      const l = labelFor({ who, doing: 'Reading a.ts' }, facts(j));
      expect(l.length).toBeGreaterThan(3);
      if (!/^(Done|Dropped|Paused until)/.test(l)) expect(l).toMatch(/^(Foreman|Tester) · /);
    }
  });
});

describe('helpers', () => {
  it('sorts steps into kinds', () => {
    expect(kindOf('Looking for files (*.ts)')).toBe('reading');
    expect(kindOf('Writing plan.md')).toBe('editing');
    expect(kindOf('Sending work to feature-tester')).toBe('sending');
    expect(kindOf('Using Skill')).toBe('running');
    expect(kindOf('')).toBeNull();
  });

  it('says what a permission asks in plain words', () => {
    expect(askWords({ toolName: 'Edit' })).toBe('edit a file');
    expect(askWords({ toolName: 'WebFetch' })).toBe('look something up on the web');
    expect(askWords({ toolName: 'mcp__x__y', displayName: 'Post to Slack' })).toBe('use Post to Slack');
  });
});

describe('benchFor', () => {
  it('puts the Foreman at the head and up to three helpers along the bench, counting the rest', () => {
    const j = job({ stage: 'review', nowDoing: [
      { who: 'conductor', doing: 'Sending work to feature-reviewer' },
      { who: 'feature-review-ui', doing: 'Reading a.ts' }, { who: 'feature-reviewer', doing: 'Reading b.ts' },
      { who: 'feature-review-db', doing: 'Reading c.ts' }, { who: 'feature-review-errors', doing: 'Reading d.ts' },
    ] });
    const b = benchFor(j, 3, { now: NOW });
    expect(b.index).toBe(3);
    expect(b.figures.map((f) => f.seat)).toEqual(['head', 0, 1, 2]);
    expect(b.figures[0]).toMatchObject({ who: 'conductor', prop: 'clipboard', role: 'Foreman' });
    expect(b.figures[1]).toMatchObject({ who: 'feature-reviewer', prop: 'magnifier' });
    expect(b.more).toBe(1);
    expect(b.status).toBe('Working');
    expect(new Set(b.figures.map((f) => f.key)).size).toBe(4);
  });

  it('gives a running figure its progress for the lamps', () => {
    const b = benchFor(job({ nowDoing: [{ who: 'feature-tester', doing: 'Running npm test · 100 of 400' }] }), 0, { now: NOW });
    expect(b.figures[1]).toMatchObject({ pose: 'running', prop: 'flask', progress: 0.25 });
  });

  it('sits a stuck stop’s crew member at the bench even when nobody is at work', () => {
    const b = benchFor(job({ group: 'idle', stage: 'test', stageState: 'blocked', headline: '3 tests failed' }), 0, { now: NOW });
    expect(b.figures.map((f) => [f.who, f.pose])).toEqual([['conductor', 'watching'], ['feature-tester', 'stuck']]);
  });

  it('brings a helper who asks for permission to the bench', () => {
    const j = job({ group: 'needs-you', waitingFor: 'permission', permissions: 1 });
    const b = benchFor(j, 0, { now: NOW, permissions: [{ id: 'p', slug: j.slug, kind: 'permission', toolName: 'Write', agentType: 'feature-planner' }] });
    expect(b.figures[1]).toMatchObject({ who: 'feature-planner', pose: 'asking', label: 'Planner · asks to write a file', prop: 'ruler' });
  });

  it('clears the helpers from a finished job', () => {
    const b = benchFor(job({ group: 'done', nowDoing: [{ who: 'feature-tester', doing: 'x' }] }), 0, { now: NOW });
    expect(b.figures).toHaveLength(1);
    expect(b.figures[0].label).toBe('Done');
  });
});
