// Queued decisions (packet 2B): a decision made on the site waits here until the laptop it is for
// can take it, then goes to the runner as a command, in the order they were made.
//
//   decide({ person, runnerId, job, command, madeOn, expiresAt })
//       stores it (waiting), audits it, and hands it over at once when the laptop is online and has
//       sent its record since it last connected (release)
//   release(runnerId)
//       for each waiting decision, oldest first: a permission past its expiry is expired; one whose
//       madeOn no longer holds against the laptop's fresh record is changed (nothing runs); the rest
//       go to the runner (ctx.queueCommand, with madeOn and who), which checks madeOn once more
//   result(runner, commandId, { ok, error, stale })
//       the runner's answer: done, failed, or changed
//   cancel(person, id)
//       only before the laptop has it: waiting, or handed over but not yet collected
//   view(row)  what the cards show: { id, kind, state, words, at, canCancel, … }
// Every step writes the site's audit (who, from the site, when, what it was made on, how it ended).

import { randomToken } from '../site/google.js';
import { HttpError } from '../site/http.js';
import { iso } from '../site/sessions.js';
import { stillMadeOn } from '../../dashboard/lib/made-on.js';

export const SHOWN_MS = 60 * 60 * 1000;
const ONLINE_MS = 60 * 1000;

const KIND_WORDS = {
  approve: 'Go', 'send-back': 'No go: send back', stop: 'Stop', reply: 'Your reply', allow: 'Allow', deny: 'Deny', 'stack-merge': 'Merge next',
};

/** The words a card shows for a decision in each state (never colour alone: the words carry it). */
export function stateWords(row, { online = false } = {}) {
  const what = KIND_WORDS[row.kind] ?? 'Your decision';
  switch (row.state) {
    case 'waiting': return `${what}: waiting for your laptop. It runs when the laptop is back.`;
    case 'sent': return online ? `${what}: sent to your laptop. It runs there in a moment.` : `${what}: waiting for your laptop. It runs when the laptop is back.`;
    case 'done': return `${what}: done on your laptop.`;
    case 'failed': return `${what}: your laptop couldn’t do it. ${row.error ?? ''}`.trim();
    case 'changed': return `This changed on your laptop. Look again. ${row.error ?? ''}`.trim();
    case 'cancelled': return `${what}: cancelled. Nothing was sent.`;
    case 'expired': return `${what}: the request ran out before your laptop was back. Nothing was sent.`;
    default: return what;
  }
}

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
/** A person as the audit and the laptop name them: their name, else the first part of their address. */
export const nameOf = (p) => (p?.name || String(p?.email ?? '').split('@')[0] || 'Someone on the site');

