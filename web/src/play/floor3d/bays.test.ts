// The station's bays (packet SB): a job's kind picks the bay, its stage how far the work has got,
// and every phase has its words.
import { describe, expect, it } from 'vitest';
import type { Job, StackSummary } from '../../api/types';
import { assignBenches } from './benches';
import { floorBenches, partSlugs } from './useFloorBenches';
import { ALERT_WORDS, alertFor, BAY_ALERTS, BAY_ICON, bayKind, KIND_WORDS, PHASE_WORDS, PHASES, phaseFor, PLATES_ON, SECTION_WORDS, sectionState, signFor } from './bays';
import { benchFor, sectionX, stackBench } from './model';

const job = (over: Partial<Job> = {}): Job => ({ slug: 'invoice-export', title: 'Invoice export', group: 'running', stage: 'implement', stageState: 'working', ...over });

describe('the bay kind', () => {
  it('makes a bug fix a repair dock, and a feature (or anything else) a construction bay', () => {
    expect(bayKind({ kind: 'bug' })).toBe('repair');
    expect(bayKind({ kind: 'Bug' })).toBe('repair');
    expect(bayKind({ kind: 'feature' })).toBe('build');
    expect(bayKind({})).toBe('build');
    expect(KIND_WORDS).toEqual({ build: 'Feature', repair: 'Bug fix' });
    // Each has its own icon: a plus in a hexagon, a wrench.
    expect(BAY_ICON.build).not.toBe(BAY_ICON.repair);
  });

  it('signs each bay in words: "Building · Invoice export", "Repairing · Footer typo"', () => {
    expect(signFor('build', 'plates', 'Invoice export')).toBe('Building · Invoice export');
    expect(signFor('repair', 'frame', 'Footer typo')).toBe('Repairing · Footer typo');
    expect(signFor('build', 'launched', 'Invoice export')).toBe('Launched · Invoice export');
    expect(signFor('repair', 'launched', 'Footer typo')).toBe('Repaired · Footer typo');
  });
});

describe('the build progress', () => {
  it('follows the stage: frame, plates, lights, sealed, launched', () => {
    for (const stage of ['spec', 'refine', 'investigate', 'plan', 'clarify']) expect(phaseFor(job({ stage })), stage).toBe('frame');
    expect(phaseFor(job({ stage: 'implement' }))).toBe('plates');
    expect(phaseFor(job({ stage: 'test' }))).toBe('lights');
    for (const stage of ['review', 'pr1', 'pr2', 'staging-qa', 'pr3']) expect(phaseFor(job({ stage })), stage).toBe('sealed');
    expect(phaseFor(job({ group: 'done', stage: 'pr3' }))).toBe('launched');
    expect(phaseFor(job({ stage: 'pr1', finish: { reached: true, at: null, by: 'pr1-merged', landed: null } }))).toBe('launched');
  });

  it('puts the hull on section by section, and says every phase in words for both kinds', () => {
    expect(PHASES.map((p) => PLATES_ON[p])).toEqual([0, 2, 4, 4, 4]);
    for (const p of PHASES) {
      expect(PHASE_WORDS.build[p]).toMatch(/\w/);
      expect(PHASE_WORDS.repair[p]).toMatch(/\w/);
    }
    expect(PHASE_WORDS.build.plates).toBe('hull plates going on');
    expect(PHASE_WORDS.repair.plates).toBe('repair under way');
  });

  it('gives each bench its kind, phase, sign and words from the job', () => {
    const b = benchFor(job({ kind: 'bug', title: 'Footer typo', stage: 'test' }), 0, {});
    expect(b).toMatchObject({ kind: 'repair', phase: 'lights', sign: 'Repairing · Footer typo', phaseWords: 'testing the repair' });
    const f = benchFor(job(), 1, {});
    expect(f).toMatchObject({ kind: 'build', phase: 'plates', sign: 'Building · Invoice export', phaseWords: 'hull plates going on' });
  });
});

