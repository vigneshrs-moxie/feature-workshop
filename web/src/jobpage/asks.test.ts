// The asks table (R6): one click for what he types again and again. The table is the brief's, word
// for word; the row fits the open step and holds at most four; a kept ask lives in this browser.
import { afterEach, describe, expect, it } from 'vitest';
import { ASKS, GAP, KEPT_KEY, askById, fastOptions, fillGap, keepAsk, keptAsks, rowFor, stepGroup, FAST_SAYS } from './asks';

afterEach(() => { localStorage.clear(); });

describe('the asks table', () => {
  it('is the brief’s table: every label, in the steps it names, with its exact text', () => {
    const labels = ASKS.map((a) => a.label);
    expect(labels).toEqual([
      'Where are we?', 'Explain this step', 'Go faster', 'Stop here', 'Make this the rule next time…',
      'Summarise for approval', 'Drop something…', 'Reuse what exists',
      'How do I test this by hand?', 'Start the app', 'It works', 'Run the checks again', 'Record again',
      'Fix the open findings', 'Publish the walkthrough',
    ]);
    // Every ask has an id, a step group, an exact text, and says whether it needs a word.
    for (const a of ASKS) {
      expect(a.id).toMatch(/^[a-z-]+$/);
      expect(a.text.length).toBeGreaterThan(10);
      expect(a.steps.length).toBeGreaterThan(0);
      // Needs a word exactly when its text has the gap.
      expect(a.needsWord, a.id).toBe(a.text.includes(GAP));
    }
    expect(new Set(ASKS.map((a) => a.id)).size).toBe(ASKS.length);
    expect(askById('drop')!.text).toBe(`Drop ${GAP} from scope. Update the spec, plan and tests to match.`);
    expect(askById('rule')!.needsWord).toBe(true);
    expect(askById('fast')!.kind).toBe('fast');
    expect(askById('where')!.text).toBe('Where are we? One short paragraph: what is done, what is next, and what you need from me.');
  });

  it('puts Spec, Investigate and Plan together, and every other step in its own group', () => {
    expect(stepGroup('spec')).toBe('spec-plan');
    expect(stepGroup('investigate')).toBe('spec-plan');
    expect(stepGroup('plan')).toBe('spec-plan');
    expect(stepGroup('build')).toBe('build');
    expect(stepGroup('ship')).toBe('ship');
    expect(stepGroup(null)).toBe('any');
  });
});

describe('the row', () => {
  const ids = (step: Parameters<typeof rowFor>[0]) => rowFor(step).map((a) => a.id);

  it('holds at most four, fitted to the open step: its own asks first, then the ones for any step', () => {
    expect(ids('plan')).toEqual(['summ', 'drop', 'fast', 'where']);
    expect(ids('spec')).toEqual(['summ', 'drop', 'fast', 'where']);
    expect(ids('build')).toEqual(['where', 'fast', 'explain']);
    expect(ids('test')).toEqual(['howtest', 'start', 'works', 'rerun']);
    expect(ids('review')).toEqual(['fixfind', 'fast', 'where', 'explain']);
    expect(ids(null)).toEqual(['where', 'explain', 'fast']);
    for (const s of ['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship', null] as const) expect(rowFor(s).length).toBeLessThanOrEqual(4);
  });

  it('keeps ⌘K-only asks out of the row', () => {
    for (const s of ['spec', 'plan', 'build', 'test', 'review', 'ship', null] as const) {
      expect(ids(s)).not.toContain('stop');
      expect(ids(s)).not.toContain('reuse');
      expect(ids(s)).not.toContain('record');
      expect(ids(s)).not.toContain('walkthrough');
    }
  });

  it('takes a lead ask first when one is given (the PR’s next action, Tasks 20 and 22)', () => {
    const lead = { id: 'pr-next', label: 'Push and open PR #1', text: 'Push and open PR #1.', steps: ['any'], inRow: true, needsWord: false, kind: 'send' } as const;
    expect(rowFor('build', lead).map((a) => a.id)).toEqual(['pr-next', 'where', 'fast', 'explain']);
  });
});

describe('an ask that needs a word', () => {
  it('fills the box with its text and puts the cursor in the gap', () => {
    expect(fillGap('', askById('drop')!.text)).toEqual({ draft: 'Drop  from scope. Update the spec, plan and tests to match.', cursor: 5 });
  });

  it('goes after words already in the box, on a new line', () => {
    const r = fillGap('Two things.', askById('drop')!.text);
    expect(r.draft).toBe('Two things.\nDrop  from scope. Update the spec, plan and tests to match.');
    expect(r.cursor).toBe('Two things.\nDrop '.length);
  });
});

describe('Go faster', () => {
  it('switches to one reviewer a round and no second looks, and says what it switched', () => {
    const was = { level: 2, reviewers: 'auto' as const, fable_checks: ['plan', 'review'], notes: 'keep', skip: [] };
    const r = fastOptions(was, 'feature');
    expect(r.options).toEqual({ ...was, reviewers: ['feature-reviewer'], fable_checks: [] });
    expect(r.says).toBe(FAST_SAYS);
    expect(FAST_SAYS).toBe('Fast from the next step: 1 reviewer, no second looks');
  });

  it('names only what it changed, and nothing when the job is already fast', () => {
    expect(fastOptions({ reviewers: ['a', 'b'], fable_checks: [] }, 'feature').says).toBe('Fast from the next step: 1 reviewer');
    expect(fastOptions({ reviewers: ['feature-reviewer'], fable_checks: ['pr'] }, 'feature').says).toBe('Fast from the next step: no second looks');
    expect(fastOptions({ reviewers: ['feature-reviewer'], fable_checks: [] }, 'feature').says).toBeNull();
    // Review skipped (an L0 tweak): no reviewer to cut down to.
    expect(fastOptions({ reviewers: [], skip: ['review'], fable_checks: [] }, 'feature').says).toBeNull();
  });

  it('keeps the bug-fix lens on a bug job', () => {
    expect(fastOptions({ reviewers: 'auto', fable_checks: [] }, 'bug').options.reviewers).toEqual(['bug-review-fix']);
  });
});

describe('kept asks', () => {
  it('are kept under sb.asks.kept, newest last, once each', () => {
    expect(KEPT_KEY).toBe('sb.asks.kept');
    expect(keptAsks()).toEqual([]);
    expect(keepAsk('check ok')).toBe(true);
    expect(keepAsk('  check ok ')).toBe(false);
    expect(keepAsk('push to my fork')).toBe(true);
    expect(JSON.parse(localStorage.getItem('sb.asks.kept')!)).toEqual(['check ok', 'push to my fork']);
    expect(keptAsks()).toEqual(['check ok', 'push to my fork']);
  });

  it('reads nothing from a broken value', () => {
    localStorage.setItem('sb.asks.kept', '{not json');
    expect(keptAsks()).toEqual([]);
    localStorage.setItem('sb.asks.kept', JSON.stringify([1, 'ok', null]));
    expect(keptAsks()).toEqual(['ok']);
  });
});
