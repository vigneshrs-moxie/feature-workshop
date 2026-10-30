// Packet 2B: the full mirror, queued decisions and live updates. A made-up laptop
// (mirror-laptop.js) sends its record up; the site serves the job pages from it, queues decisions
// for the laptop while it is off, checks each against the laptop's fresh record when it is back,
// and audits every step. A fake Blob store holds the evidence; nothing real is called.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeEvent, PROTOCOL_VERSION } from '../../dashboard/lib/protocol.js';
import { browser, makeSite, SITE, signIn } from './helpers.js';
import { paired, tmp, until } from './laptops.js';
import { gate, mirrorLaptop, mirrorRunner } from './mirror-laptop.js';

const OFF = 2 * 60 * 1000;
const count = async (s, sql, params = []) => (await s.db.query(sql, params)).rows[0].n;
const post = (s, token, p, body) => s.fetch(`${SITE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const synced = (s, runnerId) => until(async () => (await s.db.query('SELECT synced_at >= hello_at AS ok FROM record_syncs WHERE runner_id = $1', [runnerId])).rows[0]?.ok, { what: 'the laptop’s whole record' });

/** Olive, her laptop paired and its record on the site. */
async function setUp({ runner = mirrorRunner() } = {}) {
  const s = await makeSite();
  const olive = await paired(s, 'olive.owner@example.test', 'Olive’s Mac');
  const l = await mirrorLaptop(s, olive.token, { runner });
  await synced(s, olive.runnerId);
  return { s, olive, l, runner };
}

/** The laptop closes: its link stops and a couple of minutes pass, so the site says it is off. */
function closeLaptop(s, l) { l.link.stop(); s.clock.t += OFF; }

test('the mirror round trip: the board, a job’s page, its documents and decisions, the Stage; only for its owner', async () => {
  const { s, olive, l } = await setUp();
  try {
    const snap = (await olive.person.json('/api/snapshot')).body;
    assert.equal(snap.v, 2);
    assert.equal(snap.epoch, '2b');
    assert.deepEqual(snap.jobs.map((j) => j.slug), ['add-export']);
    assert.equal(snap.jobs[0].laptop.name, 'Olive’s Mac');
    assert.equal(snap.jobs[0].cost.source, 'estimate', 'a short label under source comes back as it was');
    assert.equal(snap.meta.mode, 'hosted');
    assert.equal(snap.meta.token, null, 'the laptop’s page token never reaches the site');
    assert.equal(snap.meta.featuresDir, undefined, 'nor its folders');
    const job = (await olive.person.json('/api/job/add-export')).body;
    assert.equal(job.gate.briefNumber, 2);
    assert.equal(job.hosted, true);
    assert.deepEqual(job.thread.map((t) => t.kind), ['brief', 'note', 'you'], 'the Foreman’s reply stays on the laptop: a line says so');
    assert.match(job.thread[1].text, /Its words show on your laptop/);
    assert.equal(job.audit, undefined);
    assert.equal(job.lastReply, undefined);
    assert.deepEqual(job.runs, [{ id: 'run-1', slug: undefined, title: undefined, kind: undefined, model: undefined, status: 'done', startedAt: undefined, endedAt: undefined, lastAction: null, pending: 0, stopReason: null, mode: null, newJob: null }].map((r) => JSON.parse(JSON.stringify(r))));
    assert.deepEqual((await olive.person.json('/api/job/add-export/docs')).body.docs.map((d) => d.file), ['briefs/002-plan.md']);
    const doc = (await olive.person.json('/api/job/add-export/doc?file=briefs%2F002-plan.md')).body;
    assert.match(doc.text, /The plan/);
    assert.equal(doc.vscode, null);
    assert.equal((await olive.person.json('/api/job/add-export/decisions')).body.decisions[0].choice, 'CSV');
    const stage = await olive.person.json('/api/job/add-export/stage/plan');
    assert.equal(stage.status, 200, JSON.stringify(stage.body));
    // What only the laptop has says so in words.
    const tryIt = await olive.person.json('/api/job/add-export/local');
    assert.equal(tryIt.status, 409);
    assert.match(tryIt.body.error, /Try it runs on your laptop/);
    // Someone else: nothing of Olive's, as if it weren't there.
    const sam = browser(s.fetch);
    await signIn(sam, { email: 'sam.sample@example.test' });
    assert.equal((await sam.json('/api/job/add-export')).status, 404);
    assert.equal((await sam.json('/api/job/add-export/doc?file=briefs%2F002-plan.md')).status, 404);
    assert.deepEqual((await sam.json('/api/snapshot')).body.jobs, []);
    // The job closes on the laptop: its parts leave the site.
    l.runner.job = null;
    l.runner.changed(null);
    await until(async () => (await count(s, "SELECT count(*)::int AS n FROM records WHERE job = 'add-export'")) === 0, { what: 'the job’s parts to go' });
    assert.equal((await olive.person.json('/api/job/add-export')).status, 404);
  } finally { l.link.stop(); await s.close(); }
});

test('“never carries”: the site refuses a record with a diff, an env, a token or source; the laptop never sends a file’s content', async () => {
  const runner = mirrorRunner();
  runner.permissions = [{ id: 'perm-write-1', slug: 'add-export', kind: 'permission', toolName: 'Write', input: { file_path: 'src/a.js', content: 'export const a = 1;' }, plain: { headline: 'Write src/a.js', preview: 'export const a = 1;', previewHtml: '<p>x</p>' }, createdAt: '2026-10-30T15:50:00.000Z', draft: { rule: 'x' } }];
  const { s, olive, l } = await setUp({ runner });
  try {
    const sent = (await s.db.query("SELECT data FROM events WHERE runner_id = $1 AND type = 'record'", [olive.runnerId])).rows.map((r) => JSON.stringify(r.data));
    assert.ok(sent.length > 3);
    for (const text of sent) {
      assert.ok(!text.includes('export const a = 1'), 'a file’s content never goes up');
      assert.ok(!text.includes('readSource'), 'the Foreman’s replies never go up');
      assert.ok(!text.includes('streamed words') && !text.includes('private words'), 'nor a reply in progress, nor the audit');
      assert.ok(!text.includes('local-page-token'), 'nor the page token');
    }
    const perm = (await olive.person.json('/api/snapshot')).body.permissions[0];
    assert.equal(perm.plain.headline, 'Write src/a.js');
    assert.equal(perm.plain.preview, null);
    assert.match(perm.plain.previewNote, /shows on your laptop/);
    assert.deepEqual(perm.input, { file_path: 'src/a.js' });
    // Sent anyway, by hand: each is refused whole, and nothing is stored.
    const record = (value) => ({ eid: `r-${Math.random().toString(36).slice(2)}`, v: PROTOCOL_VERSION, type: 'record', job: 'add-export', data: { kind: 'job', key: 'add-export', value } });
    const r = await (await post(s, olive.token, '/api/runner/events', { events: [
      record({ slug: 'add-export', diff: '+ a line' }),
      record({ slug: 'add-export', nested: [{ env: { KEY: 'v' } }] }),
      record({ slug: 'add-export', now: `here: orbfb_${'z'.repeat(43)}` }),
      record({ slug: 'add-export', files: [{ source: 'const x = 1;\nconst y = 2;' }] }),
    ] })).json();
    assert.equal(r.accepted, 0);
    assert.equal(r.refused.length, 4);
    assert.equal((await olive.person.json('/api/job/add-export')).body.diff, undefined);
    // makeEvent itself refuses the same on the laptop.
    assert.equal(makeEvent('record', { kind: 'job', key: 'x', value: { patch: 'x' } }).ok, false);
  } finally { l.link.stop(); await s.close(); }
});

test('evidence: uploaded straight to the store with a one-time link for one path; only its owner gets it, through a short-lived link', async () => {
  const runner = mirrorRunner();
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'abc1234', 'AC-1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'abc1234', 'AC-1', '01.png'), Buffer.from('a picture, not really'));
  runner.evidenceDir = dir;
  runner.evidence = { version: 1, commit: 'abc1234', criteria: [{ id: 'AC-1', title: 'Export button', status: 'passed', screenshots: [{ file: 'abc1234/AC-1/01.png', description: 'The button' }], video: null }] };
  const { s, olive, l } = await setUp({ runner });
  try {
    await until(async () => (await count(s, 'SELECT count(*)::int AS n FROM evidence_files WHERE uploaded_at IS NOT NULL')) === 1, { what: 'the picture to upload' });
    const row = (await s.db.query('SELECT pathname, content_type FROM evidence_files')).rows[0];
    assert.equal(row.pathname, `evidence/${(await s.db.query('SELECT person_id FROM runners WHERE id = $1', [olive.runnerId])).rows[0].person_id}/${olive.runnerId}/add-export/abc1234/AC-1/01.png`);
    assert.equal(s.site.ctx.blob.files.get(row.pathname).bytes.toString(), 'a picture, not really');
    const view = (await olive.person.json('/api/job/add-export/evidence')).body;
    assert.deepEqual(view.onSite, ['abc1234/AC-1/01.png']);
    assert.equal(view.folder, null);
    const link = await olive.person.get('/api/job/add-export/evidence/file?path=abc1234%2FAC-1%2F01.png');
    assert.equal(link.status, 302);
    const signed = link.headers.get('location');
    assert.match(signed, /\/fake-blob\/evidence\/.*op=get.*sig=/);
    assert.equal(await (await s.fetch(signed)).text(), 'a picture, not really');
    // The link runs out.
    s.clock.t += 6 * 60 * 1000;
    assert.equal((await s.fetch(signed)).status, 403);
    // Someone else: a 404, even with the right path; a made-up path is a 404 too.
    const sam = browser(s.fetch);
    await signIn(sam, { email: 'sam.sample@example.test' });
    assert.equal((await sam.get('/api/job/add-export/evidence/file?path=abc1234%2FAC-1%2F01.png')).status, 404);
    assert.equal((await olive.person.get('/api/job/add-export/evidence/file?path=..%2F..%2Fetc')).status, 404);
    // The laptop may ask only for a file its own evidence names, a picture or a video, at its own path.
    const ask = (body) => post(s, olive.token, '/api/runner/evidence/upload', body);
    assert.equal((await ask({ slug: 'add-export', file: 'abc1234/AC-1/other.png', type: 'image/png', size: 10 })).status, 404);
    assert.equal((await ask({ slug: 'add-export', file: 'abc1234/AC-1/01.png', type: 'text/html', size: 10 })).status, 400);
    assert.equal((await ask({ slug: 'add-export', file: '../x.png', type: 'image/png', size: 10 })).status, 400);
    const sams = await paired(s, 'sam.sample@example.test', 'Sam’s laptop', { person: sam });
    assert.equal((await post(s, sams.token, '/api/runner/evidence/upload', { slug: 'add-export', file: 'abc1234/AC-1/01.png', type: 'image/png', size: 10 })).status, 404, 'another laptop can’t write to this job’s path');
    // An upload link is for exactly that path and type.
    const one = await (await ask({ slug: 'add-export', file: 'abc1234/AC-1/01.png', type: 'image/png', size: 30 })).json();
    const wrong = one.url.replace('01.png', '02.png');
    assert.equal((await s.fetch(wrong, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: 'x' })).status, 403);
    assert.equal((await s.fetch(one.url, { method: 'PUT', headers: { 'content-type': 'text/html' }, body: 'x' })).status, 400);
  } finally { l.link.stop(); await s.close(); }
});

test('D9: Go from the site while the laptop is closed waits; when the laptop is back it runs, and the job moves on', async () => {
  const { s, olive, l, runner } = await setUp();
  try {
    closeLaptop(s, l);
    const r = await olive.person.send('POST', '/api/job/add-export/gate', { kind: 'approve', briefNumber: 2 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.held, true);
    assert.equal(r.body.queued.state, 'waiting');
    assert.match(r.body.queued.words, /waiting for your laptop\. It runs when the laptop is back/);
    assert.equal(r.body.queued.canCancel, true);
    const job = (await olive.person.json('/api/job/add-export')).body;
    assert.equal(job.queued.state, 'waiting');
    assert.equal(job.laptop.online, false);
    assert.equal((await olive.person.json('/api/snapshot')).body.jobs[0].queued.state, 'waiting');
    assert.equal(await count(s, 'SELECT count(*)::int AS n FROM commands'), 0, 'nothing is handed over while the laptop is off');
    // Deciding the same again is refused calmly.
    assert.equal((await olive.person.send('POST', '/api/job/add-export/gate', { kind: 'approve', briefNumber: 2 })).status, 409);
    // The laptop wakes.
    const back = await mirrorLaptop(s, olive.token, { runner, stateDir: l.stateDir });
    try {
      await until(() => runner.handled.length === 1, { what: 'the approval to run' });
      assert.equal(runner.handled[0].type, 'approve');
      await until(async () => (await olive.person.json('/api/job/add-export')).body.stage === 'implement', { what: 'the job to move on' });
      await until(async () => (await olive.person.json('/api/decisions')).body.decisions[0]?.state === 'done', { what: 'the decision to say done' });
      // Both sides audited it: the laptop's own line, and the site's copy from both.
      assert.deepEqual(runner.auditLines.map((x) => [x.action, x.from, x.by, x.outcome, x.madeOn.kind, x.madeOn.brief]), [['site-decision', 'site', 'olive.owner', 'ran', 'gate', 2]]);
      await until(async () => (await count(s, "SELECT count(*)::int AS n FROM audit WHERE outcome = 'ran'")) === 1, { what: 'the laptop’s audit line on the site' });
      const audit = (await olive.person.json('/api/decisions')).body.audit;
      assert.deepEqual(audit.map((a) => [a.from, a.action, a.outcome]).reverse(), [['site', 'approve', 'queued'], ['site', 'approve', 'sent'], ['site', 'approve', 'done'], ['site', 'approve', 'ran']].sort((a, b) => ['queued', 'sent', 'done', 'ran'].indexOf(a[2]) - ['queued', 'sent', 'done', 'ran'].indexOf(b[2])));
      assert.ok(audit.every((a) => a.madeOn?.kind === 'gate' && a.madeOn.brief === 2 && a.job === 'add-export'));
    } finally { back.link.stop(); }
  } finally { l.link.stop(); await s.close(); }
});

test('every kind of decision, online and offline: Go, send back, stop, a reply, allow, deny, merge next', async () => {
  const kinds = [
    ['approve', (b) => b.send('POST', '/api/job/add-export/gate', { kind: 'approve', briefNumber: 2 })],
    ['send-back', (b) => b.send('POST', '/api/job/add-export/gate', { kind: 'changes', briefNumber: 2, note: 'Use the new table.' })],
    ['stop', (b) => b.send('POST', '/api/job/add-export/gate', { kind: 'stop', briefNumber: 2 })],
    ['reply', (b) => b.send('POST', '/api/job/add-export/gate', { kind: 'message', briefNumber: 2, note: 'What about CSV?' })],
    ['reply', (b) => b.send('POST', '/api/job/add-export/send', { text: 'From the message box.' })],
    ['allow', (b) => b.send('POST', '/api/permissions/perm-1', { decision: 'allow' })],
    ['deny', (b) => b.send('POST', '/api/permissions/perm-1', { decision: 'deny', note: 'Not now.' })],
    ['stack-merge', (b) => b.send('POST', '/api/stacks/invoice-export/merge', { section: 'part-1' })],
  ];
  for (const online of [true, false]) {
    for (const [type, decide] of kinds) {
      const runner = mirrorRunner();
      runner.permissions = [{ id: 'perm-1', slug: 'add-export', kind: 'permission', toolName: 'Bash', input: { command: 'npm test' }, plain: { headline: 'Run the tests', preview: 'npm test' }, createdAt: '2026-10-30T15:55:00.000Z' }];
      runner.stack = { slug: 'invoice-export', title: 'Invoice export' };
      runner.local.stacks.merge = null;
      const { s, olive, l } = await setUp({ runner });
      await until(async () => (await count(s, "SELECT count(*)::int AS n FROM records WHERE kind = 'stack'")) === 1, { what: 'the stack' });
      if (!online) closeLaptop(s, l);
      try {
        const r = await decide(olive.person);
        assert.ok([200, 202].includes(r.status), `${type} ${online}: ${JSON.stringify(r.body)}`);
        const state = (await olive.person.json('/api/decisions')).body.decisions[0].state;
        if (online) {
          await until(() => runner.handled.length === 1, { what: `${type} to run on the laptop` });
          assert.equal(runner.handled[0].type, type);
        } else {
          assert.equal(state, 'waiting', `${type} offline waits`);
          await new Promise((res) => setTimeout(res, 50));
          assert.equal(runner.handled.length, 0);
          const back = await mirrorLaptop(s, olive.token, { runner, stateDir: l.stateDir });
          try { await until(() => runner.handled.length === 1, { what: `${type} to run when the laptop is back` }); } finally { back.link.stop(); }
          assert.equal(runner.handled[0].type, type);
        }
      } finally { l.link.stop(); await s.close(); }
    }
  }
});

test('stale decisions: the job moved on while the laptop was off, or just before it ran; nothing runs and the card says to look again', async () => {
  const { s, olive, l, runner } = await setUp();
  try {
    closeLaptop(s, l);
    assert.equal((await olive.person.send('POST', '/api/job/add-export/gate', { kind: 'approve', briefNumber: 2 })).status, 200);
    // On the laptop meanwhile, the Foreman wrote brief 3.
    runner.job = { ...runner.job, gate: gate(3) };
    const back = await mirrorLaptop(s, olive.token, { runner, stateDir: l.stateDir });
    try {
      await until(async () => (await olive.person.json('/api/decisions')).body.decisions[0]?.state === 'changed', { what: 'the decision to be changed' });
      assert.equal(runner.handled.length, 0, 'nothing ran');
      const job = (await olive.person.json('/api/job/add-export')).body;
      assert.match(job.queued.words, /^This changed on your laptop\. Look again\. The Foreman moved on to brief 3\./);
      assert.equal(job.gate.briefNumber, 3, 'with the new card');
      // Put away, it no longer shows.
      assert.equal((await olive.person.send('POST', `/api/decisions/${job.queued.id}/dismiss`, {})).status, 200);
      assert.equal((await olive.person.json('/api/job/add-export')).body.queued, null);
    } finally { back.link.stop(); }

    // The runner's own check: handed over, but the brief changed on the laptop before it ran.
    const again = await mirrorLaptop(s, olive.token, { runner, stateDir: l.stateDir });
    try {
      await synced(s, olive.runnerId);
      const real = runner.read.job;
      runner.read.job = async (slug) => ({ ...(await real(slug)), gate: gate(4) }); // what the laptop shows from now on
      assert.equal((await olive.person.send('POST', '/api/job/add-export/gate', { kind: 'approve', briefNumber: 3 })).status, 200);
      await until(async () => (await olive.person.json('/api/decisions')).body.decisions[0]?.state === 'changed', { what: 'the runner to refuse it' });
      assert.equal(runner.handled.length, 0);
      assert.equal(runner.auditLines.at(-1).outcome, 'changed');
    } finally { again.link.stop(); }
    // A decision on a gate that isn't there any more is refused at once.
    runner.job = { ...runner.job, gate: null };
  } finally { l.link.stop(); await s.close(); }
});

test('a permission expires where the Foreman’s request does: not sent after; and a cancel before the laptop has it', async () => {
  const runner = mirrorRunner();
  runner.permissions = [{ id: 'perm-9', slug: 'add-export', kind: 'permission', toolName: 'Bash', input: { command: 'npm run db:test' }, plain: { headline: 'Run the database tests' }, createdAt: '2026-10-30T15:48:00.000Z', expiresAt: '2026-10-30T16:03:00.000Z' }];
  const { s, olive, l } = await setUp({ runner });
  try {
    const p = (await olive.person.json('/api/snapshot')).body.permissions[0];
    assert.equal(p.createdAt, '2026-10-30T15:48:00.000Z');
    assert.equal(p.expiresAt, '2026-10-30T16:03:00.000Z');
    closeLaptop(s, l); // 16:02
    const r = await olive.person.send('POST', '/api/permissions/perm-9', { decision: 'allow' });
    assert.equal(r.status, 200);
    assert.equal(r.body.queued.expiresAt, '2026-10-30T16:03:00.000Z');
    s.clock.t += 2 * 60 * 1000; // 16:04: past it
    const back = await mirrorLaptop(s, olive.token, { runner, stateDir: l.stateDir });
    try {
      await until(async () => (await olive.person.json('/api/decisions')).body.decisions[0]?.state === 'expired', { what: 'the allow to expire' });
      assert.equal(runner.handled.length, 0);
      assert.match((await olive.person.json('/api/decisions')).body.decisions[0].words, /ran out before your laptop was back/);
      // Asked after it ran out: refused at once.
      assert.equal((await olive.person.send('POST', '/api/permissions/perm-9', { decision: 'deny' })).status, 410);
    } finally { back.link.stop(); }

    // Cancel: while it waits, yes; once the laptop has it, no.
    runner.permissions = [];
    runner.job = { ...runner.job, gate: gate(5) };
    const on = await mirrorLaptop(s, olive.token, { runner, stateDir: l.stateDir });
    await synced(s, olive.runnerId);
    on.link.stop();
    s.clock.t += OFF;
    const d = (await olive.person.send('POST', '/api/job/add-export/gate', { kind: 'approve', briefNumber: 5 })).body.queued;
    const c = await olive.person.send('POST', `/api/decisions/${d.id}/cancel`, {});
    assert.equal(c.status, 200);
    assert.equal(c.body.decision.state, 'cancelled');
    assert.ok((await olive.person.json('/api/decisions')).body.audit.some((a) => a.outcome === 'cancelled'));
    const sam = browser(s.fetch);
    await signIn(sam, { email: 'sam.sample@example.test' });
    assert.equal((await sam.send('POST', `/api/decisions/${d.id}/cancel`, {})).status, 404, 'only your own');
  } finally { l.link.stop(); await s.close(); }
});

test('decisions made on the laptop go up to the site’s audit copy, from the laptop', async () => {
  const { s, olive, l } = await setUp();
  try {
    const e = makeEvent('audit', { at: '2026-10-30T15:59:00.000Z', from: 'laptop', who: 'Olive Owner', action: 'approve', job: 'add-export', madeOn: { kind: 'gate', slug: 'add-export', brief: 2 }, outcome: 'ran' }, { job: 'add-export' });
    const r = await (await post(s, olive.token, '/api/runner/events', { events: [{ eid: 'aud-1', ...e.event }, { eid: 'aud-1', ...e.event }] })).json();
    assert.equal(r.accepted, 2);
    const audit = (await olive.person.json('/api/decisions')).body.audit;
    assert.deepEqual(audit.map((a) => [a.from, a.who, a.action, a.outcome]), [['laptop', 'Olive Owner', 'approve', 'ran']], 'kept once');
  } finally { l.link.stop(); await s.close(); }
});

test('the live diff: asked of the laptop while it is on, sealed to the asking request, never stored; off, it says so', async () => {
  const { s, olive, l } = await setUp();
  try {
    const r = await olive.person.json('/api/job/add-export/commit/abc1234');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.diff, /a line of code/);
    assert.equal(await count(s, 'SELECT count(*)::int AS n FROM command_answers'), 0, 'collected and gone');
    const stored = (await s.db.query("SELECT data FROM events WHERE runner_id = $1", [olive.runnerId])).rows.map((x) => JSON.stringify(x.data)).join('\n');
    assert.ok(!stored.includes('a line of code'), 'never an event');
    closeLaptop(s, l);
    const off = await olive.person.json('/api/job/add-export/commit/abc1234');
    assert.equal(off.status, 503);
    assert.equal(off.body.error, 'Your laptop is off; this shows when it’s back.');
  } finally { l.link.stop(); await s.close(); }
});

test('live updates: server-sent events from /api/events, resumed with Last-Event-ID, each stream ending by itself; and the poll', async () => {
  const { s, olive, l, runner } = await setUp();
  s.site.ctx.streamMs = 400;
  try {
    const seq = (await olive.person.json('/api/snapshot')).body.seq;
    const first = await olive.person.get(`/api/events?v=2&since=${seq}`);
    assert.equal(first.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    runner.job = { ...runner.job, stage: 'implement', gate: null };
    runner.changed();
    const text = await first.text();
    assert.match(text, /event: bye/);
    const ids = [...text.matchAll(/^id: 2b\.(\d+)$/gm)].map((m) => Number(m[1]));
    const datas = [...text.matchAll(/^data: (\{.*\})$/gm)].map((m) => JSON.parse(m[1])).filter((d) => d.type);
    if (!datas.length) {
      // The change may land after this short stream: the next one, resumed from where it was, has it.
      const next = await (await olive.person.get(`/api/events?v=2`, { headers: { 'last-event-id': `2b.${seq}` } })).text();
      datas.push(...[...next.matchAll(/^data: (\{.*\})$/gm)].map((m) => JSON.parse(m[1])).filter((d) => d.type));
    }
    assert.ok(datas.some((d) => d.type === 'change'), JSON.stringify(datas));
    assert.ok(datas.every((d) => d.v === 2 && d.seq > seq));
    assert.ok(ids.every((i) => i > seq));
    const last = Math.max(...datas.map((d) => d.seq));
    const poll = (await olive.person.json(`/api/events/poll?since=${seq}`)).body;
    assert.ok(poll.events.some((e) => e.seq === last));
    assert.equal((await olive.person.json(`/api/events/poll?since=${last}`)).body.events.length, 0);
    // Another person's stream has none of it.
    const sam = browser(s.fetch);
    await signIn(sam, { email: 'sam.sample@example.test' });
    assert.equal((await sam.json('/api/events/poll?since=0')).body.events.length, 0);
  } finally { l.link.stop(); await s.close(); }
});

test('pairing: one address may start at most five pairings a minute, so nobody can fill the site’s cap', async () => {
  const s = await makeSite();
  try {
    const start = (ip) => s.fetch(`${SITE}/api/pair/start`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1` }, body: JSON.stringify({ name: 'A laptop', os: 'macOS', deviceId: 'device-abcdefgh' }) });
    for (let i = 0; i < 5; i++) assert.equal((await start('203.0.113.7')).status, 200);
    const sixth = await start('203.0.113.7');
    assert.equal(sixth.status, 429);
    assert.match((await sixth.json()).error, /Too many pairings from here/);
    assert.equal((await start('198.51.100.2')).status, 200, 'another address is fine');
    s.clock.t += 61 * 1000;
    assert.equal((await start('203.0.113.7')).status, 200, 'a minute later, again');
    assert.equal(await count(s, 'SELECT count(*)::int AS n FROM pair_starts'), 7, 'kept by the address’s hash only');
    assert.equal(await count(s, "SELECT count(*)::int AS n FROM pair_starts WHERE address_hash LIKE '203%'"), 0);
  } finally { await s.close(); }
});