describe('the bay’s state, always in words', () => {
  it('says every state: needs you, asks permission, stopped, paused for the usage limit, done', () => {
    for (const a of BAY_ALERTS) expect(ALERT_WORDS[a]).toMatch(/^[A-Z][a-z]/);
    expect(ALERT_WORDS).toEqual({ 'needs-you': 'Needs you', asking: 'Asks permission', stuck: 'Stopped', paused: 'Paused for the usage limit', done: 'Done' });
  });

  it('works the state out from the status and the crew: done, paused, stuck, asking, needs you, else none', () => {
    expect(alertFor('done', ['done'])).toBe('done');
    expect(alertFor('paused', ['paused'])).toBe('paused');
    expect(alertFor('running', ['watching', 'paused'])).toBe('paused');
    expect(alertFor('idle', ['watching', 'stuck'])).toBe('stuck');
    expect(alertFor('needs-you', ['watching', 'asking'])).toBe('asking');
    expect(alertFor('needs-you', ['waiting'])).toBe('needs-you');
    expect(alertFor('running', ['watching', 'editing'])).toBeNull();
  });

  it('gives a stopped job a stopped bay, and a waiting one a beacon', () => {
    expect(benchFor(job({ group: 'idle', stage: 'test', stageState: 'blocked', laneReason: '3 tests failed' }), 0, {}).alert).toBe('stuck');
    expect(benchFor(job({ group: 'needs-you', waitingFor: 'approval' }), 0, {}).alert).toBe('needs-you');
    expect(benchFor(job({ group: 'done', stage: 'pr3' }), 0, {}).alert).toBe('done');
  });
});

describe('a stack', () => {
  const parts = [
    { n: 2, name: 'tax-rules', slug: 's--tax-rules', state: 'running' },
    { n: 1, name: 'invoice-model', slug: 's--invoice-model', state: 'integrated' },
    { n: 3, name: 'refunds', slug: 's--refunds', state: 'failed' },
    { n: 4, name: 'reports', slug: null, state: 'pending' },
    { n: 5, name: 'csv', slug: 's--csv', state: 'ready' },
  ];
  const partJob = job({ slug: 's--tax-rules', title: 'Billing · tax-rules', nowDoing: [{ who: 'feature-implementer', doing: 'Editing tax.ts' }] });

  it('is one larger module: a section per part in merge order, each in its state with its words', () => {
    const b = stackBench(job({ slug: 's', title: 'Billing' }), 0, parts, new Map([[partJob.slug, partJob]]), {});
    expect(b.kind).toBe('build');
    expect(b.sections?.map((x) => [x.n, x.state])).toEqual([[1, 'joined'], [2, 'working'], [3, 'stuck'], [4, 'waiting'], [5, 'built']]);
    expect(b.sections?.[1].words).toBe('Part 2 · tax-rules · at work');
    expect(b.phaseWords).toBe('Stack · 1 of 5 joined · 1 at work · 1 built · 1 stuck');
    for (const s of ['integrated', 'ready', 'running', 'blocked', 'failed', 'pending']) expect(SECTION_WORDS[sectionState(s)]).toMatch(/\w/);
  });

  it('brings each part at work a small crew of its own, standing at its section', () => {
    const b = stackBench(job({ slug: 's', title: 'Billing' }), 0, parts, new Map([[partJob.slug, partJob]]), {});
    expect(b.figures[0].who).toBe('conductor');
    const crew = b.figures.slice(1);
    expect(crew).toHaveLength(1);
    expect(crew[0]).toMatchObject({ who: 'feature-implementer', small: true, at: sectionX(2, 5), label: 'Builder · editing tax.ts · part 2' });
  });
});

describe('the station’s bays from live jobs', () => {
  it('gives a stack one bay, its parts none of their own', () => {
    const stack = { slug: 's', title: 'Billing', ticketKey: null, phase: 'build', steps: [], parts: 2, counts: {}, needs: '', action: 'wait', sections: [{ n: 1, name: 'a', slug: 's--a', state: 'integrated', stateWords: '' }, { n: 2, name: 'b', slug: 's--b', state: 'running', stateWords: '' }] } as unknown as StackSummary;
    const jobs = [job({ slug: 's', title: 'Billing' }), job({ slug: 's--a', title: 'Billing · a' }), job({ slug: 's--b', title: 'Billing · b' }), job({ slug: 'fix', title: 'Footer typo', kind: 'bug' })];
    const parts = partSlugs([stack]);
    expect([...parts]).toEqual(['s--a', 's--b']);
    const memory = assignBenches(null, jobs.filter((j) => !parts.has(j.slug)), 'v');
    const bays = floorBenches(jobs, memory, { now: new Date(), stacks: [stack] });
    expect(bays.map((b) => [b.slug, b.kind, b.sections?.length ?? 0])).toEqual([['s', 'build', 2], ['fix', 'repair', 0]]);
  });
});
