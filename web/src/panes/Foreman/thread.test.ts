import { describe, expect, it } from 'vitest';
import type { BriefItem, ThreadItem, YouItem } from '../../api/types';
import { extraLines, formatCost, isActiveRun, isOptionOnly, liveLabel, mergeThread, olderStillJoins, shownItems } from './thread';

const you = (id: string, text = id, extra: Partial<YouItem> = {}): ThreadItem => ({ id, kind: 'you', at: null, text, ...extra });
const brief = (n: number, stage: string, extra: Partial<BriefItem> = {}): BriefItem => ({
  id: `brief:briefs/${n}-${stage}.md`, kind: 'brief', at: null, number: n, stage, file: `briefs/${n}-${stage}.md`, headline: `Headline ${n}`, point: null, ...extra,
});

describe('thread helpers', () => {
  it('joins pages by id, oldest first, the newest page winning', () => {
    const older = [you('a'), you('b'), you('c', 'old copy')];
    const latest = [you('c', 'new copy'), you('d')];
    expect(mergeThread(older, latest).map((it) => [it.id, (it as { text: string }).text])).toEqual([['a', 'a'], ['b', 'b'], ['c', 'new copy'], ['d', 'd']]);
  });

  it('keeps older pages only while they still join the newest page', () => {
    expect(olderStillJoins([you('c'), you('d')], [you('c'), you('d'), you('e')])).toBe(true);
    expect(olderStillJoins([you('c'), you('d')], [you('x'), you('y')])).toBe(false);
    expect(olderStillJoins([], [you('x')])).toBe(true);
  });

  it('folds a detail file into its brief and marks answered briefs', () => {
    const items: ThreadItem[] = [brief(1, 'spec'), you('y1'), brief(2, 'plan'), brief(2, 'detail'), brief(3, 'implement')];
    const shown = shownItems(items);
    expect(shown.map((s) => s.id)).toEqual(['brief:briefs/1-spec.md', 'y1', 'brief:briefs/2-plan.md', 'brief:briefs/3-implement.md']);
    const cards = shown.flatMap((s) => (s.kind === 'brief-card' ? [s.brief] : []));
    expect(cards.map((b) => [b.item.number, b.answered, b.detailFile])).toEqual([
      [1, true, null], // you answered it
      [2, true, 'briefs/2-detail.md'], // a newer brief replaced it
      [3, false, null], // waiting for you
    ]);
  });

  it('knows a message that is only option lines from the gate card', () => {
    expect(isOptionOnly('Option change for the next step: skip test')).toBe(true);
    expect(isOptionOnly('Option change for the next step: skip test\n\nOption change for the next step: ask Fable at plan\n')).toBe(true);
    expect(isOptionOnly('Option change for the next step: skip test\n\nAlso check the CSV.')).toBe(false);
    expect(isOptionOnly('   ')).toBe(false);
  });

  it('a brief is answered by a gate reply (answeredBriefs), a newer brief, or, for older briefs, a later message that isn’t only option lines', () => {
    const answered = (items: ThreadItem[], facts = {}) => shownItems(items, facts).flatMap((s) => (s.kind === 'brief-card' ? [[s.brief.item.number, s.brief.answered]] : []));
    const chipsOnly = you('y-opt', 'Option change for the next step: skip test');
    // An option-only message never answers a brief, old or open.
    expect(answered([brief(1, 'spec'), chipsOnly])).toEqual([[1, false]]);
    expect(answered([brief(2, 'plan'), chipsOnly], { openBrief: 2 })).toEqual([[2, false]]);
    // A gate reply sent for the brief (answeredBriefs) answers it, wherever it sits.
    expect(answered([brief(2, 'plan')], { answeredBriefs: [2], openBrief: 2 })).toEqual([[2, true]]);
    // On the brief the gate card is open on, a plain message or a steer leaves it open...
    expect(answered([brief(2, 'plan'), you('q', 'Is the CSV in scope?', { sendKind: 'message' }), you('s', 'also this', { sendKind: 'steer' })], { openBrief: 2 })).toEqual([[2, false]]);
    // ...a deciding reply (the classic page's approve, changes, stop) or one sent for it answers it.
    expect(answered([brief(2, 'plan'), you('a', 'I approve.', { sendKind: 'approve' })], { openBrief: 2 })).toEqual([[2, true]]);
    expect(answered([brief(2, 'plan'), you('g', 'My answers to brief 2: …\n\nI approve.', { sendKind: 'approve', gateBrief: 2 })], { openBrief: 2 })).toEqual([[2, true]]);
    // "Other guidance" from the gate card (a message for brief 2) keeps its card open.
    expect(answered([brief(2, 'plan'), you('o', 'Also check the CSV.', { sendKind: 'message', gateBrief: 2 })], { openBrief: 2 })).toEqual([[2, false]]);
    // A gate reply answers only the brief it was for: a reply to brief 1 sent after brief 2 is not an answer to 2.
    expect(answered([brief(2, 'plan'), you('r', 'I approve.', { sendKind: 'approve', gateBrief: 1 })], { openBrief: 2 })).toEqual([[2, false]]);
    expect(answered([brief(1, 'spec'), you('r2', 'I approve.', { sendKind: 'approve', gateBrief: 3 })], { openBrief: 3 })).toEqual([[1, false]]);
    // Older briefs (no gate open on them) keep the old rule: any later message of yours.
    expect(answered([brief(1, 'spec'), you('m', 'Looks good')], { openBrief: 2 })).toEqual([[1, true]]);
    // A newer brief still replaces one.
    expect(answered([brief(1, 'spec'), chipsOnly, brief(2, 'plan')], { openBrief: 2 })).toEqual([[1, true], [2, false]]);
  });

  it('also finds briefs/<n>-<stage>-detail.md, and hides a detail whose brief is not loaded', () => {
    const shown = shownItems([brief(4, 'plan-detail'), brief(4, 'plan')]);
    expect(shown).toHaveLength(1);
    expect(shown[0].kind === 'brief-card' && shown[0].brief.detailFile).toBe('briefs/4-plan-detail.md');
    expect(shownItems([brief(5, 'detail')])).toEqual([]);
  });

  it('reads rulings and proof as lists, nothing when absent', () => {
    expect(extraLines(undefined)).toEqual([]);
    expect(extraLines('  ')).toEqual([]);
    expect(extraLines('kept enum order')).toEqual(['kept enum order']);
    expect(extraLines(['npm test → 0', '', 'tsc → 0'])).toEqual(['npm test → 0', 'tsc → 0']);
  });

  it('knows when the Foreman is replying', () => {
    expect(isActiveRun(null)).toBe(false);
    expect(isActiveRun({ id: 'r', slug: 's', status: 'done' })).toBe(false);
    expect(isActiveRun({ id: 'r', slug: 's', status: 'running' })).toBe(true);
    expect(liveLabel({ id: 'r', slug: 's', status: 'waiting_permission' })).toBe('Waiting for you to allow something');
  });

  it('formats cost', () => {
    expect(formatCost(undefined)).toBe('');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(12.345)).toBe('$12.35');
  });
});
