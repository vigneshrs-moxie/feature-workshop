import { describe, expect, it } from 'vitest';
import { suggestLevel } from '../../../dashboard/lib/level-rules.js';
import type { Job } from '../api/types';
import { LEVELS, REVIEWERS } from '../state/test-fixtures';
import { floorNote, levelCardView, levelChange, levelLabel, lensNames, suggestFromDescription } from './levels';

const NAMES = Object.fromEntries(REVIEWERS.map((r) => [r.id, r.label]));

describe('levelChange (the consequence line)', () => {
  it('names what moving up adds, with the lenses’ friendly names', () => {
    expect(levelChange(1, 2, LEVELS, NAMES).text).toBe('L1→L2 adds: spec, investigation, spec update, Locksmith + Gauge lenses');
    expect(levelChange(0, 1, LEVELS, NAMES).text).toBe('L0→L1 adds: plan, tester, review, you test, Head inspector lens');
    expect(levelChange(2, 3, LEVELS, NAMES).text).toBe('L2→L3 adds: product interview, Fable at plan + review, Stickler + Fuse + Mason + Stopwatch + Painter lenses');
  });

  it('names what moving down drops', () => {
    const c = levelChange(2, 1, LEVELS, NAMES);
    expect(c.text).toBe('L2→L1 drops: spec, investigation, spec update, Locksmith + Gauge lenses');
    expect(c.added).toEqual([]);
    expect(levelChange(3, 0, LEVELS, NAMES).dropped).toEqual([
      'spec', 'product interview', 'investigation', 'spec update', 'plan', 'tester', 'review', 'you test', 'Fable at plan + review',
      'Head inspector + Locksmith + Gauge + Stickler + Fuse + Mason + Stopwatch + Painter lenses',
    ]);
  });

  it('falls back to agent ids without names, and says what a level runs when there was none', () => {
    expect(levelChange(1, 2, LEVELS).text).toBe('L1→L2 adds: spec, investigation, spec update, feature-review-permissions + feature-review-tests lenses');
    expect(levelChange(null, 2, LEVELS, NAMES).text).toBe('L2 Standard runs: spec, investigation, spec update, plan, tester, review, you test, Head inspector + Locksmith + Gauge lenses');
    expect(levelChange(null, 0, LEVELS, NAMES).text).toBe('L0 Tweak runs: one build and the checks');
    expect(levelChange(2, 2, LEVELS, NAMES).text).toBe('L2→L2: the same stages and reviewers');
    expect(levelChange(1, 3, null).text, 'no meta.levels: just the label').toBe('L3 Large');
  });

  it('reads the lens names from meta.jobOptions', () => {
    expect(lensNames({ token: 't', jobOptions: { reviewers: REVIEWERS } })['feature-review-db']).toBe('Mason');
    expect(lensNames(null)).toEqual({});
    expect(levelLabel(2)).toBe('L2 Standard');
  });
});

describe('the rules’ suggestion on the page', () => {
  it('is the dashboard’s own suggestLevel, and waits for a few characters', () => {
    const text = 'Let managers change roles on the people page';
    expect(suggestFromDescription(`  ${text} `)).toEqual(suggestLevel({ description: text }));
    expect(suggestFromDescription('ab')).toBeNull();
    expect(suggestFromDescription('Fix the typo in the footer')?.level).toBe(0);
  });

  it('notes a pick under the floor, with why', () => {
    const s = suggestFromDescription('Let managers change roles')!;
    expect(s.level).toBe(3);
    expect(floorNote(s, 1)).toBe('The rules suggest at least L3 because it touches sign-in, roles or permissions; the Foreman will ask before building.');
    expect(floorNote(s, 3)).toBeNull();
    const col = suggestFromDescription('Add a new column to the ticket list')!;
    expect(floorNote(col, 1)).toBe('The rules suggest at least L2 because it touches a new or changed table or column; the Foreman will ask before building.');
    expect(floorNote(suggestFromDescription('Fix the typo in the footer')!, 0)).toBeNull();
  });
});

describe('levelCardView (when the LevelCard shows)', () => {
  const rules = { level: 2 as const, floor: 0, reasons: ['Not obviously a one-line change, so L2.'], triggers: [], fromDiff: false, changedFiles: null };
  const facts = (extra: Partial<Job>) => ({ level: null, suggestedLevel: null, rulesLevel: null, closed: null, ...extra });

  it('shows when the Foreman’s suggestion differs from the chosen level', () => {
    expect(levelCardView(facts({ level: 2, suggestedLevel: 3, rulesLevel: rules }), null)).toEqual({ show: true, target: 3, signature: '2>3' });
    expect(levelCardView(facts({ level: 3, suggestedLevel: 3 }), null).show).toBe(false);
    expect(levelCardView(facts({ level: 1, rulesLevel: rules }), null).show, 'a level and no Foreman suggestion: nothing to ask').toBe(false);
  });

  it('shows when there is no level yet, offering the Foreman’s suggestion, else the rules’', () => {
    expect(levelCardView(facts({ suggestedLevel: 1, rulesLevel: rules }), null)).toEqual({ show: true, target: 1, signature: 'none>1' });
    expect(levelCardView(facts({ rulesLevel: rules }), null)).toEqual({ show: true, target: 2, signature: 'none>2' });
    expect(levelCardView(facts({}), null).show, 'nothing to offer yet').toBe(false);
  });

  it('stays hidden after Keep for that same suggestion only, and never on a closed job', () => {
    expect(levelCardView(facts({ level: 2, suggestedLevel: 3 }), '2>3').show).toBe(false);
    expect(levelCardView(facts({ level: 2, suggestedLevel: 1 }), '2>3').show, 'a new suggestion shows again').toBe(true);
    expect(levelCardView(facts({ level: 1, suggestedLevel: 3 }), '2>3').show, 'a new chosen level too').toBe(true);
    expect(levelCardView(facts({ level: 2, suggestedLevel: 3, closed: { as: 'done' } }), null).show).toBe(false);
  });
});
