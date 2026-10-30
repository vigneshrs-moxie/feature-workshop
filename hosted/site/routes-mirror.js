// The full mirror (packet 2B): the hosted Desk, Jobs, a Job, the Stage, Stacks and a part, served
// from each person's mirrored record, and every decision made here queued for the laptop.
//
// Up from the runner (POST /api/runner/events, after 2A's check and the "never carries" check):
//   record   { kind, key, value }: one part of the job record (lib/records.js), or null when gone.
//            { kind: 'synced' }: the laptop has sent its whole record since it connected, so the
//            decisions waiting for it can be checked against that and handed over (lib/queue.js).
//   audit    a decision as the laptop's audit wrote it (from the laptop, or the outcome of one of
//            the site's): kept in the site's audit copy.
// Every change tells the person's open pages (lib/live.js) once per batch: 'change' (the board) or
// 'thread' (one job's page).
//
// The routes the page reads: the dashboard's own job and Stage routes (dashboard/site/routes-jobs.js
// and routes-stage.js), mounted here as they are, with a mirror runner:
//   read     answers from the person's mirrored record (only their own laptops; anyone else's job,
//            or one that isn't there, is a 404). What only the laptop has (Try it, the Screens page,
//            older conversation, notes) says so in words: "Your laptop is off…" or "on your laptop".
//   handle   a decision (Go / No go, send back, stop, a reply, allow or deny, merge next) is queued
//            for the laptop with what it was made on; a commit's diff is asked of the laptop live,
//            sealed to this request (lib/sealed.js) and answered to this page only, never stored.
// And its own:
//   GET  /api/snapshot              the store's snapshot: every laptop's cards and waiting permissions,
//                                   each with its laptop and any decision waiting for it
//   GET  /api/events?v=2&since=     live updates (server-sent events; lib/live.js)
//   GET  /api/events/poll?since=    the same, once: the page's every-5-seconds fallback
//   GET  /api/stacks[/…]            the Stacks home, a stack, a part (its file diff: on the laptop)
//   POST /api/stacks/:slug/merge    merge next: queued like any decision
//   POST /api/decisions/:id/cancel  cancel a decision the laptop hasn't collected
//   POST /api/decisions/:id/dismiss put away a changed or failed one
//   GET  /api/decisions             the decisions the cards show, and the last 50 audit lines

import { AsyncLocalStorage } from 'node:async_hooks';
import dashboardJobRoutes from '../../dashboard/site/routes-jobs.js';
import dashboardStageRoutes from '../../dashboard/site/routes-stage.js';
import { decisionKind, madeOnFor } from '../../dashboard/lib/made-on.js';
import { LOCAL_COMMANDS, parseCommand } from '../../dashboard/lib/protocol.js';
import { answerKeys, open } from '../../dashboard/lib/sealed.js';
import { HttpError, API_HEADERS, send, sendJson } from './http.js';
import { iso } from './sessions.js';
import { liveEvents, resumeFrom, HOSTED_EPOCH } from '../lib/live.js';
import { decisionQueue, nameOf } from '../lib/queue.js';
import { recordStore, KINDS } from '../lib/records.js';

export const OFF_WORDS = 'Your laptop is off; this shows when it’s back.';
export const ON_LAPTOP = 'This is done on your laptop for now. Open the job there.';
const LIVE_MS = 20 * 1000;
const ANSWER_KEEP_MS = 60 * 1000;
const WRITES = new Set(['POST', 'PUT', 'DELETE']);

/** The dashboard's HttpError (lib/http-guard.js) as the site's own, so the router answers it in words. */
const asSiteError = (err) => (err && !(err instanceof HttpError) && Number.isInteger(err.status) ? new HttpError(err.status, err.message, err.extra ?? {}) : err);

