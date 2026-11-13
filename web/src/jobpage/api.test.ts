// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { jobApi, isSame } from './api';

function fakeClient(answer: unknown = {}) {
  const get = vi.fn(async () => answer);
  return { client: { get } as unknown as ApiClient, get };
}

describe('job page api', () => {
  it('asks for the payload, with the v it holds once it holds one', async () => {
    const { client, get } = fakeClient({ v: 3 });
    const api = jobApi(client);
    await api.page('orbit-905 export', null);
    await api.page('orbit-905 export', 3);
    expect(get.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      '/api/job/orbit-905%20export/page',
      '/api/job/orbit-905%20export/page?v=3',
    ]);
  });

  it('asks for one body by its id, the id escaped', async () => {
    const { client, get } = fakeClient({ id: 'brief:briefs/015-review.md' });
    await jobApi(client).item('orbit-905', 'brief:briefs/015-review.md');
    expect((get.mock.calls[0] as unknown[])[0]).toBe('/api/job/orbit-905/item?id=brief%3Abriefs%2F015-review.md');
  });

  it('tells the "same" answer from a payload', () => {
    expect(isSame({ same: true, v: 4 })).toBe(true);
    expect(isSame({ v: 4, slug: 'x' } as never)).toBe(false);
  });
});
