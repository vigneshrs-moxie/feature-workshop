import { describe, expect, it } from 'vitest';
import type { BriefItem, ThreadItem } from '../../api/types';
import { extraLines, formatCost, isActiveRun, liveLabel, mergeThread, olderStillJoins, shownItems } from './thread';

const you = (id: string, text = id): ThreadItem => ({ id, kind: 'you', at: null, text });
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
