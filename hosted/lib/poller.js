// The Orbit inbox poller on the site (packet 2C, decision G11, plan §3.1): the tickets assigned to
// each person and the ones they watch, read with their own token, so the Inbox is full even while
// their laptop is closed. It reuses dashboard/lib/orbit.js: the client (four GETs, paging, 401 and
// 429), the inbox queries, inboxItem and the scrubber. Nothing here writes to Orbit.
//
//   runCron({ budgetMs })    Vercel Cron, every 3 minutes (/api/cron/inbox): at most PER_RUN people,
//                            in turn (the one read longest ago first), each claimed so a second run
//                            at the same moment skips them, and none started once the run's time is
//                            nearly up. One person's failure is kept on their own row and the run
//                            goes on to the next.
//   pollPerson(id, opts)     one person's inbox: everything once an hour, else only what changed
//                            (datefield=updated&from=<day>, then to the minute: lib/orbit.js)
//   checkToken(token)        the one call that checks a pasted token before it is kept
//
// Every Orbit request is cut off at the run's deadline, well inside the function's 60 seconds
// (vercel.json maxDuration). A 401 marks the token refused (the Inbox's banner), and it isn't
// tried again until a new one is pasted; a 429 waits for Retry-After. Log lines name a person by
// their id only and are scrubbed (lib/orbit.js scrub), so no token or email reaches the logs.

import { API_BASE, INBOX_QUERIES, OrbitError, inboxItem, normalizeOrbitUrl, orbitClient, scrub, scrubDeep } from '../../dashboard/lib/orbit.js';
import { TokenKeyError } from './token-store.js';

export const PER_RUN = 25;
/** How long one cron run may spend: well inside vercel.json's maxDuration of 60 seconds. */
export const RUN_BUDGET_MS = 40_000;
/** A person isn't started with less than this left. */
export const PERSON_MIN_MS = 5_000;
/** One person's read from the page (Read now, or the open Inbox's minute). */
export const PERSON_BUDGET_MS = 20_000;
/** The open Inbox asks for a refresh at most this often; the cron job doesn't read again sooner. */
export const REFRESH_MS = 60_000;
export const CRON_EVERY_MS = 3 * 60_000;
/** Between full reads only what changed is fetched; a full read drops the tickets that left. */
export const FULL_EVERY_MS = 60 * 60_000;
const DESCRIPTION_MAX = 2000;
const CHECK_TIMEOUT_MS = 15_000;

const iso = (ms) => new Date(ms).toISOString();
const errorWords = 'Couldn’t read your inbox from Orbit this time. It tries again in a few minutes.';

/** Orbit's address from ORBIT_BASE_URL, or null when it isn't set or isn't usable. */
export function orbitUrlOf(config) {
  try { return config.orbitBaseUrl ? normalizeOrbitUrl(config.orbitBaseUrl) : null; } catch { return null; }
}

/** fetch, cut off at `deadline` (on `clock`). */
function boxed(fetchFn, deadline, clock) {
  return (url, init = {}) => {
    const left = deadline - clock();
    if (left <= 0) return Promise.reject(Object.assign(new Error('Out of time.'), { name: 'AbortError' }));
    const signals = [AbortSignal.timeout(left)];
    if (init.signal) signals.push(init.signal);
    return fetchFn(url, { ...init, signal: AbortSignal.any(signals) });
  };
}

/** The ticket as the Inbox shows it, with its description cut short, scrubbed. */
function storedItem(row, { why, audience, orbitUrl }) {
  const item = inboxItem(row, { why, audience, orbitUrl });
  const text = typeof row.description === 'string' ? row.description : '';
  return scrubDeep({ ...item, description: text ? text.slice(0, DESCRIPTION_MAX) : null });
}

/**
 * db, tokens (lib/token-store.js), config, fetch (how the site reaches Orbit), now (the site's
 * clock, for what is stored), clock (real time, for deadlines), log (one line at a time).
 */
