import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './client';

type Reply = { status: number; body: unknown };
const failure = (p: Promise<unknown>) => p.then(() => { throw new Error('expected the call to fail'); }, (e: ApiError) => e);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fake dashboard: answers /api/meta with the current token; a write passes only with it. */
function dashboard(tokens: string[], onWrite: (body: unknown) => Reply = () => ({ status: 200, body: { ok: true } })) {
  let metaCalls = 0;
  const writes: Array<{ token: string | null; contentType: string | null }> = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path === '/api/meta') { const token = tokens[Math.min(metaCalls, tokens.length - 1)]; metaCalls++; return json(200, { token }); }
    if (path === '/api/snapshot') return json(200, { v: 2, seq: 1, epoch: 'e', meta: { token: 'from-snapshot' }, jobs: [] });
    const headers = new Headers(init?.headers);
    writes.push({ token: headers.get('X-Workshop-Token'), contentType: headers.get('Content-Type') });
    const current = tokens[Math.min(Math.max(metaCalls - 1, 0), tokens.length - 1)];
    if (headers.get('X-Workshop-Token') !== current) return json(403, { error: 'This action must come from the Feature Workshop page.' });
    const r = onWrite(JSON.parse(String(init?.body)));
    return json(r.status, r.body);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, writes, metaCalls: () => metaCalls };
}

describe('api client', () => {
  it('fetches the token before the first write and sends JSON with it', async () => {
    const d = dashboard(['t1']);
    const api = createApi({ fetch: d.fetch });
    await expect(api.post('/api/settings', { policy: 'ask-all' })).resolves.toEqual({ ok: true });
    expect(d.metaCalls()).toBe(1);
    expect(d.writes).toEqual([{ token: 't1', contentType: 'application/json' }]);
  });

  it('on 403 fetches the token again once and retries the write', async () => {
    // The page holds t1; the dashboard restarted and now wants t2.
    const d = dashboard(['t1', 't2']);
    const api = createApi({ fetch: d.fetch });
    api.setToken('stale');
    await expect(api.post('/api/settings', {})).resolves.toEqual({ ok: true });
    expect(d.writes.map((w) => w.token)).toEqual(['stale', 't1']);
    expect(d.metaCalls()).toBe(1);
  });

  it('gives up after one retry, with the dashboard’s message', async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) => (String(url) === '/api/meta' ? json(200, { token: 'x' }) : json(403, { error: 'Wrong origin.' })));
    const api = createApi({ fetch: fetch as unknown as typeof globalThis.fetch });
    const err = await failure(api.post('/api/settings', {}));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.message).toBe('Wrong origin.');
    expect(fetch.mock.calls.filter(([u]) => String(u) !== '/api/meta')).toHaveLength(2);
  });

  it('does not retry other errors, and keeps their details', async () => {
    const d = dashboard(['t1'], () => ({ status: 409, body: { error: 'Busy.', code: 'limited' } }));
    const api = createApi({ fetch: d.fetch });
    const err = await failure(api.post('/api/job/x/send', { text: 'hi' }));
    expect(err.status).toBe(409);
    expect(err.body.code).toBe('limited');
    expect(d.writes).toHaveLength(1);
  });

  it('takes the token from the snapshot, saving a call', async () => {
    const d = dashboard(['from-snapshot']);
    const api = createApi({ fetch: d.fetch });
    await api.snapshot();
    await api.post('/api/settings', {});
    expect(d.writes[0].token).toBe('from-snapshot');
    expect(d.metaCalls()).toBe(0);
  });

  it('a failed read throws ApiError with a plain message when the body is not JSON', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 500 }));
    const api = createApi({ fetch: fetch as unknown as typeof globalThis.fetch });
    const err = await failure(api.get('/api/snapshot'));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('The dashboard answered 500.');
  });
});
