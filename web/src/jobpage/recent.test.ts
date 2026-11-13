// @vitest-environment node
// The payloads of the jobs opened lately (the newest 8), and fetching one ahead from Jobs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { longJob } from './fixtures/longJob';
import { forgetRecentPages, HOVER_MS, prefetchPage, prefetchProps, recentPage, rememberPage, RECENT_PAGES } from './recent';
import type { JobPagePayload } from './types';

// The app's one event stream, faked: recent.ts taps it to forget everything on a resync.
const taps = vi.hoisted(() => new Set<(e: { type: string }) => void>());
vi.mock('../state/live', () => ({ onLiveEvent: (fn: (e: { type: string }) => void) => { taps.add(fn); return () => { taps.delete(fn); }; } }));

const page = (slug: string, v = 1) => ({ ...(JSON.parse(JSON.stringify(longJob.payload)) as JobPagePayload), slug, v });

afterEach(() => { forgetRecentPages(); });

describe('the jobs opened lately', () => {
  it('keeps the newest 8; one remembered again counts as new', () => {
    for (let i = 0; i < RECENT_PAGES; i++) rememberPage(page(`job-${i}`));
    rememberPage(page('job-0', 2));
    rememberPage(page('job-8'));
    expect(RECENT_PAGES).toBe(8);
    expect(recentPage('job-1')).toBeNull();
    expect(recentPage('job-0')?.v).toBe(2);
    expect(recentPage('job-8')?.slug).toBe('job-8');
  });

  it('fetches a page ahead once, without a v or a viewer, and keeps it; nothing when one is kept; a failure is quiet', async () => {
    const get = vi.fn(async (path: string) => { if (path.includes('broken')) throw new Error('Starbase answered 500.'); return page(decodeURIComponent(path.split('/')[3])); });
    const client = { get } as unknown as ApiClient;
    await Promise.all([prefetchPage(client, 'alpha'), prefetchPage(client, 'alpha')]);
    expect(get.mock.calls.map((c) => c[0])).toEqual(['/api/job/alpha/page']);
    expect(recentPage('alpha')?.slug).toBe('alpha');
    await prefetchPage(client, 'alpha');
    expect(get).toHaveBeenCalledTimes(1);
    await prefetchPage(client, 'broken');
    expect(recentPage('broken')).toBeNull();
  });

  it('a row asks ahead on hover and focus only while the new page is on', async () => {
    const get = vi.fn(async () => page('beta'));
    const client = { get } as unknown as ApiClient;
    expect(prefetchProps(client, 'beta', false)).toEqual({});
    const props = prefetchProps(client, 'beta', true);
    props.onPointerEnter?.();
    props.onFocus?.();
    await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('Task 7 fix round 2', () => {
  it('the pointer has to rest 150 ms on a row before its page is asked for; leaving cancels it; focus asks at once', async () => {
    vi.useFakeTimers();
    try {
      const get = vi.fn(async (path: string) => page(decodeURIComponent(path.split('/')[3])));
      const client = { get } as unknown as ApiClient;
      const a = prefetchProps(client, 'alpha', true);
      a.onPointerEnter?.();
      vi.advanceTimersByTime(HOVER_MS - 1);
      a.onPointerLeave?.();
      vi.advanceTimersByTime(500);
      expect(get).not.toHaveBeenCalled();
      a.onPointerEnter?.();
      vi.advanceTimersByTime(HOVER_MS);
      expect(get.mock.calls.map((c) => c[0])).toEqual(['/api/job/alpha/page']);
      const b = prefetchProps(client, 'beta', true);
      b.onFocus?.();
      expect(get).toHaveBeenCalledTimes(2);
      expect(HOVER_MS).toBe(150);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pages fetched ahead never push out jobs he opened; opening one counts it as opened', async () => {
    for (let i = 0; i < RECENT_PAGES; i++) rememberPage(page(`opened-${i}`));
    const get = vi.fn(async (path: string) => page(decodeURIComponent(path.split('/')[3])));
    const client = { get } as unknown as ApiClient;
    for (let i = 0; i < 12; i++) await prefetchPage(client, `ahead-${i}`);
    for (let i = 0; i < RECENT_PAGES; i++) expect(recentPage(`opened-${i}`)?.slug).toBe(`opened-${i}`);
    expect(recentPage('ahead-11')?.slug).toBe('ahead-11');
    expect(recentPage('ahead-0')).toBeNull();
    // Opened after it was fetched ahead: now among the opened ones, pushing out the oldest of those.
    rememberPage(page('ahead-11', 2));
    expect(recentPage('opened-0')).toBeNull();
    expect(recentPage('ahead-11')?.v).toBe(2);
  });

  it('a resync (Starbase restarted, its versions count from 1 again) forgets every kept page', async () => {
    rememberPage(page('alpha'));
    const get = vi.fn(async () => page('beta'));
    await prefetchPage({ get } as unknown as ApiClient, 'beta');
    expect(taps.size).toBe(1);
    for (const t of [...taps]) t({ type: 'change' });
    expect(recentPage('alpha')).not.toBeNull();
    for (const t of [...taps]) t({ type: 'resync' });
    expect(recentPage('alpha')).toBeNull();
    expect(recentPage('beta')).toBeNull();
  });
});
