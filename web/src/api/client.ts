// Talking to the dashboard. Reads are plain GETs. Writes are POSTs with JSON and the page token
// (header X-Workshop-Token, from /api/meta); the dashboard refuses a write without it (403). The
// token changes when the dashboard restarts, so on a 403 the client fetches /api/meta once more
// and retries the write once with the new token.

import type { Meta, Snapshot } from './types';

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type Fetch = typeof fetch;

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  meta(): Promise<Meta>;
  snapshot(): Promise<Snapshot>;
  /** Use this token for writes (the snapshot carries one, saving a call). */
  setToken(token: string | null | undefined): void;
}

async function readError(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  const message = typeof body.error === 'string' ? body.error : `The dashboard answered ${res.status}.`;
  return new ApiError(res.status, message, body);
}

export function createApi({ fetch: f = (...a: Parameters<Fetch>) => fetch(...a), base = '' }: { fetch?: Fetch; base?: string } = {}): ApiClient {
  let token: string | null = null;

  async function get<T>(path: string): Promise<T> {
    const res = await f(base + path, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!res.ok) throw await readError(res);
    return res.json() as Promise<T>;
  }

  async function meta(): Promise<Meta> {
    const m = await get<Meta>('/api/meta');
    token = m.token ?? null;
    return m;
  }

  async function postOnce(path: string, body: unknown): Promise<Response> {
    return f(base + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Workshop-Token': token ?? '' },
      body: JSON.stringify(body ?? {}),
    });
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    if (!token) await meta();
    let res = await postOnce(path, body);
    if (res.status === 403) {
      // Most likely the dashboard restarted and the token changed: fetch it again, retry once.
      await meta();
      res = await postOnce(path, body);
    }
    if (!res.ok) throw await readError(res);
    return res.json() as Promise<T>;
  }

  async function snapshot(): Promise<Snapshot> {
    const s = await get<Snapshot>('/api/snapshot');
    if (s.meta?.token) token = s.meta.token;
    return s;
  }

  return { get, post, meta, snapshot, setToken: (t) => { token = t || null; } };
}
