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
    expect(done.stops.filter((s) => !s.after).every((s) => s.state === 'done')).toBe(true);
    const dropped = trail(job('a', 'done', { level: 2, stage: 'plan', closed: { as: 'dropped', at: at(14, 0) } }));
    expect([dropped.lead, dropped.mood]).toEqual(['Dropped', 'idle']);
  });

  it('past the goal while the job carries on: the line follows the job, the Foreman at the goal, the quest done', () => {
    const t = trail(job('a', 'needs-you', { level: 3, stage: 'pr1', waitingFor: 'approval' }), true);
    expect([t.who, t.mood, t.ask, t.lead]).toEqual(['conductor', 'waiting', true, 'Your move']);
    expect(t.now).toBe('the Foreman is waiting for your go-ahead on PR #1.');
    expect(t.next).toBe('Then: The Foreman opens PR #2. The quest itself is already done.');
    const running = trail(job('a', 'running', { level: 3, stage: 'pr2' }), true);
    expect([running.lead, running.now, running.next]).toEqual(['Now', 'The Foreman is opening PR #2.', 'Next: Tester checks staging. The quest itself is already done.']);
    // Idle after the last stage: no made-up next stage.
    expect(trail(job('a', 'idle', { level: 3, stage: 'pr3' }), true).next).toBe('The quest itself is already done.');
    // A skipped stage after the goal is passed over.
    expect(trail(job('a', 'running', { level: 3, stage: 'pr2', skipped: ['staging-qa'] }), true).next).toBe('Next: The Foreman opens PR #3. The quest itself is already done.');
    // Marked done though the quest rule didn't count it: finished, without the quest's words.
    expect(trail(job('a', 'done', { level: 2, stage: 'plan', closed: { as: 'done', at: at(14, 0) } }), false).now).toBe('This job is finished.');
  });

  it('no level yet: only the stages it has been through, the one it is on and the PR stops, without stars', () => {
    const t = trail(job('a', 'running', { level: null, stage: 'spec' }));
    expect(t.stars).toBeNull();
    expect(t.difficulty).toBeNull();
    expect(t.stops.map((s) => s.id)).toEqual(['clarify', 'spec', 'pr1', 'pr2', 'staging-qa', 'pr3']);
  });

  it('each level draws only the stages it runs', () => {
    const ids = (level: 0 | 1 | 2 | 3) => trail(job('a', 'running', { level, stage: 'implement' })).stops.map((s) => s.id);
    expect(ids(0)).toEqual(['implement', 'pr1', 'pr2', 'staging-qa', 'pr3']);
    expect(ids(1)).toEqual(['plan', 'implement', 'test', 'review', 'pr1', 'pr2', 'staging-qa', 'pr3']);
    expect(ids(2)).not.toContain('refine');
    expect(ids(3)).toContain('refine');
  });

  it('the finish line moves the goal flag and the “quest’s goal” words; the stops after it are still drawn', () => {
    const open = (line: 'staging' | 'main' | 'marked') => jobTrail(job('a', 'needs-you', { level: 2, stage: 'pr1', waitingFor: 'approval', finish: { reached: false, at: null, by: null, landed: null } }), { levels: LEVELS, finishLine: line, now: NOW })!;
    expect(open('staging').stops.find((s) => s.goal)!.id).toBe('pr2');
    expect(open('staging').next).toBe('Then: The Foreman opens PR #2, the quest’s goal.');
    expect(open('main').next).toBe('Then: The Foreman opens PR #2.');
    expect(open('marked').stops.some((s) => s.goal)).toBe(false);
    // Crossed at PR #1 merged (the default): the Foreman stands at the flag; PR #2 is after the line.
    const crossed = jobTrail(job('a', 'idle', { level: 2, stage: 'pr1', finish: { reached: true, at: null, by: 'pr1-merged', landed: null } }), { levels: LEVELS, now: NOW })!;
    expect([crossed.finished, crossed.who, crossed.next]).toEqual([true, 'conductor', 'Next: The Foreman opens PR #2. The quest itself is already done.']);
    expect(crossed.stops.find((s) => s.id === 'pr2')!.after).toBe(true);
  });

  it('skips what the job’s own options skip, in the path and in what comes next', () => {
    const t = trail(job('a', 'needs-you', { level: 2, stage: 'implement', waitingFor: 'approval', skipped: ['test'] }));
    expect(t.stops.map((s) => s.id)).not.toContain('test');
    expect(t.next).toBe('Then: Head inspector and the reviewers look at the change.');
  });

  it('no level chosen: the path of the Foreman’s or the rules’ suggestion, and no stars', () => {
    const suggested = trail(job('a', 'needs-you', { level: null, suggestedLevel: 1, stage: 'plan', waitingFor: 'approval' }));
    expect(suggested.stops.map((s) => s.id)).toEqual(['plan', 'implement', 'test', 'review', 'pr1', 'pr2', 'staging-qa', 'pr3']);
    expect(suggested.next).toBe('Then: Builder builds it.');
    expect(suggested.stars).toBeNull();
    // Nothing suggested yet: no next stage named, since it may never run.
    expect(trail(job('a', 'needs-you', { level: null, stage: 'spec', waitingFor: 'approval' })).next).toBeNull();
  });

  it('a job starting up: the Foreman reads the request, then suggests a level', () => {
    const t = trail(job('a', 'running', { level: null, stage: 'spec', starting: true }));
    expect([t.who, t.mood, t.now, t.next]).toEqual(['conductor', 'thinking', 'The Foreman is reading your request.', 'Next: it suggests a level and writes its first brief.']);
  });

  it('your turn, and several permissions', () => {
    expect(trail(job('a', 'needs-you', { level: 2, stage: 'plan' })).now).toBe('the Foreman is waiting for your reply.');
    expect(trail(job('a', 'needs-you', { level: 2, stage: 'plan', permissions: 2 })).now).toBe('the Foreman wants your permission for a step. Allow or deny it below.');
  });

  it('on a floor card, points to where the ask is: above, or in the job', () => {
    const card = (extra: Parameters<typeof job>[2]) => jobTrail(job('a', 'needs-you', { level: 2, stage: 'plan', ...extra }), { levels: LEVELS, now: NOW, where: 'card' })!.now;
    expect(card({ waitingFor: 'answers' })).toBe('the Foreman asked you something. Open the job to answer it.');
    expect(card({ permissions: 1 })).toBe('the Foreman wants your permission for a step. Allow or deny it above, or open the job.');
  });

  it('paused with automatic carry-on off, or with a reply held for the reset: says what you do, and what runs then', () => {
    const paused = job('a', 'paused', { level: 1, stage: 'test', limitPaused: at(15, 42), limitAuto: false });
    expect(trail(paused).next).toBe('Then: press Carry on now once it resets (automatic carry-on is off), and Tester carries on running the checks.');
    const usage = { limited: true, blocking: true, autoResume: true, jobs: [{ slug: 'a', title: 'A', held: true }] };
    const held = jobTrail(job('a', 'paused', { level: 1, stage: 'test', limitPaused: at(15, 42) }), { levels: LEVELS, now: NOW, usage: usage as never })!;
    expect(held.next).toBe('Then: your held reply goes to the Foreman, and Head inspector and the reviewers look at the change.');
  });

  it('names each stage by who does it', () => {
    expect(stagePhrase('investigate')).toBe('Sleuth investigates the code');
    expect(stagePhrase('review')).toBe('Head inspector and the reviewers look at the change');
    expect(stagePhrase('mystery')).toBe('mystery');
  });
});
