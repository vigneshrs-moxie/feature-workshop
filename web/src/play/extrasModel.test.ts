// The Full-mode extras' pure parts: the quest track, the boss fight and stamina. Invented jobs only.
import { describe, expect, it } from 'vitest';
import type { LevelInfo, ReviewBoss, Usage } from '../api/types';
import { job } from '../state/test-fixtures';
import { backAt, bossView, difficultyStars, findingsText, questTrack, staminaOf } from './extrasModel';

const LEVELS = [
  { level: 0, label: 'L0 Tweak', skip: ['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'spec-update', 'plan', 'test', 'review'] },
  { level: 1, label: 'L1 Small', skip: ['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'spec-update'] },
  { level: 2, label: 'L2 Standard', skip: ['refine'] },
  { level: 3, label: 'L3 Large', skip: [] },
] as unknown as LevelInfo[];

const states = (t: ReturnType<typeof questTrack>) => t!.stops.map((s) => `${s.label}:${s.state}`);
/** The stops up to and including PR #1 (the shipping stops after it are the same for every level). */
const toPr1 = (t: ReturnType<typeof questTrack>) => states(t).slice(0, t!.stops.findIndex((s) => s.id === 'pr1') + 1);
const SHIPPING = ['PR #2:next', 'Staging QA:next', 'PR #3:next'];

describe('quest track', () => {
  it('shows the level as difficulty, L0 ★ to L3 ★★★★', () => {
    expect([0, 1, 2, 3].map((l) => difficultyStars(l as 0))).toEqual(['★', '★★', '★★★', '★★★★']);
    expect(questTrack(job('a', 'running', { level: 2, stage: 'plan' }), LEVELS)!.difficulty).toBe('Difficulty: L2 Standard');
    expect(questTrack(job('a', 'running', { level: null }), LEVELS)).toBeNull();
  });

  it('runs the stages this level runs, skipped ones hidden, the current stage’s crew member on it', () => {
    const l2 = questTrack(job('a', 'running', { level: 2, stage: 'implement' }), LEVELS)!;
    expect(states(l2)).toEqual(['Clarify:done', 'Spec:done', 'Screens:done', 'Investigate:done', 'Plan:done', 'Build:current', 'Test:next', 'Review:next', 'PR #1:next', ...SHIPPING]);
    expect(l2.who).toBe('feature-implementer');
    expect(l2.finished).toBe(false);
    const l0 = questTrack(job('a', 'running', { level: 0, stage: 'implement' }), LEVELS)!;
    expect(toPr1(l0)).toEqual(['Build:current', 'PR #1:next']);
    const l3 = questTrack(job('a', 'running', { level: 3, stage: 'review' }), LEVELS)!;
    expect(l3.stops.map((s) => s.id)).toEqual(['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'plan', 'implement', 'test', 'review', 'pr1', 'pr2', 'staging-qa', 'pr3']);
    expect(l3.who).toBe('feature-reviewer');
    // Without meta.levels the dashboard's defaults apply.
    expect(toPr1(questTrack(job('a', 'running', { level: 1, stage: 'test' }))!)).toEqual(['Plan:done', 'Build:done', 'Test:current', 'Review:next', 'PR #1:next']);
    // The job's own skipped shipping stages are left out too.
    expect(questTrack(job('a', 'running', { level: 1, stage: 'test', skipped: ['staging-qa'] }))!.stops.map((s) => s.id)).not.toContain('staging-qa');
  });

  it('shows Spec update, or a stage this level would skip, only while it is the stage', () => {
    expect(questTrack(job('a', 'running', { level: 3, stage: 'spec-update' }), LEVELS)!.stops.find((s) => s.state === 'current')!.id).toBe('spec-update');
    expect(questTrack(job('a', 'running', { level: 2, stage: 'refine' }), LEVELS)!.stops.map((s) => s.id)).toContain('refine');
  });

  it('is finished past PR #1 or once the job is done; the goal flag sits on PR #1 by default', () => {
    // Past the goal while the work goes on: the stops up to the flag passed, the Foreman on PR #2 (after the line).
    const past = questTrack(job('a', 'running', { level: 2, stage: 'pr2' }), LEVELS)!;
    expect(past.finished).toBe(true);
    expect(past.goal).toBe('pr1');
    expect(states(past).slice(-4)).toEqual(['PR #1:done', 'PR #2:current', 'Staging QA:next', 'PR #3:next']);
    expect(past.stops.map((s) => s.goal)).toEqual([false, false, false, false, false, false, false, false, true, false, false, false]);
    expect(past.stops.filter((s) => s.after).map((s) => s.id)).toEqual(['pr2', 'staging-qa', 'pr3']);
    expect(past.stops.find((s) => s.here)!.id).toBe('pr2');
    expect(past.who).toBe('conductor');
    expect(questTrack(job('a', 'done', { level: 1, stage: 'review' }), LEVELS)!.finished).toBe(true);
    // No stage yet: nobody stands anywhere.
    expect(questTrack(job('a', 'idle', { level: 2 }), LEVELS)!.who).toBeNull();
  });
  it('takes finished from the card’s finish line first, then the ledger', () => {
    // PR #1 merged (the default line) while the stage is still PR #1: done, the Foreman at the flag.
    const atGoal = questTrack(job('a', 'running', { level: 2, stage: 'pr1', finish: { reached: true, at: null, by: 'pr1-merged', landed: null } }), LEVELS)!;
    expect(atGoal.finished).toBe(true);
    expect(atGoal.stops.filter((s) => !s.after).every((s) => s.state === 'done')).toBe(true);
    expect(atGoal.stops.find((s) => s.here)!.id).toBe('pr1');
    expect(atGoal.who).toBe('conductor');
    // The ledger says done, with no finish on the card (an older dashboard).
    expect(questTrack(job('a', 'running', { level: 2, stage: 'pr1' }), LEVELS, true)!.finished).toBe(true);
    // Not crossed yet (the line is PR #1 merged, the PR is open): standing at the goal, waiting.
    const waiting = questTrack(job('a', 'running', { level: 2, stage: 'pr1', finish: { reached: false, at: null, by: null, landed: null } }), LEVELS, true)!;
    expect(waiting.finished).toBe(false);
    expect(states(waiting).slice(-5)).toEqual(['Review:done', 'PR #1:current', ...SHIPPING]);
    expect(waiting.who).toBe('conductor');
  });
  it('puts the goal flag on the stop the finish line names, and none for “when I mark it done”', () => {
    const at = (line: Parameters<typeof questTrack>[3]) => questTrack(job('a', 'running', { level: 2, stage: 'pr2' }), LEVELS, undefined, line)!;
    expect(at('pr1-open').goal).toBe('pr1');
    expect(at('pr1-merged').goal).toBe('pr1');
    expect(at('staging').goal).toBe('pr2');
    expect(at('main').goal).toBe('pr3');
    expect(at('marked').goal).toBeNull();
    // In staging: PR #2 is the goal, PR #2 open is the current stop, nothing after the line yet.
    const staging = questTrack(job('a', 'running', { level: 2, stage: 'pr2', finish: { reached: false, at: null, by: null, landed: null } }), LEVELS, undefined, 'staging')!;
    expect(staging.finished).toBe(false);
    expect(staging.stops.find((s) => s.goal)!.state).toBe('current');
    expect(staging.stops.filter((s) => s.after).map((s) => s.id)).toEqual(['staging-qa', 'pr3']);
    // In main: every stop is before the line.
    expect(at('main').stops.some((s) => s.after)).toBe(false);
    // Marked done at Plan: no flag, the crew stand where the work is, the stops before passed.
    const marked = questTrack(job('a', 'done', { level: 2, stage: 'plan', closed: { as: 'done' }, finish: { reached: true, at: '2026-10-21T12:00:00Z', by: 'marked', landed: null } }), LEVELS, undefined, 'marked')!;
    expect(marked.finished).toBe(true);
    expect(marked.stops.some((s) => s.goal || s.after)).toBe(false);
    expect(states(marked).slice(0, 6)).toEqual(['Clarify:done', 'Spec:done', 'Screens:done', 'Investigate:done', 'Plan:current', 'Build:next']);
    expect(marked.stops.find((s) => s.here)!.id).toBe('plan');
  });
});

describe('boss fight', () => {
  const r = (extra: Partial<ReviewBoss>): ReviewBoss => ({ at: '2026-10-16T10:00:00.000Z', blockers: 0, majors: 0, minors: 0, hp: 0, startHp: 0, defeatedAt: null, ...extra });
  it('says the hit points left of where it started, and the findings left', () => {
    expect(bossView(r({ blockers: 1, majors: 1, hp: 8, startHp: 12 }))).toEqual({ start: 12, left: 8, share: 8 / 12, defeated: false, text: 'Boss: 8 of 12 hit points left · 1 blocker, 1 major' });
    expect(bossView(r({ majors: 2, minors: 3, hp: 9, startHp: 9 }))!.text).toBe('Boss: 9 of 9 hit points left · 2 majors, 3 minors');
    expect(findingsText({ blockers: 0, majors: 0, minors: 1 })).toBe('1 minor');
  });
  it('is defeated once the blockers and majors are fixed; minors left over are yours', () => {
    expect(bossView(r({ hp: 0, startHp: 12, hadBoss: true, defeatedAt: '2026-10-16T11:00:00.000Z' }))).toMatchObject({ defeated: true, left: 0, share: 0, text: 'Boss defeated' });
    expect(bossView(r({ minors: 2, hp: 2, startHp: 12, hadBoss: true }))).toMatchObject({ defeated: true, share: 0, text: 'Boss defeated · 2 minors left for you' });
    // A dashboard from before hadBoss: its defeat time says there was one.
    expect(bossView(r({ hp: 0, startHp: 12, defeatedAt: '2026-10-16T11:00:00.000Z' }))!.defeated).toBe(true);
  });
  it('shows no boss without a review, or when no round raised a blocker or a major', () => {
    expect(bossView(null)).toBeNull();
    expect(bossView(r({ hp: 0, startHp: 0, hadBoss: false }))).toBeNull();
    expect(bossView(r({ minors: 3, hp: 3, startHp: 3, hadBoss: false }))).toBeNull();
    // A later round that raised more than the first: the bar never overflows.
    expect(bossView(r({ blockers: 3, hp: 15, startHp: 12 }))!.share).toBe(1);
  });
});

describe('stamina', () => {
  const NOW = new Date(2026, 9, 16, 15, 0);
  const at = (h: number, m: number) => new Date(2026, 9, 16, h, m).toISOString();
  const usage = (extra: Partial<Usage>): Usage => ({ limited: false, blocking: false, label: null, resetsAt: null, ...extra });
  it('Fresh, Warning, or Resting until the reset, from the snapshot’s usage', () => {
    expect(staminaOf(usage({}), NOW)).toMatchObject({ state: 'fresh', label: 'Fresh', fill: 1 });
    expect(staminaOf(null, NOW).state).toBe('fresh');
    const warn = staminaOf(usage({ warning: { label: '5-hour limit', percent: 91, resetsAt: at(15, 42) } }), NOW);
    expect(warn).toMatchObject({ state: 'warning', label: 'Warning' });
    expect(warn.label).not.toMatch(/\d/);
    expect(warn.hint).toContain('3:42pm');
    // The bar is what is left of the limit when Claude said how much is used.
    expect(warn.fill).toBeCloseTo(0.09);
    expect(staminaOf(usage({ warning: { label: '5-hour limit', percent: null, resetsAt: null } }), NOW).fill).toBe(0.35);
    const auto = { limited: true, autoResume: true, resetKnown: true, resetsAt: at(15, 42) };
    expect(staminaOf(usage(auto), NOW)).toMatchObject({ state: 'resting', label: 'Resting until 3:42pm', fill: 0 });
    expect(staminaOf(usage({ limited: true }), NOW).label).toBe('Resting');
  });
  it('promises a time only when the jobs carry on by themselves then, as the usage banner does', () => {
    const off = staminaOf(usage({ limited: true, autoResume: false, resetKnown: true, resetsAt: at(15, 42) }), NOW);
    expect(off.label).toBe('Resting');
    expect(off.hint).toContain('Carry on now');
    const unknown = staminaOf(usage({ limited: true, autoResume: true, resetKnown: false, resetsAt: at(15, 42) }), NOW);
    expect(unknown.label).toBe('Resting');
    expect(unknown.hint).toContain('tries again at about 3:42pm');
  });
  it('a pause says when the crew are back', () => {
    const auto = { limited: true, autoResume: true, resetKnown: true };
    expect(backAt(usage({ ...auto, resetsAt: at(15, 42) }), NOW)).toBe('back at 3:42pm (in 42m)');
    expect(backAt(usage({ ...auto, resetsAt: at(17, 5) }), NOW)).toBe('back at 5:05pm (in 2h 5m)');
    expect(backAt(usage(auto), NOW)).toBe('');
    expect(backAt(usage({ ...auto, resetKnown: false, resetsAt: at(15, 42) }), NOW)).toBe('the dashboard tries again at about 3:42pm');
    expect(backAt(usage({ limited: true, autoResume: false, resetKnown: true, resetsAt: at(15, 42) }), NOW)).toBe('waiting for Carry on now (automatic carry-on is off)');
  });
});
