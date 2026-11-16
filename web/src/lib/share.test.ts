import { describe, expect, it } from 'vitest';
import { share } from './share';

describe('share: keeps what did not change identical', () => {
  it('gives back the old value when the new one is the same in every field', () => {
    const prev = { a: 1, list: [{ slug: 'x', n: 1 }, { slug: 'y', n: 2 }], deep: { b: [1, 2, { c: null }] } };
    const next = JSON.parse(JSON.stringify(prev));
    expect(share(prev, next)).toBe(prev);
  });

  it('keeps unchanged items of a list by their slug or id, even when the order moves', () => {
    const prev = [{ slug: 'a', n: 1 }, { slug: 'b', n: 2 }, { slug: 'c', n: 3 }];
    const next = [{ slug: 'c', n: 3 }, { slug: 'a', n: 9 }, { slug: 'b', n: 2 }];
    const out = share(prev, next);
    expect(out).not.toBe(prev);
    expect(out).toEqual(next);
    expect(out[0]).toBe(prev[2]);
    expect(out[1]).not.toBe(prev[0]);
    expect(out[2]).toBe(prev[1]);
  });

  it('keeps unchanged parts of a changed object', () => {
    const prev = { meta: { settings: { a: 1 } }, jobs: [{ id: '1' }], at: 't1' };
    const next = { meta: { settings: { a: 1 } }, jobs: [{ id: '1' }], at: 't2' };
    const out = share(prev, next);
    expect(out).not.toBe(prev);
    expect(out.at).toBe('t2');
    expect(out.meta).toBe(prev.meta);
    expect(out.jobs).toBe(prev.jobs);
  });

  it('sees a field added or taken away, and a list grown or shrunk', () => {
    expect(share({ a: 1 }, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    expect(share({ a: 1, b: 2 } as Record<string, number>, { a: 1 })).toEqual({ a: 1 });
    const prev = [1, 2];
    expect(share(prev, [1, 2, 3])).toEqual([1, 2, 3]);
    expect(share(prev, [1])).toEqual([1]);
    expect(share({ a: undefined } as Record<string, unknown>, {})).toEqual({});
  });

  it('takes the new value when the kinds differ', () => {
    expect(share([1], { 0: 1 })).toEqual({ 0: 1 });
    expect(share(null, { a: 1 })).toEqual({ a: 1 });
    expect(share({ a: 1 }, null)).toBe(null);
    expect(share('a', 'b')).toBe('b');
    expect(share(Number.NaN, Number.NaN)).toBeNaN();
  });

  it('never keeps an old Date, Map or other object that is not plain data', () => {
    const d1 = new Date('2026-01-01T00:00:00Z');
    const d2 = new Date('2026-01-02T00:00:00Z');
    expect(share({ at: d1 }, { at: d2 }).at).toBe(d2);
    const m = new Map();
    expect(share(new Map(), m)).toBe(m);
  });
});
