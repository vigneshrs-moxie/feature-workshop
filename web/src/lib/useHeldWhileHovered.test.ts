// Nothing moves under the pointer (principle 4): while held, each item keeps its group and place
// with fresh data; new ones join at the end of their group; gone ones leave; letting go rearranges.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { arrange, useHeldWhileHovered } from './useHeldWhileHovered';

interface Card { id: string; lane: string; note?: string }
const keyOf = (c: Card) => c.id;
const groupOf = (c: Card) => c.lane;
const show = (placed: { item: Card; group: string }[]) => placed.map((p) => `${p.group}:${p.item.id}`);

describe('arrange', () => {
  const held = [{ key: 'a', group: 'left' }, { key: 'b', group: 'left' }, { key: 'c', group: 'right' }];

  it('with no hold, each item is in its own group and order', () => {
    expect(show(arrange(null, [{ id: 'b', lane: 'right' }, { id: 'a', lane: 'left' }], keyOf, groupOf))).toEqual(['right:b', 'left:a']);
  });

  it('a held item keeps its old group and place, with its new data', () => {
    const now = [{ id: 'b', lane: 'left' }, { id: 'a', lane: 'right', note: 'new' }, { id: 'c', lane: 'right' }];
    const out = arrange(held, now, keyOf, groupOf);
    expect(show(out)).toEqual(['left:a', 'left:b', 'right:c']);
    expect(out[0].item.note).toBe('new');
  });

  it('a new item joins at the end, in its own group; a gone one leaves', () => {
    const now = [{ id: 'd', lane: 'left' }, { id: 'a', lane: 'left' }, { id: 'c', lane: 'right' }];
    expect(show(arrange(held, now, keyOf, groupOf))).toEqual(['left:a', 'right:c', 'left:d']);
  });
});

describe('useHeldWhileHovered', () => {
  const start: Card[] = [{ id: 'a', lane: 'left' }, { id: 'b', lane: 'left' }, { id: 'c', lane: 'right' }];
  const setup = (active = true) => renderHook(({ items, on }) => useHeldWhileHovered(items, keyOf, groupOf, on), { initialProps: { items: start, on: active } });

  it('holds lanes and order while the pointer is over it, and lets go when it leaves', () => {
    const { result, rerender } = setup();
    act(() => { result.current.hoverProps.onMouseEnter(); });
    const moved: Card[] = [{ id: 'b', lane: 'left' }, { id: 'a', lane: 'right' }, { id: 'c', lane: 'right' }];
    rerender({ items: moved, on: true });
    expect(show(result.current.arranged)).toEqual(['left:a', 'left:b', 'right:c']);
    expect(result.current.held).toBe(true);
    act(() => { result.current.hoverProps.onMouseLeave(); });
    expect(show(result.current.arranged)).toEqual(['left:b', 'right:a', 'right:c']);
    expect(result.current.held).toBe(false);
  });

  it('without the pointer, changes show at once', () => {
    const { result, rerender } = setup();
    rerender({ items: [{ id: 'c', lane: 'left' }], on: true });
    expect(show(result.current.arranged)).toEqual(['left:c']);
  });

  it('a hold is dropped when there is no board to hover (another layout)', () => {
    const { result, rerender } = setup();
    act(() => { result.current.hoverProps.onMouseEnter(); });
    rerender({ items: [{ id: 'a', lane: 'right' }], on: false });
    expect(show(result.current.arranged)).toEqual(['right:a']);
  });
});
