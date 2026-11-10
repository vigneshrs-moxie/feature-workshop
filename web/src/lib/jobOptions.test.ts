// A bug job's options in the editor: only the stages and lenses a bug job has, and its level
// defaults are the bug workflow's (the Examiner at L1, reproduce skipped), from the dashboard's
// own tables (dashboard/lib/options.js), so the page and the dashboard can't drift apart.
import { describe, expect, it } from 'vitest';
import { FABLE as DASHBOARD_FABLE, FABLE_POINTS, levelsForClient, RETIRED_FABLE_IDS, REVIEWERS, SKIPPABLE } from '../../../dashboard/lib/options.js';
import type { Meta } from '../api/types';
import { bodyFrom, currentModel, FABLE, formFrom, levelDefaults, optionLists, type LevelKeep } from './jobOptions';
import { levelChange, lensNames } from './levels';

const levels = levelsForClient();
const meta = { levels, jobOptions: { skippable: SKIPPABLE, reviewers: REVIEWERS, fablePoints: FABLE_POINTS } } as unknown as Meta;
const keep: LevelKeep = { provided: {}, notes: '', review_rounds: 1 };

describe('Fable 5.2 and the whole job on Fable', () => {
  it('the page’s Fable is the dashboard’s, and every Fable it retired opens as the current one', () => {
    expect(FABLE).toBe(DASHBOARD_FABLE);
    for (const id of RETIRED_FABLE_IDS) expect(currentModel(id)).toBe(FABLE);
    const form = formFrom({ level: 2, models: { foreman: 'claude-fable-5-1', build: 'claude-fable-5-1', checks: 'claude-sonnet-5-5' } }, 2, levels, optionLists(meta));
    expect(form.models).toEqual({ foreman: FABLE, build: FABLE, checks: 'claude-sonnet-5-5' });
  });

  it('a job on Fable throughout shows Fable everywhere, keeps it through a level change, and saves it', () => {
    const lists = optionLists(meta);
    const form = formFrom({ level: 1, all_fable: true, models: { foreman: 'claude-opus-5-5', build: 'claude-opus-5-5', checks: 'claude-opus-5-5' } }, 1, levels, lists);
    expect(form.all_fable).toBe(true);
    expect(form.models).toEqual({ foreman: FABLE, build: FABLE, checks: FABLE });
    const l3 = levelDefaults(3, levels, lists, { ...keep, from: form });
    expect(l3.all_fable).toBe(true);
    expect(l3.models).toEqual({ foreman: FABLE, build: FABLE, checks: FABLE });
    expect(bodyFrom(l3)).toMatchObject({ all_fable: true });
    // Reset to the level's defaults (no `from`) turns it off with everything else.
    expect(levelDefaults(3, levels, lists, keep).all_fable).toBe(false);
    expect(formFrom({ level: 1 }, 1, levels, lists).all_fable).toBe(false);
  });
});

describe('the options lists for a kind of job', () => {
  it('a bug job is offered triage, reproduce, test and review, and every lens with the Examiner', () => {
    const lists = optionLists(meta, 'bug');
    expect(lists.skippable.map((s) => s.id)).toEqual(['triage', 'reproduce', 'test', 'review']);
    expect(lists.reviewers.map((r) => r.label)).toContain('Examiner');
    expect(lists.reviewers.map((r) => r.id)).toContain('feature-review-permissions');
  });

  it('a feature job is never offered triage, reproduce or the Examiner', () => {
    const lists = optionLists(meta, 'feature');
    expect(lists.skippable.map((s) => s.id)).toEqual(['clarify', 'spec', 'refine', 'wireframe', 'investigate', 'spec-update', 'plan', 'test', 'review']);
    expect(lists.reviewers.map((r) => r.label)).not.toContain('Examiner');
  });

  it('with no job in hand, every one', () => {
    const lists = optionLists(meta);
    expect(lists.skippable).toHaveLength(SKIPPABLE.length);
    expect(lists.reviewers).toHaveLength(REVIEWERS.length);
  });
});

describe('the Fable points for a kind of job', () => {
  it('a bug job has no spec look, and its plan look is at the diagnosis', () => {
    expect(optionLists(meta, 'bug').fablePoints.map((p) => p.label)).toEqual(['Before you approve the diagnosis', 'When the review is wrapped up', 'Before PR #1 opens']);
    expect(levelChange(2, 3, levels, lensNames(meta), null, 'bug').text).toMatch(/Fable at diagnosis \+ review/);
  });

  it('a feature job’s are unchanged', () => {
    expect(optionLists(meta, 'feature').fablePoints.map((p) => p.label)).toEqual(['After the spec is written', 'Before you approve the plan', 'When the review is wrapped up', 'Before PR #1 opens']);
    expect(levelChange(2, 3, levels, lensNames(meta)).text).toMatch(/Fable at plan \+ review/);
  });
});

describe('a level’s defaults in the editor', () => {
  it('on a bug job: the bug workflow’s skip list and reviewers', () => {
    const lists = optionLists(meta, 'bug');
    const l1 = levelDefaults(1, levels, lists, keep, 'bug');
    expect(l1.reviewers).toEqual(['bug-review-fix']);
    expect(l1.skip).toEqual(['reproduce']);
    expect(levelDefaults(0, levels, lists, keep, 'bug').skip).toEqual(['triage', 'reproduce', 'test', 'review']);
    expect(levelDefaults(3, levels, lists, keep, 'bug').reviewers).toContain('bug-review-fix');
    // A bug job with no options yet starts from them too.
    expect(formFrom(null, 1, levels, lists, 'bug').reviewers).toEqual(['bug-review-fix']);
  });

  it('on a feature job: the same as before', () => {
    const lists = optionLists(meta, 'feature');
    expect(levelDefaults(1, levels, lists, keep, 'feature').reviewers).toEqual(['feature-reviewer']);
    expect(levelDefaults(1, levels, lists, keep).reviewers).toEqual(['feature-reviewer']);
    expect(levelDefaults(3, levels, lists, keep, 'feature').reviewers).not.toContain('bug-review-fix');
  });
});

describe('what moving a bug job between levels adds and drops', () => {
  const names = lensNames(meta);
  it('names the bug stages and lenses, never the spec or the screens', () => {
    const up = levelChange(1, 2, levels, names, null, 'bug').text;
    expect(up).toMatch(/^L1→L2 adds: reproduction, tester/);
    expect(up).not.toMatch(/spec|screens|clarify|Head inspector/);
    expect(levelChange(1, 0, levels, names, null, 'bug').text).toMatch(/drops: .*Examiner lens/);
    expect(levelChange(null, 0, levels, names, null, 'bug').text).toMatch(/^L0 Tweak \(hotfix\) runs:/);
  });

  it('a feature job’s words are unchanged', () => {
    expect(levelChange(1, 2, levels, names).text).toMatch(/clarify questions, spec/);
  });
});
