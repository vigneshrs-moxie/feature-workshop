// The mirrored job record on the site (packet 2B): the `records` table, each laptop's parts as it
// last sent them (dashboard/runner/mirror.js says what each holds). Every read is for one person:
// a part is found only among that person's own laptops that are still paired.

import crypto from 'node:crypto';
import { canonicalKey } from '../../dashboard/lib/orbit.js';
import { fromWire } from '../../dashboard/runner/mirror.js';
import { iso } from '../site/sessions.js';

/** The parts a laptop may send, and whether each is about one job (its key is the slug, or starts with it). */
export const KINDS = Object.freeze({
  board: null, job: 'key', docs: 'key', doc: 'line', decisions: 'key', evidence: 'key',
  stacks: null, stack: null, 'stack-part': null, 'inbox-suggest': null,
});
const KEY = /^[^\0]{0,700}$/;

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const hashOf = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);

const SUGGEST_PICKS = 3;
const SUGGEST_REASON = 300;
const SUGGEST_LIST = 100;
const SUGGEST_ITEM = 80;
const SUGGEST_AHEAD = 5 * 60_000;

/**
 * The laptop's suggestion as the site keeps and shows it, or null when it isn't the right shape:
 * { at: a date string, picks: up to 3 { key: ORBIT-<n>, reason: text }, forList: up to 100 short strings }.
 * An `at` more than 5 minutes ahead of the site's `now` is refused. The reason is the model's words about a ticket: plain text, cut to 300 characters.
 */
export function cleanSuggestion(v, now = Date.now()) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (typeof v.at !== 'string' || v.at.length > 40 || Number.isNaN(Date.parse(v.at))) return null;
  if (Date.parse(v.at) > now + SUGGEST_AHEAD) return null; // a laptop whose clock runs ahead can't pin its suggestion
  if (!Array.isArray(v.picks) || v.picks.length > SUGGEST_PICKS || !Array.isArray(v.forList) || !v.forList.every((x) => typeof x === 'string')) return null;
  const picks = [];
  for (const p of v.picks) {
    if (!p || typeof p !== 'object' || typeof p.key !== 'string' || typeof p.reason !== 'string') return null;
    const key = canonicalKey(p.key);
    if (!key || key !== p.key) return null;
    if (picks.some((x) => x.key === key)) continue; // a ticket named twice is one pick
    picks.push({ key, reason: p.reason.slice(0, SUGGEST_REASON) });
  }
  return { at: new Date(v.at).toISOString(), picks, forList: v.forList.slice(0, SUGGEST_LIST).map((x) => x.slice(0, SUGGEST_ITEM)) };
}

/** The job a part belongs to, from its kind and key. */
export function jobOfRecord(kind, key) {
  const how = KINDS[kind];
  if (how === 'key') return key || null;
  if (how === 'line') return key.split('\n')[0] || null;
  return null;
}

export function recordStore({ db, now }) {
  return {
    /** Stores one part; null removes it (a job's removal takes all its parts). Resolves whether anything changed. */
    async put(runner, kind, key, value) {
      if (!Object.hasOwn(KINDS, kind)) throw new Error(`There is no part called “${String(kind).slice(0, 40)}”.`);
      if (typeof key !== 'string' || !KEY.test(key)) throw new Error('A part needs its key.');
      const job = jobOfRecord(kind, key);
      if (value === null) {
        const r = kind === 'job'
          ? await db.query('DELETE FROM records WHERE runner_id = $1 AND (job = $2 OR (kind = $3 AND key = $4))', [runner.id, key, kind, key])
          : await db.query('DELETE FROM records WHERE runner_id = $1 AND kind = $2 AND key = $3', [runner.id, kind, key]);
        return r.rowCount > 0;
      }
      const h = hashOf(value);
      const r = await db.query(
        `INSERT INTO records (runner_id, person_id, kind, key, job, value, hash, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (runner_id, kind, key) DO UPDATE SET value = EXCLUDED.value, hash = EXCLUDED.hash, updated_at = EXCLUDED.updated_at, job = EXCLUDED.job
         WHERE records.hash <> EXCLUDED.hash RETURNING kind`,
        [runner.id, runner.personId, kind, key, job, JSON.stringify(value), h, iso(now())],
      );
      return r.rows.length > 0;
    },

    /** One part on one of the person's laptops (the freshest, if two have it), as the page reads it: { value, runnerId, updatedAt } or null. */
    async get(personId, kind, key) {
      const { rows } = await db.query(
        `SELECT rec.value, rec.runner_id, rec.updated_at FROM records rec JOIN runners r ON r.id = rec.runner_id
          WHERE rec.person_id = $1 AND r.person_id = $1 AND r.revoked_at IS NULL AND rec.kind = $2 AND rec.key = $3
          ORDER BY rec.updated_at DESC LIMIT 1`,
        [personId, kind, key],
      );
      const r = rows[0];
      return r ? { value: fromWire(parse(r.value)), runnerId: Number(r.runner_id), updatedAt: new Date(r.updated_at).toISOString() } : null;
    },

    /** Every part of a kind across the person's laptops: [{ value, runnerId, key, updatedAt }]. */
    async all(personId, kind) {
      const { rows } = await db.query(
        `SELECT rec.value, rec.runner_id, rec.key, rec.updated_at FROM records rec JOIN runners r ON r.id = rec.runner_id
          WHERE rec.person_id = $1 AND r.person_id = $1 AND r.revoked_at IS NULL AND rec.kind = $2 ORDER BY rec.updated_at DESC`,
        [personId, kind],
      );
      return rows.map((r) => ({ value: fromWire(parse(r.value)), runnerId: Number(r.runner_id), key: r.key, updatedAt: new Date(r.updated_at).toISOString() }));
    },

    /** One laptop's own part (the queue checks a decision against the laptop it is for). */
    async ofRunner(runnerId, kind, key) {
      const r = (await db.query('SELECT value FROM records WHERE runner_id = $1 AND kind = $2 AND key = $3', [runnerId, kind, key])).rows[0];
      return r ? fromWire(parse(r.value)) : null;
    },
  };
}
