// The station's bays (packet SB): a job's kind picks the bay, its stage how far the work has got,
// and every phase has its words.
import { describe, expect, it } from 'vitest';
import type { Job } from '../../api/types';
import { BAY_ICON, bayKind, KIND_WORDS, PHASE_WORDS, PHASES, phaseFor, PLATES_ON, signFor } from './bays';
import { benchFor } from './model';

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
