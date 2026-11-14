// The asks table (R6): one click for what he types again and again. The table is the brief's, word
// for word; the row fits the open step and holds at most four; a kept ask lives in this browser.
import { afterEach, describe, expect, it } from 'vitest';
import { ASKS, GAP, KEPT_KEY, MARK_DONE_SAYS, PULL_SAYS, askById, askSays, asksOf, fastOptions, fillGap, keepAsk, keptAsks, rowFor, stepGroup, FAST_SAYS } from './asks';

afterEach(() => { localStorage.clear(); });

describe('the asks table', () => {
  it('is the brief’s table: every label, in the steps it names, with its exact text', () => {
    const labels = ASKS.map((a) => a.label);
    expect(labels).toEqual([
      'Where are we?', 'Explain this step', 'Go faster', 'Stop here', 'Make this the rule next time…',
      'Summarise for approval', 'Drop something…', 'Reuse what exists',
      'How do I test this by hand?', 'Ask to start the app', 'It works', 'Run the checks again', 'Record again',
      'Fix the open findings', 'Publish the walkthrough',
      'Pull PR comments', 'Shorten the PR text', 'Mark done',
      'Test steps for stakeholders', 'Fix the ticket number…', 'New branch with only this change', 'Something is wrong…',
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

describe('what a kept message keeps (fix round 1)', () => {
  it('drops a notes block and keeps his words; nothing when it was only notes', async () => {
    const { keptWords } = await import('./asks');
    const block = '--- Notes (2) ---\n1. [drop] Plan v2 · step 4 "x"\n2. [explain] Spec v3 · line 6\n--- End of notes ---';
    expect(keptWords(`${block}\n\nPush to my fork.`)).toBe('Push to my fork.');
    expect(keptWords(block)).toBe('');
    expect(keptWords('check ok')).toBe('check ok');
    expect(keptWords('Mind the --- Notes (1) --- words in a sentence.')).toBe('Mind the --- Notes (1) --- words in a sentence.');
  });
});

describe('asks sent together (fix round 2)', () => {
  it('start with one line naming each, then their texts; and split back', async () => {
    const { joinAsks, splitAsks } = await import('./asks');
    const two = joinAsks([{ label: 'Where are we?', text: 'A.' }, { label: 'Stop here', text: 'B.' }]);
    expect(two).toBe('2 asks: Where are we?; Stop here\n\nA.\n\nB.');
    expect(joinAsks([{ label: 'x', text: 'Only.' }])).toBe('Only.');
    expect(splitAsks(two)).toEqual(['A.', 'B.']);
    expect(splitAsks('2 asks: x; y\n\nA.\n\nB.\n\nC.')).toBeNull();
    expect(splitAsks('Where are we?')).toBeNull();
  });
});

describe('the Ship asks and the hand test (Task 22)', () => {
  it('the Ship row: Pull PR comments, Shorten the PR text, Mark done, then the ones for any step', () => {
    expect(rowFor('ship').map((a) => a.id)).toEqual(['pull', 'shorten', 'done', 'where']);
    // The PR's next action leads only while Ship is not the open step (usePrLead gives no lead there).
    const lead = { id: 'pr-1-push-open', label: 'Push and open PR #1', text: 'Push.', steps: ['any'], inRow: true, needsWord: false, kind: 'send' } as const;
    expect(rowFor('build', lead).map((a) => a.id)).toEqual(['pr-1-push-open', 'where', 'fast', 'explain']);
  });

  it('each says exactly what it does: Shorten sends its words; Pull and Mark done are not messages', () => {
    expect(askById('shorten')).toMatchObject({ kind: 'send', needsWord: false, inRow: true, steps: ['ship'] });
    expect(askById('shorten')!.text).toBe('The PR text is longer than anyone will read. Cut it to what changed, how to test it, and the deploy note.');
    expect(askById('pull')).toMatchObject({ kind: 'pull', needsWord: false, inRow: true, laptop: true });
    expect(askById('pull')!.text).toBe(PULL_SAYS);
    expect(askById('done')).toMatchObject({ kind: 'mark-done', needsWord: false, inRow: true, laptop: true });
    expect(askById('done')!.text).toBe(MARK_DONE_SAYS);
    expect(askSays(askById('pull')!)).toBe('Not a message.');
    expect(askSays(askById('done')!)).toBe('Not a message.');
    expect(askSays(askById('shorten')!)).toBe('Sends:');
  });

  it('the Ship asks only in ⌘K, as the brief lists them', () => {
    expect(askById('stake')).toMatchObject({ inRow: false, steps: ['ship'], needsWord: false });
    expect(askById('stake')!.text).toBe('Write clear steps for the stakeholders to test this on staging.');
    expect(askById('ticket')).toMatchObject({ inRow: false, steps: ['ship'], needsWord: true });
    expect(askById('ticket')!.text).toBe(`The ticket number is ${GAP}. Update the branch name and every place that uses the old one.`);
    expect(askById('newbranch')).toMatchObject({ inRow: false, steps: ['ship'], needsWord: false });
    expect(askById('newbranch')!.text).toBe('Create a new branch with only this latest change, so the PR into staging is cleaner. Don’t push, and leave the current branch as it is.');
    expect(asksOf('ship').map((a) => a.id)).toEqual(['pull', 'shorten', 'done', 'stake', 'ticket', 'newbranch']);
  });

  it('the website has no Pull PR comments or Mark done (GitHub is read and a job marked on the laptop)', () => {
    expect(rowFor('ship', null, true).map((a) => a.id)).toEqual(['shorten', 'where', 'explain', 'fast']);
    // Final W4: and no Ask to start the app (the website has no Try it, Decision 8).
    expect(rowFor('test', null, true).map((a) => a.id)).toEqual(['howtest', 'works', 'rerun', 'where']);
  });

  it('final W4: the row’s start ask says it is a message and is the laptop’s only; the hand test keeps `Start the app`', () => {
    expect(askById('start')).toMatchObject({ label: 'Ask to start the app', kind: 'send', laptop: true });
    expect(askSays(askById('start')!)).toBe('Sends:');
    expect(rowFor('test').map((a) => a.label)).toContain('Ask to start the app');
    expect(ASKS.some((a) => a.label === 'Start the app')).toBe(false);
  });

  it('the hand test: It works sends its words; Something is wrong… puts its words in the box for his', () => {
    expect(askById('works')!.text).toBe('It works. I tested it by hand.');
    expect(askById('wrong')).toMatchObject({ label: 'Something is wrong…', inRow: false, steps: ['test'], needsWord: true, kind: 'send' });
    expect(askById('wrong')!.text).toBe(`I tested it by hand and something is wrong: ${GAP}`);
    expect(fillGap('', askById('wrong')!.text)).toEqual({ draft: 'I tested it by hand and something is wrong: ', cursor: 'I tested it by hand and something is wrong: '.length });
  });
});
