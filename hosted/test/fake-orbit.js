// A pretend Orbit for the hosted tests (and the screenshots run): the four v1 GETs ORBIT-479 has,
// answered in this process as a fetch() (no port, nothing on the network). Each made-up token
// belongs to one made-up person, who has tickets assigned and tickets watched.
//
//   orbit.person(token, { assigned, watching })   tickets as Orbit's tracker rows
//   orbit.fail(token, { status, headers, slowMs }) the next requests with that token answer so
//   orbit.requests                                 every request: { token, path, query }
// Tokens are made-up orbfb_test… strings, never real ones.

export const FAKE_ORBIT = 'https://orbit.example.test';
const PAGE = 50;

/** A made-up token of the right shape: orbfb_ and 43 characters. */
export const testToken = (tag) => `orbfb_test${tag}${'x'.repeat(43)}`.slice(0, 49);

/** One tracker row (TrackerRow, audience tech). */
export function ticket(number, extra = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
    number, type: 'feature', priority: 'medium', severity: 'medium', subject: `Sample ticket ${number}`,
    description: `What ticket ${number} is about, in a sentence.`, status: 'open',
    createdAt: '2026-10-01T09:00:00.000Z', activityAt: '2026-10-20T10:00:00.000Z', assignedToId: '0f9b3c3e-6a51-4c55-9f3e-3d6c0b1b0001',
    ...extra,
  };
}

export function fakeOrbit({ base = FAKE_ORBIT } = {}) {
  const people = new Map();
  const failures = new Map();
  const requests = [];

  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  async function fetchFn(input, init = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (url.origin !== new URL(base).origin) throw new Error(`The fake Orbit was asked for ${url.origin}.`);
    const auth = new Headers(init.headers ?? {}).get('authorization') ?? '';
    const token = auth.replace(/^Bearer /, '');
    requests.push({ token, method: init.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams) });
    const f = failures.get(token);
    if (f?.slowMs) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, f.slowMs);
        init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
      });
    }
    if (f?.status) return json(f.status, { error: 'Pretend failure' }, f.headers);
    if ((init.method ?? 'GET') !== 'GET') return json(405, { error: 'Method not allowed' });
    const who = people.get(token);
    if (!who) return json(401, { error: 'Unauthorized' }, { 'www-authenticate': 'Bearer realm="orbit-feedback"' });
    if (url.pathname === '/api/feedback/v1/tickets') {
      let rows = url.searchParams.get('watched') === 'me' ? who.watching : url.searchParams.get('assignee') === 'me' ? who.assigned : [];
      const statuses = url.searchParams.get('status')?.split(',');
      if (statuses) rows = rows.filter((t) => statuses.includes(t.status));
      const from = url.searchParams.get('from');
      if (from && url.searchParams.get('datefield') === 'updated') rows = rows.filter((t) => t.activityAt.slice(0, 10) >= from);
      const page = Number(url.searchParams.get('page') ?? 1);
      return json(200, { audience: 'tech', total: rows.length, ignored: [], statusCounts: {}, tickets: rows.slice((page - 1) * PAGE, page * PAGE) });
    }
    if (url.pathname === '/api/feedback/v1/views') return json(200, { views: [] });
    return json(404, { error: 'Not found' });
  }

  return {
    base, requests, fetch: fetchFn,
    person(token, { assigned = [], watching = [] } = {}) { people.set(token, { assigned, watching }); return people.get(token); },
    forget(token) { people.delete(token); },
    fail(token, f) { if (f) failures.set(token, f); else failures.delete(token); },
    by: (token) => requests.filter((r) => r.token === token),
  };
}