export default function mirrorRoutes(ctx) {
  const { db, now } = ctx;
  const records = recordStore({ db, now });
  const live = liveEvents({ db, now, timers: ctx.timers, onClose: ctx.onClose });
  const queue = decisionQueue(ctx, { records, live });
  ctx.mirror = { records, live, queue };
  const als = new AsyncLocalStorage();
  const who = () => {
    const p = als.getStore()?.person;
    if (!p) throw new HttpError(401, 'Sign in first.', { signIn: true });
    return p;
  };

  // ---------- Up from the runner ----------

  ctx.onRunnerRemoved = [
    ...(ctx.onRunnerRemoved ?? []),
    'DELETE FROM records WHERE runner_id = $1',
    'DELETE FROM record_syncs WHERE runner_id = $1',
    "UPDATE decisions SET state = 'cancelled', error = 'The laptop was removed.' WHERE runner_id = $1 AND state IN ('waiting', 'sent')",
  ];
  const pending = new Map(); // runner id -> { personId, change, jobs: Set, synced }
  const pendingOf = (runner) => {
    if (!pending.has(runner.id)) pending.set(runner.id, { personId: runner.personId, change: false, jobs: new Set(), synced: false });
    return pending.get(runner.id);
  };
  ctx.applyEvent ??= {};
  const hello = ctx.applyEvent.hello;
  ctx.applyEvent.hello = async (runner, e) => {
    if (hello) await hello(runner, e);
    await db.query(
      `INSERT INTO record_syncs (runner_id, synced_at, hello_at) VALUES ($1, to_timestamp(0), $2)
       ON CONFLICT (runner_id) DO UPDATE SET hello_at = EXCLUDED.hello_at`,
      [runner.id, iso(now())],
    );
  };
  ctx.applyEvent.record = async (runner, e) => {
    const { kind, key, value } = e.data;
    const p = pendingOf(runner);
    if (kind === 'synced') {
      await db.query(
        `INSERT INTO record_syncs (runner_id, synced_at, hello_at) VALUES ($1, $2, $2) ON CONFLICT (runner_id) DO UPDATE SET synced_at = EXCLUDED.synced_at`,
        [runner.id, iso(now() + 1)],
      );
      p.synced = true;
      return;
    }
    if (!Object.hasOwn(KINDS, kind) || typeof key !== 'string' || (value !== null && (typeof value !== 'object' || Array.isArray(value)))) return;
    if (!(await records.put(runner, kind, key, value))) return;
    if (kind === 'board' || kind.startsWith('stack')) p.change = true;
    else { p.jobs.add(kind === 'doc' ? key.split('\n')[0] : key); if (kind === 'job') p.change = true; }
  };
  ctx.applyEvent.audit = async (runner, e) => {
    const d = e.data;
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
    const at = Date.parse(d.at);
    await queue.audit({
      personId: runner.personId, runnerId: runner.id, who: str(d.who, 200) ?? 'You, on your laptop', from: d.from === 'site' ? 'site' : 'laptop',
      action: str(d.action, 40) ?? 'decision', job: str(d.job, 300), madeOn: d.madeOn && typeof d.madeOn === 'object' ? d.madeOn : null,
      outcome: str(d.outcome, 40), decisionId: null, at: Number.isNaN(at) ? now() : at, eid: e.eid,
    });
  };
  ctx.afterEvents = [...(ctx.afterEvents ?? []), async (runner) => {
    const p = pending.get(runner.id);
    pending.delete(runner.id);
    if (!p) return;
    for (const job of p.jobs) await live.emit(p.personId, 'thread', job);
    if (p.change || p.jobs.size) await live.emit(p.personId, 'change', null);
    if (p.synced) await queue.release(runner.id);
  }];
  ctx.onCommandResult = [...(ctx.onCommandResult ?? []), (runner, id, r) => queue.result(runner, id, r)];

  // ---------- The mirror runner ----------

  /** The person's laptops by id: { id, name, os, online, lastSeenAt }. */
  const laptopsBy = async (personId) => new Map((await ctx.laptopsOf(personId)).map((l) => [l.id, l]));

  async function jobOf(slug) {
    const person = who();
    const rec = await records.get(person.id, 'job', slug);
    if (!rec || rec.value?.tooBig) throw new HttpError(404, rec ? rec.value.words : 'No job by that name.');
    return rec;
  }

  /** The decisions shown on a job (newest first), and on each permission by its id. */
  async function shownFor(personId) {
    const all = await queue.shown(personId);
    const byJob = new Map();
    const byPermission = new Map();
    for (const d of all) {
      if (d.permissionId) { if (!byPermission.has(d.permissionId)) byPermission.set(d.permissionId, d); continue; }
      if (!byJob.has(d.job)) byJob.set(d.job, d);
    }
    return { byJob, byPermission };
  }

  const read = {
    hasJob: async (slug) => Boolean(await records.get(who().id, 'job', slug)),
    jobForName: async (name) => ((await records.get(who().id, 'job', name)) ? name : null),
    async job(slug) {
      const person = who();
      const rec = await jobOf(slug);
      const laptops = await laptopsBy(person.id);
      const { byJob, byPermission } = await shownFor(person.id);
      const job = rec.value;
      return {
        ...job,
        permissionsPending: (job.permissionsPending ?? []).map((p) => ({ ...p, queued: byPermission.get(p.id) ?? null })),
        queued: byJob.get(slug) ?? null,
        laptop: laptops.get(rec.runnerId) ?? null,
        mirroredAt: rec.updatedAt,
        hosted: true,
      };
    },
    async threadBefore() { throw new HttpError(404, 'Older messages show on your laptop.'); },
    async notes() { throw new HttpError(409, 'A job’s notes are on your laptop for now.'); },
    async decisions(slug) {
      const rec = await records.get(who().id, 'decisions', slug);
      return rec?.value ?? { decisions: [] };
    },
    async decisionsFile() { throw new HttpError(404, 'The decision file is on your laptop.'); },
    async docs(slug) {
      const rec = await records.get(who().id, 'docs', slug);
      return rec?.value ?? { docs: [] };
    },
    async doc(slug, file) {
      const rec = await records.get(who().id, 'doc', `${slug}\n${file}`);
      if (!rec) throw new HttpError(404, 'That document isn’t on the site yet. It shows here once your laptop sends it.');
      if (rec.value.tooBig) throw new HttpError(413, rec.value.words);
      return { ...rec.value, vscode: null };
    },
    async ids(slug, id) { return { id, definition: null, mentions: [] }; },
    async localView() { throw new HttpError(409, 'Try it runs on your laptop. Open the job there to use it.'); },
    async commits() { return { commits: [], note: 'The commits show on your laptop.' }; },
    async render() { throw new HttpError(409, ON_LAPTOP); },
    async screen() { throw new HttpError(404, 'The Screens page opens on your laptop.'); },
  };

  /** A live answer from the laptop (a commit's diff): sealed to this request, never stored readable. */
  async function askLive(runnerId, command) {
    await db.query('DELETE FROM command_answers WHERE at < $1', [iso(now() - ANSWER_KEEP_MS)]);
    const st = await queue.runnerState(runnerId);
    if (!st.online) throw new HttpError(503, OFF_WORDS, { code: 'laptop-off' });
    const keys = answerKeys();
    const id = await ctx.queueCommand(runnerId, command, { by: who().id, answerKey: keys.publicKey });
    const until = ctx.timers.now() + LIVE_MS;
    let doneSeen = null;
    try {
      for (;;) {
        const ans = (await db.query('DELETE FROM command_answers WHERE command_id = $1 RETURNING sealed', [id])).rows[0];
        if (ans) return open(keys.privateKey, typeof ans.sealed === 'string' ? JSON.parse(ans.sealed) : ans.sealed);
        const c = (await db.query('SELECT ok, error, done_at FROM commands WHERE id = $1', [id])).rows[0];
        if (c?.done_at && c.ok === false) throw new HttpError(409, c.error || 'Your laptop couldn’t show this.');
        if (c?.done_at) doneSeen ??= ctx.timers.now();
        if (ctx.timers.now() > until || (doneSeen !== null && ctx.timers.now() - doneSeen > 3000)) throw new HttpError(504, 'Your laptop didn’t answer in time. Try again.');
        await ctx.answerArrived(id, 400);
      }
    } finally {
      await db.query('DELETE FROM commands WHERE id = $1 AND delivered_at IS NULL', [id]).catch(() => {});
    }
  }

  async function handle(raw) {
    const person = who();
    const parsed = parseCommand(raw, { from: 'site' });
    if (!parsed.ok) {
      if (raw && Object.hasOwn(LOCAL_COMMANDS, raw.type)) throw new HttpError(409, ON_LAPTOP, { code: 'on-laptop' });
      throw new HttpError(400, parsed.error, { code: 'bad-command' });
    }
    const c = parsed.command;
    if (c.type === 'fetch-diff') {
      const rec = await jobOf(c.slug);
      return askLive(rec.runnerId, c);
    }
    if (c.type === 'start') throw new HttpError(409, 'Start new jobs from your laptop for now.', { code: 'on-laptop' });
    const kind = decisionKind(c);
    if (!kind) {
      // Pause or take over: only while the laptop is there to do it now.
      const rec = c.slug ? await jobOf(c.slug) : null;
      const runnerId = rec?.runnerId ?? (await laptopsBy(person.id)).values().next().value?.id;
      if (!runnerId || !(await queue.runnerState(runnerId)).online) throw new HttpError(503, OFF_WORDS, { code: 'laptop-off' });
      await ctx.queueCommand(runnerId, c, { by: person.id, byName: nameOf(person) });
      return { ok: true, queued: true };
    }
    let runnerId;
    let job = null;
    let permissions = [];
    let expiresAt = null;
    let slug = c.slug ?? null;
    if (kind === 'allow' || kind === 'deny') {
      for (const b of await records.all(person.id, 'board')) {
        const p = (b.value.permissions ?? []).find((x) => x.id === c.requestId);
        if (p) { runnerId = b.runnerId; permissions = [p]; slug = p.slug ?? null; expiresAt = p.expiresAt ?? null; break; }
      }
      if (!runnerId) throw new HttpError(404, 'That request was already answered or has expired.');
      if (expiresAt && Date.parse(expiresAt) <= now()) throw new HttpError(410, 'That request has run out. Nothing was sent.', { code: 'expired' });
    } else if (kind === 'stack-merge') {
      const rec = await records.get(person.id, 'stack', c.slug);
      if (!rec) throw new HttpError(404, 'There is no stack like that among yours.');
      runnerId = rec.runnerId;
    } else {
      const rec = await jobOf(c.slug);
      runnerId = rec.runnerId;
      job = rec.value;
    }
    let madeOn;
    try { madeOn = madeOnFor(c, { job, permissions }); } catch (err) { throw new HttpError(409, err.message, { code: 'stale' }); }
    const queued = await queue.decide({ person, runnerId, job: slug ?? madeOn.slug ?? '', command: c, madeOn, expiresAt, kind });
    return { ok: true, sent: false, held: true, queued, text: '', message: queued?.words ?? 'Waiting for your laptop.' };
  }

  const mirrorRunner = { read, handle, local: null, on: () => () => {} };

  // The dashboard's own routes, given the mirror runner. New jobs (POST /api/jobs) are packet 2C's.
  const dashCtx = {
    runner: mirrorRunner, read, local: null, send, sendJson, wireframesOrigin: null, LOCAL: { from: 'local' },
    async needJob(slug) { if (!(await read.hasJob(slug))) throw new HttpError(404, 'No job by that name.'); return slug; },
  };
  const mounted = [...dashboardStageRoutes(dashCtx), ...dashboardJobRoutes(dashCtx)]
    .filter((r) => !(r.method === 'POST' && r.path === '/api/jobs'))
    .map((r) => ({
      method: r.method, path: r.path, auth: 'session',
      async run(call) {
        const body = WRITES.has(call.req.method) ? await ctx.readJson(call.req, { max: 256 * 1024 }) : undefined;
        try {
          return await als.run({ person: call.person }, () => r.run({ req: call.req, res: call.res, url: call.url, m: call.m, body }));
        } catch (err) { throw asSiteError(err); }
      },
    }));

  // ---------- The snapshot, and live updates ----------

  async function snapshot(person) {
    const seq = await live.latest(person.id);
    const laptops = await laptopsBy(person.id);
    const boards = await records.all(person.id, 'board');
    const { byJob, byPermission } = await shownFor(person.id);
    const seen = new Set();
    const jobs = [];
    const permissions = [];
    for (const b of boards) {
      const laptop = laptops.get(b.runnerId) ?? null;
      for (const j of b.value.jobs ?? []) {
        if (seen.has(j.slug)) continue;
        seen.add(j.slug);
        jobs.push({ ...j, laptop, queued: byJob.get(j.slug) ?? null });
      }
      for (const p of b.value.permissions ?? []) permissions.push({ ...p, laptop, queued: byPermission.get(p.id) ?? null });
    }
    const fresh = boards[0]?.value ?? {};
    return {
      v: 2, seq, epoch: HOSTED_EPOCH,
      meta: {
        ...(fresh.meta ?? {}), mode: 'hosted', token: null, wireframesOrigin: null, demo: Boolean(fresh.meta?.demo),
        person: ctx.personView(person), laptops: [...laptops.values()],
      },
      jobs, needsYou: jobs.filter((j) => j.group === 'needs-you').length, permissions,
      usage: fresh.usage ?? null, planUsage: fresh.planUsage ?? undefined, runTypical: fresh.runTypical ?? undefined,
      generatedAt: new Date(now()).toISOString(),
    };
  }

  const stackPath = /^\/api\/stacks\/([a-z0-9][a-z0-9._-]{0,199})(?:\/part\/([1-9]\d{0,2})(\/diff)?|\/([a-z-]+))?$/;

  return [
    ...mounted,
    { method: 'GET', path: '/api/snapshot', auth: 'session', async run({ res, person }) { sendJson(res, 200, await snapshot(person)); } },
    {
      method: 'GET', path: '/api/events', auth: 'session',
      async run({ req, res, url, person }) {
        await live.prune().catch(() => {});
        return live.stream(req, res, { personId: person.id, resume: resumeFrom(req, url), headers: API_HEADERS, maxMs: ctx.streamMs });
      },
    },
    {
      method: 'GET', path: '/api/events/poll', auth: 'session',
      async run({ url, res, person }) {
        const since = url.searchParams.get('since');
        sendJson(res, 200, await live.poll(person.id, since !== null && /^\d{1,15}$/.test(since) ? Number(since) : null));
      },
    },
    {
      method: 'GET', path: '/api/stacks', auth: 'session',
      async run({ res, person }) {
        const recs = await records.all(person.id, 'stacks');
        const stacks = recs.flatMap((r) => r.value.stacks ?? []);
        sendJson(res, 200, { ...(recs[0]?.value ?? {}), stacks });
      },
    },
    {
      method: 'GET', path: stackPath, auth: 'session',
      async run({ res, m, person }) {
        const [, slug, n, diff, action] = m;
        if (action) throw new HttpError(404, 'Not found');
        if (diff) return sendJson(res, 200, { error: 'Your laptop shows a file’s changes. Open this part there.' });
        const rec = n ? await records.get(person.id, 'stack-part', `${slug}/${n}`) : await records.get(person.id, 'stack', slug);
        if (!rec) throw new HttpError(404, n ? `This stack has no part ${n}.` : 'There is no stack like that among yours.');
        const { byJob } = await shownFor(person.id);
        sendJson(res, 200, { ...rec.value, queued: byJob.get(slug) ?? null, hosted: true });
      },
    },
    { method: 'POST', path: '/api/stacks/cap', auth: 'session', async run() { throw new HttpError(409, 'This is set on your laptop for now.', { code: 'on-laptop' }); } },
    {
      method: 'POST', path: stackPath, auth: 'session',
      async run({ req, res, m, person }) {
        const body = await ctx.readJson(req);
        const [, slug, n, , action] = m;
        if (n || action !== 'merge') throw new HttpError(409, 'This is done on the Stack page on your laptop for now.', { code: 'on-laptop' });
        const section = typeof body.section === 'string' && body.section ? body.section.slice(0, 200) : undefined;
        const out = await als.run({ person }, () => handle({ type: 'stack-merge', slug, ...(section ? { section } : {}) }));
        const rec = await records.get(person.id, 'stack', slug);
        sendJson(res, 202, { ...(rec?.value ?? {}), queued: out.queued, hosted: true, view: rec?.value ?? null });
      },
    },
    {
      method: 'GET', path: '/api/decisions', auth: 'session',
      async run({ res, person }) {
        const { rows } = await db.query('SELECT at, who, from_where, action, job, made_on, outcome FROM audit WHERE person_id = $1 ORDER BY at DESC, id DESC LIMIT 50', [person.id]);
        sendJson(res, 200, {
          decisions: await queue.shown(person.id),
          audit: rows.map((r) => ({ at: new Date(r.at).toISOString(), who: r.who, from: r.from_where, action: r.action, job: r.job, madeOn: typeof r.made_on === 'string' ? JSON.parse(r.made_on) : r.made_on, outcome: r.outcome })),
        });
      },
    },
    {
      method: 'POST', path: /^\/api\/decisions\/(d_[\w-]{8,40})\/(cancel|dismiss)$/, auth: 'session',
      async run({ req, res, m, person }) {
        await ctx.readJson(req);
        if (m[2] === 'cancel') return sendJson(res, 200, { decision: await queue.cancel(person, m[1]) });
        await queue.dismiss(person, m[1]);
        sendJson(res, 200, { ok: true });
      },
    },
  ];
}
