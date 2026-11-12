// Which step the job page opens: your pick, then the address's step, then the step the job is at
// while it works or waits, then the one you last opened on this job, then the job's own step.
import { describe, expect, it } from 'vitest';
import { lastStepKey, pickOpenStep } from './openStep';

describe('the open step', () => {
  it('your pick wins, then the address’s step, then the step the job is at, then the one you last opened', () => {
    const all = { picked: 'spec', address: 'plan', live: 'build', last: 'test', current: 'review' } as const;
    expect(pickOpenStep(all)).toBe('spec');
    expect(pickOpenStep({ ...all, picked: null })).toBe('plan');
    expect(pickOpenStep({ ...all, picked: null, address: null })).toBe('build');
    expect(pickOpenStep({ ...all, picked: null, address: null, live: null })).toBe('test');
    expect(pickOpenStep({ ...all, picked: null, address: null, live: null, last: null })).toBe('review');
    // Nothing known: Spec.
    expect(pickOpenStep({ picked: null, address: null, live: null, last: null, current: null })).toBe('spec');
    expect(pickOpenStep({})).toBe('spec');
    // A value that is not a step (an old stored word, a mistyped address) counts as not set.
    expect(pickOpenStep({ picked: null, address: 'nowhere' as never, live: null, last: 'Build' as never, current: 'ship' })).toBe('ship');
  });

  it('remembers the last step per job', () => {
    expect(lastStepKey('pause-a-service')).toBe('sb.job.step.pause-a-service');
  });
});
