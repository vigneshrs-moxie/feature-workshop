// Talking to the dashboard. Reads are plain GETs. Writes (POST, DELETE) carry JSON and the page token
// (header X-Workshop-Token, from /api/meta); the dashboard refuses a write without it (403). The
// token changes when the dashboard restarts, so on a 403 the client fetches /api/meta once more
// and retries the write once with the new token.
// Hosted mode (packet 2A: /api/meta says mode 'hosted', or createApi({ hosted: true })): the site
// knows you by its session cookie instead, so writes carry no page token and a 403 is final; a 401
// means you aren't signed in (ApiError.status 401, which the hosted screens answer with Sign in).

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
  /** A PUT (replace something whole, like a job's notes), sent like a write. */
  put<T>(path: string, body?: unknown): Promise<T>;
  /** A DELETE, sent like a write (JSON and the page token). */
  del<T>(path: string): Promise<T>;
  meta(): Promise<Meta>;
  snapshot(): Promise<Snapshot>;
  /** Use this token for writes (the snapshot carries one, saving a call). */
  setToken(token: string | null | undefined): void;
  /** Whether this is the hosted site (the session cookie, no page token). */
  hosted?(): boolean;
}

async function readError(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  const message = typeof body.error === 'string' ? body.error : `The dashboard answered ${res.status}.`;
  return new ApiError(res.status, message, body);
}

export function createApi({ fetch: f = (...a: Parameters<Fetch>) => fetch(...a), base = '', hosted: startHosted = false }: { fetch?: Fetch; base?: string; hosted?: boolean } = {}): ApiClient {
  let token: string | null = null;
  let hosted = startHosted;

  async function get<T>(path: string): Promise<T> {
    const res = await f(base + path, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!res.ok) throw await readError(res);
    return res.json() as Promise<T>;
  }

  async function meta(): Promise<Meta> {
    const m = await get<Meta>('/api/meta');
    if (m.mode === 'hosted') hosted = true;
    token = hosted ? null : m.token ?? null;
    return m;
  }

  async function writeOnce(method: string, path: string, body: unknown): Promise<Response> {
    return f(base + path, {
      method,
      credentials: 'same-origin',
      headers: hosted ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Workshop-Token': token ?? '' },
      body: JSON.stringify(body ?? {}),
    });
  }

  async function write<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!token && !hosted) await meta();
    let res = await writeOnce(method, path, body);
    if (res.status === 403 && !hosted) {
      // Most likely the dashboard restarted and the token changed: fetch it again, retry once.
      await meta();
      res = await writeOnce(method, path, body);
    }
    if (!res.ok) throw await readError(res);
    return res.json() as Promise<T>;
  }

  const post = <T,>(path: string, body?: unknown) => write<T>('POST', path, body);
  const put = <T,>(path: string, body?: unknown) => write<T>('PUT', path, body);
  const del = <T,>(path: string) => write<T>('DELETE', path, {});

  async function snapshot(): Promise<Snapshot> {
    const s = await get<Snapshot>('/api/snapshot');
    if (s.meta?.token) token = s.meta.token;
    return s;
  }

  return { get, post, put, del, meta, snapshot, setToken: (t) => { token = t || null; }, hosted: () => hosted };
}
