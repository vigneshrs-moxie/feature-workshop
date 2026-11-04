import { describe, it, expect } from 'vitest';
import { stopOf, stagesOf, stopStates } from './stops';

describe('stops for a bug job', () => {
  it('folds the bug stages into the stops: triage is Spec, reproduce is Investigate, diagnose is Plan', () => {
    expect(stopOf('triage')).toBe('spec');
    expect(stopOf('reproduce')).toBe('investigate');
    expect(stopOf('diagnose')).toBe('plan');
  });

  it('a stop is made of the stages this kind of job runs', () => {
    expect(stagesOf('investigate')).toEqual(['investigate', 'spec-update']);
    expect(stagesOf('investigate', 'bug')).toEqual(['reproduce']);
    expect(stagesOf('spec', 'bug')).toEqual(['triage']);
    expect(stagesOf('build', 'bug')).toEqual(['implement']);
  });

  it('a feature job’s skipped stops are not kept open by the bug stages, and the other way round', () => {
    const feature = stopStates({ stage: 'test', stageState: 'working', lane: 'working', needsYou: false, skipped: ['investigate', 'spec-update'], closed: null } as never);
    expect(feature.investigate).toBe('skipped');
    const bug = stopStates({ kind: 'bug', stage: 'implement', stageState: 'working', lane: 'working', needsYou: false, skipped: ['reproduce'], closed: null } as never);
    expect(bug.investigate).toBe('skipped');
    expect(bug.plan).toBe('done');
  });
});