export function createPoller({ db, tokens, config, fetch: fetchFn, now = () => Date.now(), clock = () => Date.now(), log = (line) => console.log(line) }) {
  const say = (line) => log(scrub(line));

  /**
   * Takes this person's turn: true when their token is usable and nobody read their inbox in the
   * last `gapMs` (the cron job and an open page never read one inbox twice at once).
   */
  async function claim(personId, gapMs) {
    const t = now();
    const r = await db.query(
      `UPDATE orbit_tokens SET tried_at = $2
        WHERE person_id = $1 AND refused_at IS NULL AND (expires_at IS NULL OR expires_at > $2)
          AND (wait_until IS NULL OR wait_until <= $2) AND (tried_at IS NULL OR tried_at <= $3)
        RETURNING polled_at, full_at`,
      [personId, iso(t), iso(t - gapMs)],
    );
    return r.rows[0] ?? null;
  }

  async function fail(personId, err) {
    const t = now();
    if (err instanceof TokenKeyError) {
      await db.query('UPDATE orbit_tokens SET refused_at = $2, error = $3, error_kind = $4 WHERE person_id = $1', [personId, iso(t), err.message, 'key']);
      return 'key';
    }
    if (err instanceof OrbitError) {
      const msg = scrub(err.message);
      if (err.kind === 'auth') await db.query('UPDATE orbit_tokens SET refused_at = $2, error = $3, error_kind = $4 WHERE person_id = $1', [personId, iso(t), msg, 'auth']);
      else if (err.kind === 'rate') await db.query('UPDATE orbit_tokens SET wait_until = $2, error = $3, error_kind = $4 WHERE person_id = $1', [personId, iso(t + (err.retryAfterMs ?? 60_000)), msg, 'rate']);
      else await db.query('UPDATE orbit_tokens SET error = $2, error_kind = $3 WHERE person_id = $1', [personId, msg, err.kind]);
      return err.kind;
    }
    await db.query('UPDATE orbit_tokens SET error = $2, error_kind = $3 WHERE person_id = $1', [personId, errorWords, 'http']);
    return 'http';
  }

  /**
   * One person's inbox, now. gapMs: skip it when it was read more recently (REFRESH_MS from the
   * page). Resolves { ok, skipped?, kind?, full?, count? }; never throws for an Orbit problem.
   */
  async function pollPerson(personId, { budgetMs = PERSON_BUDGET_MS, deadline = clock() + budgetMs, gapMs = REFRESH_MS } = {}) {
    const orbitUrl = orbitUrlOf(config);
    if (!orbitUrl || tokens.problem()) return { ok: false, skipped: true };
    const turn = await claim(personId, gapMs);
    if (!turn) return { ok: false, skipped: true };
    const started = now();
    try {
      const token = await tokens.open(personId);
      if (!token) return { ok: false, skipped: true };
      const fullAt = turn.full_at ? new Date(turn.full_at).getTime() : null;
      const full = !turn.polled_at || fullAt === null || started - fullAt >= FULL_EVERY_MS;
      const since = full ? null : new Date(turn.polled_at).toISOString();
      const client = orbitClient({ baseUrl: orbitUrl, getToken: async () => token, fetchFn: boxed(fetchFn, deadline, clock), now });
      const got = new Map(); // number → { row, audience, why }
      for (const q of INBOX_QUERIES) {
        const list = await client.listTickets(q.query, { since });
        for (const row of list.tickets) {
          if (!Number.isInteger(row?.number)) continue;
          const had = got.get(row.number);
          got.set(row.number, { row, audience: list.audience, why: new Set([...(had?.why ?? []), q.id]) });
        }
      }
      await db.tx(async (q) => {
        const kept = new Map();
        if (full) await q.query('DELETE FROM orbit_inbox WHERE person_id = $1', [personId]);
        else {
          const { rows } = await q.query('SELECT number, item FROM orbit_inbox WHERE person_id = $1 AND number = ANY($2::int[])', [personId, [...got.keys()]]);
          for (const r of rows) kept.set(Number(r.number), (typeof r.item === 'string' ? JSON.parse(r.item) : r.item)?.why ?? []);
        }
        for (const [number, g] of got) {
          const why = [...new Set([...(kept.get(number) ?? []), ...g.why])].sort();
          const item = storedItem(g.row, { why, audience: g.audience, orbitUrl });
          await q.query(
            `INSERT INTO orbit_inbox (person_id, number, ticket_key, item, changed_at, stored_at) VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (person_id, number) DO UPDATE SET ticket_key = EXCLUDED.ticket_key, item = EXCLUDED.item, changed_at = EXCLUDED.changed_at, stored_at = EXCLUDED.stored_at`,
            [personId, number, item.key, JSON.stringify(item), item.changedAt && !Number.isNaN(Date.parse(item.changedAt)) ? item.changedAt : null, iso(now())],
          );
        }
        await q.query(
          'UPDATE orbit_tokens SET polled_at = $2, full_at = CASE WHEN $3 THEN $2 ELSE full_at END, error = NULL, error_kind = NULL, wait_until = NULL WHERE person_id = $1',
          [personId, iso(started), full],
        );
      });
      return { ok: true, full, count: got.size };
    } catch (err) {
      const outOfTime = clock() >= deadline;
      const e = outOfTime && !(err instanceof TokenKeyError) ? new OrbitError('Orbit was slow to answer, so your inbox is read again in a few minutes.', { kind: 'network' }) : err;
      const kind = await fail(personId, e).catch(() => 'http');
      if (!(e instanceof OrbitError) && !(e instanceof TokenKeyError)) say(`inbox: person ${personId}: ${String(e?.message ?? e).slice(0, 300)}`);
      return { ok: false, kind };
    }
  }

  /** The cron job's run: whoever is due, in turn, inside the time box. Resolves counts only. */
  async function runCron({ budgetMs = RUN_BUDGET_MS, perRun = PER_RUN } = {}) {
    const begin = clock();
    const deadline = begin + budgetMs;
    const out = { polled: 0, failed: 0, skipped: 0, left: 0 };
    if (!orbitUrlOf(config) || tokens.problem()) {
      say(`inbox: not read: ${tokens.problem()?.message ?? 'ORBIT_BASE_URL isn’t set in Vercel.'}`);
      return { ...out, notSetUp: true };
    }
    const t = now();
    const { rows } = await db.query(
      `SELECT person_id FROM orbit_tokens
        WHERE refused_at IS NULL AND (expires_at IS NULL OR expires_at > $1) AND (wait_until IS NULL OR wait_until <= $1)
        ORDER BY tried_at ASC NULLS FIRST, person_id LIMIT $2`,
      [iso(t), perRun],
    );
    for (let i = 0; i < rows.length; i++) {
      if (deadline - clock() < PERSON_MIN_MS) { out.left = rows.length - i; break; }
      const personId = Number(rows[i].person_id);
      try {
        const r = await pollPerson(personId, { deadline, gapMs: REFRESH_MS });
        if (r.ok) out.polled++; else if (r.skipped) out.skipped++; else out.failed++;
      } catch (err) {
        // The database, not Orbit: this person is left as they were; the others still go.
        out.failed++;
        say(`inbox: person ${personId}: ${String(err?.message ?? err).slice(0, 300)}`);
      }
    }
    say(`inbox: read ${out.polled}, failed ${out.failed}, skipped ${out.skipped}, left for the next run ${out.left} (${Math.round((clock() - begin) / 100) / 10} s)`);
    return out;
  }

  /**
   * One GET with a pasted token (page 1 of what is assigned to you), before it is kept. Throws
   * OrbitError in plain words; resolves when Orbit took it.
   */
  async function checkToken(token) {
    const orbitUrl = orbitUrlOf(config);
    if (!orbitUrl) throw new OrbitError('ORBIT_BASE_URL isn’t set in Vercel, so the site can’t reach Orbit yet.', { kind: 'settings' });
    const params = new URLSearchParams(INBOX_QUERIES[0].query);
    params.set('page', '1');
    let res;
    try {
      res = await fetchFn(`${orbitUrl}${API_BASE}/tickets?${params}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
    } catch {
      throw new OrbitError('The site couldn’t reach Orbit to check the token. Try again in a moment.', { kind: 'network' });
    }
    if (res.status === 401) throw new OrbitError('Orbit didn’t take that token: it may have expired or been revoked. Make a new one on Orbit’s API tokens page.', { kind: 'auth', status: 401 });
    if (res.status === 403) throw new OrbitError('That token can’t read tickets: it needs the tickets:read scope.', { kind: 'scope', status: 403 });
    if (res.status === 429) throw new OrbitError('Orbit asked the site to slow down. Try again in a minute.', { kind: 'rate', status: 429 });
    if (!res.ok) throw new OrbitError(`Orbit answered ${res.status} when the site checked the token. Try again in a moment.`, { kind: 'http', status: res.status });
    await res.body?.cancel?.().catch(() => {});
  }

  return { pollPerson, runCron, checkToken, claim };
}
