// The trail's words and who stands on it, for every kind of job state. Invented jobs only.
import { describe, expect, it } from 'vitest';
import { job, LEVELS } from '../state/test-fixtures';
import { jobTrail, stagePhrase } from './trailModel';

const NOW = new Date(2026, 9, 16, 15, 0);
const at = (h: number, m: number) => new Date(2026, 9, 16, h, m).toISOString();
const trail = (j: Parameters<typeof jobTrail>[0], done?: boolean) => jobTrail(j, { levels: LEVELS, done, now: NOW })!;

describe('jobTrail', () => {
  it('running: whoever is at work stands on the current stage, and the line says what they do and who is next', () => {
    const t = trail(job('a', 'running', { level: 2, stage: 'implement' }));
    expect(t.who).toBe('feature-implementer');
    expect(t.mood).toBe('working');
    expect(t.ask).toBe(false);
    expect([t.lead, t.now, t.next]).toEqual(['Now', 'Builder is building.', 'Next: Tester runs the checks.']);
    expect(t.stars).toBe('★★★');
    // A worker the session logs name wins over the stage's own character.
    expect(trail(job('a', 'running', { level: 2, stage: 'review', nowDoing: [{ who: 'feature-review-errors' }] })).now).toBe('Fuse is reviewing the change.');
  });

  it('needs you: your move, in words for each kind of ask, a “!” and then what comes next', () => {
    const go = trail(job('a', 'needs-you', { level: 2, stage: 'plan', waitingFor: 'approval' }));
    expect([go.lead, go.now, go.next]).toEqual(['Your move', 'the Foreman is waiting for your go-ahead on Plan.', 'Then: Builder builds it.']);
    expect(go.ask).toBe(true);
    expect(go.mood).toBe('waiting');
    expect(go.who).toBe('feature-planner');
    expect(trail(job('a', 'needs-you', { level: 2, stage: 'plan', waitingFor: 'answers' })).now).toBe('the Foreman asked you something. Answer it below.');
    expect(trail(job('a', 'needs-you', { level: 2, stage: 'plan', permissions: 1 })).now).toBe('the Foreman wants your permission for a step. Allow or deny it below.');
    expect(trail(job('a', 'needs-you', { level: 2, stage: 'review' })).next).toBe('Then: The Foreman opens PR #1, the quest’s goal.');
  });

  it('paused by the usage limit: asleep, when they wake, and what they carry on with', () => {
    const t = trail(job('a', 'paused', { level: 1, stage: 'test', limitPaused: at(15, 42) }));
    expect(t.mood).toBe('asleep');
    expect([t.lead, t.now, t.next]).toEqual(['Paused', 'Claude’s usage limit stopped the crew (resumes 3:42pm).', 'Then: Tester carries on running the checks.']);
  });

  it('idle and stopped: nothing happening, and how to carry on', () => {
    expect(trail(job('a', 'idle', { level: 2, stage: 'plan' })).now).toBe('Nothing is happening right now. Write to the Foreman to carry on.');
    const stopped = trail(job('a', 'idle', { level: 2, stage: 'plan', stageState: 'paused' }));
    expect([stopped.lead, stopped.now]).toEqual(['Stopped', 'You stopped the last reply. Write to the Foreman to carry on.']);
  });

  it('done: the Foreman celebrates at the goal; dropped: no party', () => {
    const done = trail(job('a', 'done', { level: 2, stage: 'pr1' }), true);
    expect([done.who, done.mood, done.finished, done.next]).toEqual(['conductor', 'celebrating', true, null]);
    expect(done.stops.every((s) => s.state === 'done')).toBe(true);
    const dropped = trail(job('a', 'done', { level: 2, stage: 'plan', closed: { as: 'dropped', at: at(14, 0) } }));
    expect([dropped.lead, dropped.mood]).toEqual(['Dropped', 'idle']);
  });

  it('no level yet: the Standard stages, without difficulty stars', () => {
    const t = trail(job('a', 'running', { level: null, stage: 'spec' }));
    expect(t.stars).toBeNull();
    expect(t.difficulty).toBeNull();
    expect(t.stops.map((s) => s.id)).toEqual(['spec', 'investigate', 'plan', 'implement', 'test', 'review', 'pr1']);
  });

  it('names each stage by who does it', () => {
    expect(stagePhrase('investigate')).toBe('Sleuth investigates the code');
    expect(stagePhrase('review')).toBe('Head inspector and the reviewers look at the change');
    expect(stagePhrase('mystery')).toBe('mystery');
  });
});
