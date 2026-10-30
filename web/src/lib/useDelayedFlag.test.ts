// Don't flash loading (principle 5): nothing for a quick load, the indicator after 200 ms, and once
// shown it stays at least 400 ms.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOADING_DELAY_MS, LOADING_MIN_MS, useDelayedFlag } from './useDelayedFlag';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const hook = (on: boolean) => renderHook(({ on: o }) => useDelayedFlag(o), { initialProps: { on } });

describe('useDelayedFlag', () => {
  it('waits 200 ms and stays at least 400 ms by default', () => {
    expect(LOADING_DELAY_MS).toBe(200);
    expect(LOADING_MIN_MS).toBe(400);
  });

  it('a load under the delay never shows anything', () => {
    const { result, rerender } = hook(true);
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(150); });
    expect(result.current).toBe(false);
    rerender({ on: false });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(false);
  });

  it('a slower load shows after the delay, and stays the minimum even when it ends at once', () => {
    const { result, rerender } = hook(true);
    act(() => { vi.advanceTimersByTime(199); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(50); });
    rerender({ on: false });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(349); });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(false);
  });

  it('a long load goes away as soon as it ends, once the minimum has passed', () => {
    const { result, rerender } = hook(true);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current).toBe(true);
    rerender({ on: false });
    act(() => { vi.advanceTimersByTime(0); });
    expect(result.current).toBe(false);
  });

  it('starting again while it is still up keeps it up, with no blink', () => {
    const { result, rerender } = hook(true);
    act(() => { vi.advanceTimersByTime(300); });
    rerender({ on: false });
    act(() => { vi.advanceTimersByTime(100); });
    rerender({ on: true });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current).toBe(true);
  });

  it('takes its own delay and minimum', () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedFlag(on, 300, 500), { initialProps: { on: true } });
    act(() => { vi.advanceTimersByTime(299); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
    rerender({ on: false });
    act(() => { vi.advanceTimersByTime(499); });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(false);
  });
});