export function decisionQueue(ctx, { records, live }) {
  const { db, now } = ctx;

  async function audit({ personId, runnerId, who, action, job, madeOn, outcome, decisionId, from = 'site', at = now(), eid = null }) {
    await db.query(
      `INSERT INTO audit (person_id, runner_id, at, who, from_where, action, job, made_on, outcome, decision_id, eid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (runner_id, eid) DO NOTHING`,
      [personId, runnerId, iso(at), who, from, action, job, madeOn ? JSON.stringify(madeOn) : null, outcome, decisionId, eid],
    );
  }

  async function runnerState(runnerId) {
    const r = (await db.query(
      `SELECT r.last_seen_at, r.revoked_at, s.synced_at, s.hello_at FROM runners r LEFT JOIN record_syncs s ON s.runner_id = r.id WHERE r.id = $1`,
      [runnerId],
    )).rows[0];
    if (!r || r.revoked_at) return { online: false, synced: false };
    const seen = r.last_seen_at ? new Date(r.last_seen_at).getTime() : null;
    const online = seen !== null && now() - seen < ONLINE_MS;
    const synced = Boolean(r.synced_at && r.hello_at && new Date(r.synced_at).getTime() >= new Date(r.hello_at).getTime());
    return { online, synced };
  }

  /** Tells the person's open pages that a job's card changed. */
  async function changed(personId, job) {
    await live.emit(personId, 'thread', job);
    await live.emit(personId, 'change', null);
  }

  /** What the laptop shows now, for checking a decision against: its job page and waiting cards. */
  async function nowOn(runnerId, madeOn) {
    const job = madeOn?.slug && madeOn.kind !== 'permission' ? await records.ofRunner(runnerId, 'job', madeOn.slug) : null;
    const board = madeOn?.kind === 'permission' ? await records.ofRunner(runnerId, 'board', '') : null;
    return { job, permissions: board?.permissions ?? [] };
  }

  async function decide({ person, runnerId, job, command, madeOn, expiresAt = null, kind }) {
    const open = (await db.query(
      `SELECT id FROM decisions WHERE person_id = $1 AND runner_id = $2 AND state IN ('waiting', 'sent') AND made_on = $3::jsonb`,
      [person.id, runnerId, JSON.stringify(madeOn)],
    )).rows[0];
    if (open) throw new HttpError(409, 'You decided this already. It waits for your laptop; cancel it first to decide again.', { code: 'already-queued' });
    const id = `d_${randomToken(12)}`;
    await db.query(
      `INSERT INTO decisions (id, person_id, runner_id, job, kind, command, made_on, state, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'waiting', $8, $9)`,
      [id, person.id, runnerId, job, kind, JSON.stringify(command), JSON.stringify(madeOn), expiresAt, iso(now())],
    );
    await audit({ personId: person.id, runnerId, who: nameOf(person), action: kind, job, madeOn, outcome: 'queued', decisionId: id });
    await release(runnerId);
    await changed(person.id, job);
    return byId(person.id, id);
  }

  async function settle(row, state, { error = null, outcome = state, commandId = null } = {}) {
    const r = await db.query(
      `UPDATE decisions SET state = $2, error = $3, done_at = $4, command_id = COALESCE($5, command_id) WHERE id = $1 AND state IN ('waiting', 'sent') RETURNING id`,
      [row.id, state, error, iso(now()), commandId],
    );
    if (!r.rows.length) return false;
    await audit({ personId: Number(row.person_id), runnerId: Number(row.runner_id), who: 'the site', action: row.kind, job: row.job, madeOn: parse(row.made_on), outcome, decisionId: row.id });
    return true;
  }

  async function release(runnerId) {
    if (!(await db.query(`SELECT 1 FROM decisions WHERE runner_id = $1 AND state = 'waiting' LIMIT 1`, [runnerId])).rows.length) return 0;
    const st = await runnerState(runnerId);
    if (!st.online || !st.synced) return 0;
    const { rows } = await db.query(`SELECT * FROM decisions WHERE runner_id = $1 AND state = 'waiting' ORDER BY created_at, id`, [runnerId]);
    let sent = 0;
    const people = new Map();
    for (const row of rows) {
      const madeOn = parse(row.made_on);
      if (row.expires_at && new Date(row.expires_at).getTime() <= now()) {
        if (await settle(row, 'expired')) people.set(Number(row.person_id), row.job);
        continue;
      }
      const check = stillMadeOn(madeOn, await nowOn(runnerId, madeOn));
      if (!check.ok) {
        if (await settle(row, 'changed', { error: check.why })) people.set(Number(row.person_id), row.job);
        continue;
      }
      // Claim it first, so two instances releasing at once hand it over only once.
      const claim = await db.query(`UPDATE decisions SET state = 'sent', sent_at = $2 WHERE id = $1 AND state = 'waiting' RETURNING id`, [row.id, iso(now())]);
      if (!claim.rows.length) continue;
      const person = (await db.query('SELECT name, email FROM people WHERE id = $1', [row.person_id])).rows[0];
      const commandId = await ctx.queueCommand(runnerId, parse(row.command), { by: Number(row.person_id), madeOn, byName: nameOf(person) });
      await db.query('UPDATE decisions SET command_id = $2 WHERE id = $1', [row.id, commandId]);
      await audit({ personId: Number(row.person_id), runnerId, who: 'the site', action: row.kind, job: row.job, madeOn, outcome: 'sent', decisionId: row.id });
      people.set(Number(row.person_id), row.job);
      sent++;
    }
    for (const [personId, job] of people) await changed(personId, job);
    return sent;
  }

  async function result(runner, commandId, { ok, error, stale }) {
    const row = (await db.query('SELECT * FROM decisions WHERE command_id = $1 AND runner_id = $2', [commandId, runner.id])).rows[0];
    if (!row) return;
    const state = ok ? 'done' : stale ? 'changed' : 'failed';
    if (await settle(row, state, { error: ok ? null : error })) await changed(Number(row.person_id), row.job);
  }

  async function cancel(person, id) {
    const row = (await db.query('SELECT * FROM decisions WHERE id = $1 AND person_id = $2', [id, person.id])).rows[0];
    if (!row) throw new HttpError(404, 'There is no decision like that among yours.');
    const out = await db.tx(async (q) => {
      if (row.state === 'waiting') {
        const r = await q.query(`UPDATE decisions SET state = 'cancelled', done_at = $2 WHERE id = $1 AND state = 'waiting' RETURNING id`, [id, iso(now())]);
        return r.rows.length > 0;
      }
      if (row.state === 'sent' && row.command_id) {
        // Still on the site: the laptop hasn't collected it.
        const c = await q.query('DELETE FROM commands WHERE id = $1 AND delivered_at IS NULL AND done_at IS NULL RETURNING id', [row.command_id]);
        if (!c.rows.length) return false;
        await q.query(`UPDATE decisions SET state = 'cancelled', done_at = $2 WHERE id = $1`, [id, iso(now())]);
        return true;
      }
      return false;
    });
    if (!out) throw new HttpError(409, 'Your laptop has it already, so it can’t be cancelled here.', { code: 'too-late' });
    await audit({ personId: person.id, runnerId: Number(row.runner_id), who: nameOf(person), action: row.kind, job: row.job, madeOn: parse(row.made_on), outcome: 'cancelled', decisionId: id });
    await changed(person.id, row.job);
    return byId(person.id, id);
  }

  async function dismiss(person, id) {
    const r = await db.query('UPDATE decisions SET dismissed_at = $3 WHERE id = $1 AND person_id = $2 RETURNING job', [id, person.id, iso(now())]);
    if (!r.rows.length) throw new HttpError(404, 'There is no decision like that among yours.');
    await changed(person.id, r.rows[0].job);
  }

  function view(row, { online }) {
    const madeOn = parse(row.made_on);
    const state = row.state;
    return {
      id: row.id, kind: row.kind, state, job: row.job, laptopId: Number(row.runner_id),
      words: stateWords({ kind: row.kind, state, error: row.error }, { online }),
      madeOn, at: new Date(row.created_at).toISOString(), expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      waiting: state === 'waiting' || (state === 'sent' && !online),
      canCancel: state === 'waiting' || (state === 'sent' && !row.delivered_at),
      permissionId: madeOn?.kind === 'permission' ? madeOn.id : null,
    };
  }

  /** The decisions a person's cards show now: open ones, and ones settled in the last hour not put away. */
  async function shown(personId) {
    const { rows } = await db.query(
      `SELECT d.*, c.delivered_at, r.last_seen_at FROM decisions d JOIN runners r ON r.id = d.runner_id LEFT JOIN commands c ON c.id = d.command_id
        WHERE d.person_id = $1 AND r.revoked_at IS NULL AND d.dismissed_at IS NULL
          AND (d.state IN ('waiting', 'sent') OR d.created_at > $2)
        ORDER BY d.created_at DESC`,
      [personId, iso(now() - SHOWN_MS)],
    );
    return rows.map((r) => view(r, { online: r.last_seen_at ? now() - new Date(r.last_seen_at).getTime() < ONLINE_MS : false }));
  }

  async function byId(personId, id) {
    return (await shown(personId)).find((d) => d.id === id) ?? null;
  }

  return { decide, release, result, cancel, dismiss, shown, audit, runnerState };
}
