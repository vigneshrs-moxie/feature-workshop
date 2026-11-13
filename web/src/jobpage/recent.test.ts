// @vitest-environment node
// The payloads of the jobs opened lately (the newest 8), and fetching one ahead from Jobs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { longJob } from './fixtures/longJob';
import { forgetRecentPages, prefetchPage, prefetchProps, recentPage, rememberPage, RECENT_PAGES } from './recent';
import type { JobPagePayload } from './types';

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
