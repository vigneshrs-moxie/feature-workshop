// The words for a step's state and its time on the job page (design 3.2): Done, Working now,
// Waiting for you, Not yet, Skipped, Approved after your Go, In review with a pull request open;
// how long it took, "so far" on the current one, "for" how long it has waited. Invented jobs only.
import { describe, expect, it } from 'vitest';
import type { Job } from '../api/types';
import { job } from '../state/test-fixtures';
import { spentWords, stepState, stepTimeWords } from './stepWords';

const NOW = new Date('2026-11-10T12:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

const building: Job = job('pause-a-service', 'running', { stage: 'implement', lane: 'working', working: true });
const waitingAtPlan: Job = job('pause-a-service', 'needs-you', { stage: 'plan', lane: 'needs-you', needsYou: true, waitingFor: 'approval', waitingSince: ago(65) });
const shipping: Job = job('pause-a-service', 'shipping', { stage: 'pr1', lane: 'in-review', laneReason: 'PR #1 is open, waiting on a review' });

describe('spentWords', () => {
  it.each([
    [59_000, 'under a minute'],
    [32 * 60_000, '32 min'],
    [70 * 60_000, '1 h 10 min'],
    [51 * 3_600_000, '2 d 3 h'],
  ])('%i ms reads %s', (ms, words) => {
    expect(spentWords(ms)).toBe(words);
  });

  it('whole hours and whole days have no zero part', () => {
    expect(spentWords(2 * 3_600_000)).toBe('2 h');
    expect(spentWords(48 * 3_600_000)).toBe('2 d');
  });
});

describe('stepTimeWords', () => {
  it('the current step says so far, a waiting one says for how long, a done one how long it took', () => {
    expect(stepTimeWords(building, 'build', { startedAt: ago(32), endedAt: null }, NOW)).toBe('32 min so far');
    expect(stepTimeWords(building, 'plan', { startedAt: ago(150), endedAt: ago(80) }, NOW)).toBe('1 h 10 min');
    expect(stepTimeWords(waitingAtPlan, 'plan', { startedAt: ago(200), endedAt: ago(65) }, NOW)).toBe('for 1 h 5 min');
    // Waiting with no waitingSince known: how long the step has run.
    expect(stepTimeWords({ ...waitingAtPlan, waitingSince: null }, 'plan', { startedAt: ago(70), endedAt: null }, NOW)).toBe('1 h 10 min so far');
    // A pull request open at Ship.
    expect(stepTimeWords(shipping, 'ship', { startedAt: ago(30), endedAt: null }, NOW)).toBe('PR #1 open');
    expect(stepTimeWords({ ...shipping, laneReason: 'PR #2’s checks are running' }, 'ship', null, NOW)).toBe('PR #2 open');
    // A step not reached says nothing.
    expect(stepTimeWords(building, 'test', { startedAt: null, endedAt: null }, NOW)).toBeNull();
    expect(stepTimeWords(building, 'test', undefined, NOW)).toBeNull();
  });

  it('never a negative or a broken time, and never so far on a step with an end', () => {
    // An end with no start (a brief that arrived out of order): nothing.
    expect(stepTimeWords(building, 'plan', { startedAt: null, endedAt: ago(80) }, NOW)).toBeNull();
    // An end before its start: nothing.
    expect(stepTimeWords(building, 'plan', { startedAt: ago(10), endedAt: ago(80) }, NOW)).toBeNull();
    // The current step with an end: how long it took, not so far.
    expect(stepTimeWords(building, 'build', { startedAt: ago(40), endedAt: ago(5) }, NOW)).toBe('35 min');
    // A start in the future, or a time that isn't one: nothing.
    expect(stepTimeWords(building, 'build', { startedAt: ago(-10), endedAt: null }, NOW)).toBeNull();
    expect(stepTimeWords(building, 'build', { startedAt: 'not a time', endedAt: null }, NOW)).toBeNull();
    expect(stepTimeWords(building, 'plan', { startedAt: 'not a time', endedAt: 'nor this' }, NOW)).toBeNull();
    // A done step with a start and no end: nothing (it isn't running).
    expect(stepTimeWords(building, 'plan', { startedAt: ago(90), endedAt: null }, NOW)).toBeNull();
    // A waiting time in the future: how long the step has run instead.
    expect(stepTimeWords({ ...waitingAtPlan, waitingSince: ago(-5) }, 'plan', { startedAt: ago(20), endedAt: null }, NOW)).toBe('20 min so far');
  });

  it('a step with no time falls back to since, and with neither says nothing', () => {
    expect(stepTimeWords(building, 'build', undefined, NOW, ago(12))).toBe('12 min so far');
    expect(stepTimeWords(building, 'build', { startedAt: null, endedAt: null }, NOW, ago(12))).toBe('12 min so far');
    // An end with no start: since is its start.
    expect(stepTimeWords(building, 'plan', { startedAt: null, endedAt: ago(80) }, NOW, ago(150))).toBe('1 h 10 min');
    // The time's own start wins over since.
    expect(stepTimeWords(building, 'build', { startedAt: ago(32), endedAt: null }, NOW, ago(12))).toBe('32 min so far');
    expect(stepTimeWords(building, 'build', undefined, NOW, null)).toBeNull();
    expect(stepTimeWords(building, 'build', null, NOW)).toBeNull();
    expect(stepTimeWords(building, 'build', undefined, NOW, 'not a time')).toBeNull();
  });
});

describe('stepState', () => {
  it('each state in words, with its class', () => {
    const skipping: Job = { ...building, skipped: ['investigate', 'spec-update'] };
    expect(stepState(skipping, 'spec', null)).toEqual({ cls: 'is-done', words: 'Done' });
    expect(stepState(skipping, 'investigate', null)).toEqual({ cls: 'is-skipped', words: 'Skipped' });
    expect(stepState(skipping, 'build', null)).toEqual({ cls: 'is-now', words: 'Working now' });
    expect(stepState(skipping, 'test', null)).toEqual({ cls: '', words: 'Not yet' });
    expect(stepState(waitingAtPlan, 'plan', null)).toEqual({ cls: 'is-wait', words: 'Waiting for you' });
    expect(stepState(shipping, 'ship', null)).toEqual({ cls: 'is-now', words: 'In review' });
    expect(stepState(shipping, 'review', null)).toEqual({ cls: 'is-done', words: 'Done' });
    // Changes asked for on the pull request: it waits for you, not in review.
    expect(stepState({ ...shipping, lane: 'needs-you', needsYou: true, laneReason: 'Changes were asked for on PR #1' }, 'ship', null)).toEqual({ cls: 'is-wait', words: 'Waiting for you' });
  });

  it('the job stopped and waiting for your next message: its step reads Stopped, timed as a working step', () => {
    // As the job's row says Stopped (panes/Jobs/jobStatus.ts): idle, its last reply stopped.
    const stopped: Job = job('pause-a-service', 'idle', { stage: 'implement', stageState: 'paused', paused: true, lane: 'resting', laneReason: 'Stopped; waits for your next message' });
    expect(stepState(stopped, 'build', null)).toEqual({ cls: 'is-stop', words: 'Stopped' });
    expect(stepState(stopped, 'plan', null)).toEqual({ cls: 'is-done', words: 'Done' });
    expect(stepState(stopped, 'test', null)).toEqual({ cls: '', words: 'Not yet' });
    expect(stepTimeWords(stopped, 'build', { startedAt: ago(32), endedAt: null }, NOW)).toBe('32 min so far');
    // Idle with nothing stopped, or held by the usage limit: not Stopped.
    expect(stepState({ ...stopped, stageState: 'idle' }, 'build', null)).toEqual({ cls: 'is-now', words: 'Working now' });
    expect(stepState({ ...stopped, group: 'paused' }, 'build', null)).toEqual({ cls: 'is-now', words: 'Working now' });
  });

  it('an approved step says how long it took, never for how long it waited', () => {
    const go = { kind: 'approve' as const };
    expect(stepTimeWords(waitingAtPlan, 'plan', { startedAt: ago(200), endedAt: ago(65) }, NOW, null, go)).toBe('2 h 15 min');
    // No end: up to when it began to wait.
    expect(stepTimeWords(waitingAtPlan, 'plan', { startedAt: ago(200), endedAt: null }, NOW, null, go)).toBe('2 h 15 min');
    // Nothing usable: nothing, not "for …".
    expect(stepTimeWords({ ...waitingAtPlan, waitingSince: null }, 'plan', { startedAt: ago(200), endedAt: null }, NOW, null, go)).toBeNull();
    expect(stepTimeWords(waitingAtPlan, 'plan', undefined, NOW, null, go)).toBeNull();
    // After Send back it still waits: for how long.
    expect(stepTimeWords(waitingAtPlan, 'plan', { startedAt: ago(200), endedAt: ago(65) }, NOW, null, { kind: 'changes' })).toBe('for 1 h 5 min');
  });

  it('after your go the step reads Approved until the job moves', () => {
    const go = { kind: 'approve' as const };
    expect(stepState(waitingAtPlan, 'plan', go)).toEqual({ cls: 'is-done', words: 'Approved' });
    // Only the job's own step.
    expect(stepState(waitingAtPlan, 'spec', go)).toEqual({ cls: 'is-done', words: 'Done' });
    expect(stepState(waitingAtPlan, 'build', go)).toEqual({ cls: '', words: 'Not yet' });
    // The job moved on (the bar's sent line is gone): Plan is done, Build works.
    const moved: Job = { ...building };
    expect(stepState(moved, 'plan', null)).toEqual({ cls: 'is-done', words: 'Done' });
    expect(stepState(moved, 'build', null)).toEqual({ cls: 'is-now', words: 'Working now' });
  });

  it('after Send back the step does not read Approved', () => {
    expect(stepState(waitingAtPlan, 'plan', { kind: 'changes' })).toEqual({ cls: 'is-wait', words: 'Waiting for you' });
    // Nor after Reply, a send of a kind not known, or none.
    expect(stepState(waitingAtPlan, 'plan', { kind: 'message' })).toEqual({ cls: 'is-wait', words: 'Waiting for you' });
    expect(stepState(waitingAtPlan, 'plan', { kind: null })).toEqual({ cls: 'is-wait', words: 'Waiting for you' });
    expect(stepState(waitingAtPlan, 'plan', null)).toEqual({ cls: 'is-wait', words: 'Waiting for you' });
  });
});
