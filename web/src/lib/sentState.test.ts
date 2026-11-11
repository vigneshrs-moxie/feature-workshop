// A button that sends something (spec 1.2): sending from the click until the request answers, sent
// once it was taken, stuck after 30 seconds of nothing moving, and back to idle on a failure or
// once the thing it sent moves on. Every place that names the same key shares one state.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllSent, STUCK_AFTER_MS, useSent } from './sentState';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { clearAllSent(); vi.useRealTimers(); });

const hook = (key = 'gate:alpha') => renderHook(({ k }) => useSent(k), { initialProps: { k: key } });

describe('useSent', () => {
  it('waits 30 seconds before it calls a send stuck', () => {
    expect(STUCK_AFTER_MS).toBe(30_000);
  });

  it('idle, then sending on the click, then sent once the request is taken', () => {
    const { result } = hook();
    expect(result.current.state).toBe('idle');
    act(() => result.current.start());
    expect(result.current.state).toBe('sending');
    act(() => result.current.accepted());
    expect(result.current.state).toBe('sent');
  });

  it('sent turns stuck 30 seconds after it was taken', () => {
    const { result } = hook();
    act(() => { result.current.start(); result.current.accepted(); });
    act(() => { vi.advanceTimersByTime(STUCK_AFTER_MS - 1); });
    expect(result.current.state).toBe('sent');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.state).toBe('stuck');
  });

  it('clear() before 30 seconds goes back to idle and never turns stuck', () => {
    const { result } = hook();
    act(() => { result.current.start(); result.current.accepted(); });
    act(() => { vi.advanceTimersByTime(10_000); });
    act(() => result.current.clear());
    expect(result.current.state).toBe('idle');
    act(() => { vi.advanceTimersByTime(STUCK_AFTER_MS * 2); });
    expect(result.current.state).toBe('idle');
  });

  it('failed() goes back to idle', () => {
    const { result } = hook();
    act(() => result.current.start());
    act(() => result.current.failed());
    expect(result.current.state).toBe('idle');
  });

  it('a new start after stuck sends again, and its own 30 seconds count from its own click', () => {
    const { result } = hook();
    act(() => { result.current.start(); result.current.accepted(); });
    act(() => { vi.advanceTimersByTime(STUCK_AFTER_MS); });
    act(() => result.current.start());
    expect(result.current.state).toBe('sending');
    act(() => { vi.advanceTimersByTime(STUCK_AFTER_MS - 1); });
    expect(result.current.state, 'no old timer turns a new send stuck').toBe('sending');
    act(() => result.current.accepted());
    expect(result.current.state).toBe('sent');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.state).toBe('stuck');
  });

  // m1: the 30 seconds count from the click, so a request that never answers turns stuck too.
  it('a send that gets no answer turns stuck 30 seconds after the click', () => {
    const { result } = hook();
    act(() => result.current.start());
    act(() => { vi.advanceTimersByTime(STUCK_AFTER_MS - 1); });
    expect(result.current.state).toBe('sending');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.state).toBe('stuck');
  });

  it('taken 20 seconds after the click, it turns stuck 10 seconds later, not 30', () => {
    const { result } = hook();
    act(() => result.current.start());
    act(() => { vi.advanceTimersByTime(20_000); });
    act(() => result.current.accepted());
    expect(result.current.state).toBe('sent');
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current.state).toBe('stuck');
  });

  it('taken only after it was stuck, it stays stuck', () => {
    const { result } = hook();
    act(() => result.current.start());
    act(() => { vi.advanceTimersByTime(STUCK_AFTER_MS + 5_000); });
    act(() => result.current.accepted());
    expect(result.current.state).toBe('stuck');
  });

  it('every place with the same key sees one state; another key is its own', () => {
    const a = hook('gate:alpha');
    const b = hook('gate:alpha');
    const other = hook('gate:beta');
    act(() => a.result.current.start());
    expect(b.result.current.state).toBe('sending');
    expect(other.result.current.state).toBe('idle');
    act(() => b.result.current.accepted());
    expect(a.result.current.state).toBe('sent');
  });

  it('outlives the component that started it (a bar that goes once the job is fetched again)', () => {
    const first = hook();
    act(() => { first.result.current.start(); first.result.current.accepted(); });
    first.unmount();
    const next = hook();
    expect(next.result.current.state).toBe('sent');
    act(() => { vi.advanceTimersByTime(STUCK_AFTER_MS); });
    expect(next.result.current.state).toBe('stuck');
  });
});
