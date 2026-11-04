// "Ask Fable" on the gate card: the point it adds for the next stage, in a feature job's words or a
// bug job's (whose plan look is at the diagnosis; the /bugfix conductor).
import { describe, expect, it } from 'vitest';
import { chipViews, fablePoint } from './gateCard';

const fable = (nextStage: string, opts: Parameters<typeof chipViews>[1] = {}) => chipViews({ nextStage }, opts).find((v) => v.id === 'fable')!;

describe('Ask Fable', () => {
  it('a feature job: the plan, in a feature’s words', () => {
    expect(fable('plan').name).toBe('Ask Fable (the plan)');
    expect(fable('review').name).toBe('Ask Fable (the review)');
  });

  it('a bug job: the stages before the fix lead to the diagnosis look', () => {
    expect(['triage', 'reproduce', 'diagnose'].map(fablePoint)).toEqual(['plan', 'plan', 'plan']);
    const v = fable('diagnose', { kind: 'bug' });
    expect(v.name).toBe('Ask Fable (the diagnosis)');
    expect(v.chip).toEqual({ kind: 'fable', point: 'plan' });
    expect(fable('diagnose', { kind: 'bug', fableChecks: ['plan'] }).hint).toBe('Fable already looks at the diagnosis for this job.');
  });
});
