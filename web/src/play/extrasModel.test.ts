// The Full-mode extras' pure parts: the quest track, the boss fight and stamina. Invented jobs only.
import { describe, expect, it } from 'vitest';
import type { LevelInfo, ReviewBoss, Usage } from '../api/types';
import { job } from '../state/test-fixtures';
import { backAt, bossView, difficultyStars, findingsText, questTrack, staminaOf } from './extrasModel';

const LEVELS = [
  { level: 0, label: 'L0 Tweak', skip: ['spec', 'refine', 'investigate', 'spec-update', 'plan', 'test', 'review'] },
  { level: 1, label: 'L1 Small', skip: ['spec', 'refine', 'investigate', 'spec-update'] },
  { level: 2, label: 'L2 Standard', skip: ['refine'] },
  { level: 3, label: 'L3 Large', skip: [] },
] as unknown as LevelInfo[];

const states = (t: ReturnType<typeof questTrack>) => t!.stops.map((s) => `${s.label}:${s.state}`);

describe('quest track', () => {
  it('shows the level as difficulty, L0 ★ to L3 ★★★★', () => {
    expect([0, 1, 2, 3].map((l) => difficultyStars(l as 0))).toEqual(['★', '★★', '★★★', '★★★★']);
    expect(questTrack(job('a', 'running', { level: 2, stage: 'plan' }), LEVELS)!.difficulty).toBe('Difficulty: L2 Standard');
    expect(questTrack(job('a', 'running', { level: null }), LEVELS)).toBeNull();
  });

  it('runs the stages this level runs, skipped ones hidden, the current stage’s crew member on it', () => {
    const l2 = questTrack(job('a', 'running', { level: 2, stage: 'implement' }), LEVELS)!;
    expect(states(l2)).toEqual(['Spec:done', 'Investigate:done', 'Plan:done', 'Build:current', 'Test:next', 'Review:next', 'PR #1:next']);
    expect(l2.who).toBe('feature-implementer');
    expect(l2.finished).toBe(false);
    const l0 = questTrack(job('a', 'running', { level: 0, stage: 'implement' }), LEVELS)!;
    expect(states(l0)).toEqual(['Build:current', 'PR #1:next']);
    const l3 = questTrack(job('a', 'running', { level: 3, stage: 'review' }), LEVELS)!;
    expect(l3.stops.map((s) => s.id)).toEqual(['spec', 'refine', 'investigate', 'plan', 'implement', 'test', 'review', 'pr1']);
    expect(l3.who).toBe('feature-reviewer');
    // Without meta.levels the dashboard's defaults apply.
    expect(states(questTrack(job('a', 'running', { level: 1, stage: 'test' }))!)).toEqual(['Plan:done', 'Build:done', 'Test:current', 'Review:next', 'PR #1:next']);
  });

  it('shows Spec update, or a stage this level would skip, only while it is the stage', () => {
    expect(questTrack(job('a', 'running', { level: 3, stage: 'spec-update' }), LEVELS)!.stops.find((s) => s.state === 'current')!.id).toBe('spec-update');
    expect(questTrack(job('a', 'running', { level: 2, stage: 'refine' }), LEVELS)!.stops.map((s) => s.id)).toContain('refine');
  });

  it('is finished past the first PR or once the job is done, the Foreman at the goal', () => {
    const past = questTrack(job('a', 'running', { level: 2, stage: 'pr2' }), LEVELS)!;
    expect(past.finished).toBe(true);
    expect(past.stops.every((s) => s.state === 'done')).toBe(true);
    expect(past.who).toBe('conductor');
    expect(questTrack(job('a', 'done', { level: 1, stage: 'review' }), LEVELS)!.finished).toBe(true);
    // No stage yet: nobody stands anywhere.
    expect(questTrack(job('a', 'idle', { level: 2 }), LEVELS)!.who).toBeNull();
  });
});

describe('boss fight', () => {
  const r = (extra: Partial<ReviewBoss>): ReviewBoss => ({ at: '2026-10-16T10:00:00.000Z', blockers: 0, majors: 0, minors: 0, hp: 0, startHp: 0, defeatedAt: null, ...extra });
  it('says the hit points left of where it started, and the findings left', () => {
    expect(bossView(r({ blockers: 1, majors: 1, hp: 8, startHp: 12 }))).toEqual({ start: 12, left: 8, share: 8 / 12, defeated: false, text: 'Boss: 8 of 12 hit points left · 1 blocker, 1 major' });
    expect(bossView(r({ majors: 2, minors: 3, hp: 9, startHp: 9 }))!.text).toBe('Boss: 9 of 9 hit points left · 2 majors, 3 minors');
    expect(findingsText({ blockers: 0, majors: 0, minors: 1 })).toBe('1 minor');
  });
  it('is defeated at zero; nothing to show without a review', () => {
    expect(bossView(r({ hp: 0, startHp: 12, defeatedAt: '2026-10-16T11:00:00.000Z' }))).toMatchObject({ defeated: true, left: 0, share: 0, text: 'Boss defeated' });
    expect(bossView(null)).toBeNull();
    // A later round that raised more than the first: the bar never overflows.
    expect(bossView(r({ blockers: 3, hp: 15, startHp: 12 }))!.share).toBe(1);
  });
});

describe('stamina', () => {
  const NOW = new Date(2026, 9, 16, 15, 0);
  const at = (h: number, m: number) => new Date(2026, 9, 16, h, m).toISOString();
  const usage = (extra: Partial<Usage>): Usage => ({ limited: false, blocking: false, label: null, resetsAt: null, ...extra });
  it('Fresh, Warning, or Resting until the reset, from the snapshot’s usage (never a made-up percentage)', () => {
    expect(staminaOf(usage({}), NOW)).toMatchObject({ state: 'fresh', label: 'Fresh', fill: 1 });
    expect(staminaOf(null, NOW).state).toBe('fresh');
    const warn = staminaOf(usage({ warning: { label: '5-hour limit', percent: 91, resetsAt: at(15, 42) } }), NOW);
    expect(warn).toMatchObject({ state: 'warning', label: 'Warning' });
    expect(warn.label).not.toMatch(/\d/);
    expect(warn.hint).toContain('3:42pm');
    expect(staminaOf(usage({ limited: true, resetsAt: at(15, 42) }), NOW)).toMatchObject({ state: 'resting', label: 'Resting until 3:42pm', fill: 0 });
    expect(staminaOf(usage({ limited: true }), NOW).label).toBe('Resting');
  });
  it('a pause says when the crew are back', () => {
    expect(backAt(usage({ limited: true, resetsAt: at(15, 42) }), NOW)).toBe('back at 3:42pm (in 42m)');
    expect(backAt(usage({ limited: true, resetsAt: at(17, 5) }), NOW)).toBe('back at 5:05pm (in 2h 5m)');
    expect(backAt(usage({ limited: true }), NOW)).toBe('');
  });
});
