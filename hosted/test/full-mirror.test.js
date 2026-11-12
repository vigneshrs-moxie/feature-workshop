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
    assert.deepEqual(job.prototype, { url: 'https://prototypes.example.test/f/add-export', revision: 4, publishedAt: null }, 'the published link comes up with the job');
    const publish = await olive.person.send('POST', '/api/jobs/add-export/prototype/publish');
    assert.equal(publish.status, 409, 'publishing runs on the laptop, never from the site');
    assert.equal(publish.body.code, 'on-laptop');
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

test('a branch Starbase only guessed reaches the website as a guess, with no path of the laptop’s', async () => {
  const runner = mirrorRunner();
  runner.job = { ...runner.job, branch: 'feature/someone-elses', repo: { name: 'app', branch: 'feature/someone-elses', branchGuessed: true } };
  // The job page's read on the laptop carries lib/locate.js locateJob's whole answer (the board's card does not).
  const read = runner.read.job;
  runner.read.job = async (slug) => ({
    ...(await read(slug)),
    locate: {
      path: '/home/someone/app', source: 'status.json', branch: 'feature/someone-elses', branchSource: 'git branch in app', branchGuessed: true,
      branchExists: true, worktree: '/home/someone/app-wt', checkoutBranch: 'main', tried: ['/home/someone/app'],
    },
  });
  const { s, olive, l } = await setUp({ runner });
  try {
    const job = (await olive.person.json('/api/job/add-export')).body;
    assert.deepEqual(job.locate, { branch: 'feature/someone-elses', branchSource: 'git branch in app', branchGuessed: true });
    assert.equal(job.repo.branchGuessed, true);
    assert.equal(JSON.stringify(job).includes('/home/someone'), false, 'no path of the laptop’s');
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

test('a laptop back from sleep (suspended, not restarted) collects what waited on its next call', async () => {
  const s = await makeSite();
  const olive = await paired(s, 'olive.owner@example.test', 'Olive’s Mac');
  let asleep = false;
  const sleepy = async (url, init) => { while (asleep) await new Promise((r) => setTimeout(r, 20)); return s.fetch(url, init); };
  const l = await mirrorLaptop(s, olive.token, { fetch: sleepy });
  try {
    await synced(s, olive.runnerId);
    asleep = true; // the lid closes: the runner is frozen, its link with it
    await new Promise((r) => setTimeout(r, 100));
    s.clock.t += OFF;
    const r = await olive.person.send('POST', '/api/job/add-export/gate', { kind: 'approve', briefNumber: 2 });
    assert.equal(r.body.queued.state, 'waiting');
    assert.equal(l.runner.handled.length, 0);
    asleep = false; // it wakes
    await until(() => l.runner.handled.length === 1, { what: 'the approval to run after the wake' });
    await until(async () => (await olive.person.json('/api/decisions')).body.decisions[0]?.state === 'done', { what: 'done' });
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

test('the Screens PDF route answers 404 in words on the website, not 500', async () => {
  const { s, olive, l } = await setUp();
  try {
    const r = await olive.person.get('/api/jobs/add-export/wireframes/pack.pdf');
    assert.equal(r.status, 404);
    assert.match(await r.text(), /The Screens PDF is on your laptop\./);
  } finally { l.link.stop(); await s.close(); }
});

const AUTO_LOG = {
  on: true, stopped: null, tag: null,
  summary: ['Auto made 2 decisions on this job. The Approver cost $0.04.', 'Auto is on.', 'Last decision: 30 Oct 15:30, Plan: Go.'],
  entries: [
    { at: '2026-10-30T15:30:00.000Z', stage: 'Plan', chose: 'Go', asked: 'Start building?', why: 'The plan is small and reversible.' },
    { at: '2026-10-30T15:10:00.000Z', stage: 'Plan', chose: 'CSV', asked: 'Which format?', why: 'It is the recommended one.', risk: 'None.', answers: [{ question: 'Which format?', choice: 'CSV', reason: 'Recommended' }] },
  ],
};

test('turning Auto on from the website reaches the laptop and is done there', async () => {
  const { s, olive, l, runner } = await setUp();
  try {
    // Online: queued, handed over, run as the plain auto command, done.
    const r = await olive.person.send('POST', '/api/job/add-export/auto', { on: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.held, true);
    assert.match(r.body.queued.words, /^Auto on or off: /);
    await until(() => runner.handled.length === 1, { what: 'Auto to reach the laptop' });
    assert.deepEqual(runner.handled[0], { type: 'auto', slug: 'add-export', on: true });
    await until(async () => (await olive.person.json('/api/decisions')).body.decisions[0]?.state === 'done', { what: 'the decision to say done' });
    // It is Auto's own card line, not the gate's: the job's other decisions are not held back by it.
    const job = (await olive.person.json('/api/job/add-export')).body;
    assert.equal(job.queued, null);
    // Offline: it waits, and says so.
    closeLaptop(s, l);
    const off = await olive.person.send('POST', '/api/job/add-export/auto', { on: false });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal(off.body.queued.state, 'waiting');
    assert.equal(off.body.queued.words, 'Auto on or off: waiting for your laptop. It runs when the laptop is back.');
    const waiting = (await olive.person.json('/api/job/add-export')).body;
    assert.equal(waiting.autoQueued.state, 'waiting');
    assert.equal(waiting.queued, null);
    assert.equal((await olive.person.json('/api/snapshot')).body.jobs[0].autoQueued.state, 'waiting');
    assert.equal(runner.handled.length, 1, 'nothing runs while the laptop is off');
  } finally { l.link.stop(); await s.close(); }
});

test('the laptop’s refusal of Auto (L3) is shown back on the website', async () => {
  const { s, olive, l, runner } = await setUp();
  try {
    const L3 = 'Auto works up to L2. An L3 job needs you to approve each step.';
    runner.handle = async (cmd) => { runner.handled.push(cmd); throw new Error(L3); };
    await olive.person.send('POST', '/api/job/add-export/auto', { on: true });
    await until(async () => (await olive.person.json('/api/decisions')).body.decisions[0]?.state === 'failed', { what: 'the refusal' });
    const d = (await olive.person.json('/api/decisions')).body.decisions[0];
    assert.equal(d.words, `Auto on or off: your laptop couldn’t do it. ${L3}`);
    assert.equal((await olive.person.json('/api/job/add-export')).body.autoQueued.words, d.words);
  } finally { l.link.stop(); await s.close(); }
});

test('Auto start is a queued decision too: its words, what it is made on, and that it always holds', async () => {
  const { stateWords } = await import('../lib/queue.js');
  const { madeOnFor, stillMadeOn, decisionKind } = await import('../../dashboard/lib/made-on.js');
  assert.equal(stateWords({ kind: 'auto-start', state: 'waiting' }), 'Auto start: waiting for your laptop. It runs when the laptop is back.');
  assert.equal(stateWords({ kind: 'auto', state: 'done' }), 'Auto on or off: done on your laptop.');
  const start = { type: 'auto-start', on: true, tag: 'auto-ok' };
  assert.equal(decisionKind(start), 'auto-start');
  assert.deepEqual(madeOnFor(start, {}), { kind: 'settings' });
  assert.equal(stillMadeOn({ kind: 'settings' }, { job: null, permissions: [] }).ok, true);
  const on = { type: 'auto', slug: 'x', on: true };
  assert.equal(decisionKind(on), 'auto');
  assert.deepEqual(madeOnFor(on, { job: { slug: 'x', stage: 'plan' } }), { kind: 'job', slug: 'x' });
  assert.throws(() => madeOnFor(on, { job: null }), /no job like that/);
  // Auto on a job holds while the job is there, whatever stage it has moved to.
  assert.equal(stillMadeOn({ kind: 'job', slug: 'x' }, { job: { slug: 'x', stage: 'build' } }).ok, true);
  assert.equal(stillMadeOn({ kind: 'job', slug: 'x' }, { job: null }).ok, false);
  assert.equal(stillMadeOn({ kind: 'job', slug: 'x', stage: 'plan' }, { job: { slug: 'x', stage: 'build' } }).ok, false, 'a reply still holds to its stage');
});

test('What Auto decided on the website shows the laptop’s list, kept within the site’s limits and shown only to its owner', async () => {
  const runner = mirrorRunner();
  runner.autoLog = AUTO_LOG;
  const { s, olive, l } = await setUp({ runner });
  try {
    await until(async () => (await count(s, "SELECT count(*)::int AS n FROM records WHERE kind = 'auto-log'")) === 1, { what: 'the Auto record' });
    const shown = (await olive.person.json('/api/job/add-export/auto')).body;
    assert.deepEqual(shown, AUTO_LOG);
    // A job Auto has not run on has none.
    // From outside, the record is cleaned: 200 entries, each string capped, unknown keys dropped.
    const big = {
      on: true, stopped: 's'.repeat(5000), tag: 'auto-ok', extra: 'dropped',
      summary: ['a', 'b', 'c', 'd'],
      entries: Array.from({ length: 202 }, (_, i) => ({ at: '2026-10-30T15:30:00.000Z', stage: 'Plan', chose: `Go ${i}`, asked: 'q'.repeat(1010), why: '<img src=x onerror=alert(1)>', notes: 'x', secret: 'y' })),
    };
    const e = makeEvent('record', { kind: 'auto-log', key: 'add-export', value: big }, { job: 'add-export' });
    const rr = await (await post(s, olive.token, '/api/runner/events', { events: [{ eid: 'al-1', ...e.event }] })).json();
    assert.equal(rr.accepted, 1, JSON.stringify(rr));
    const kept = (await olive.person.json('/api/job/add-export/auto')).body;
    assert.equal(kept.entries.length, 200);
    assert.ok(kept.entries.every((x) => x.asked.length <= 1000 && !('secret' in x) && !('notes' in x)));
    assert.equal(kept.entries[0].why, '<img src=x onerror=alert(1)>', 'kept as text, never as markup');
    assert.ok(kept.stopped.length <= 300);
    assert.deepEqual(kept.summary, ['a', 'b', 'c']);
    assert.ok(!('extra' in kept));
    // Not the right shape: the earlier record goes, and nothing is shown.
    const bad = makeEvent('record', { kind: 'auto-log', key: 'add-export', value: { on: 'yes', summary: 'no', entries: 'no' } }, { job: 'add-export' });
    await post(s, olive.token, '/api/runner/events', { events: [{ eid: 'al-2', ...bad.event }] });
    assert.equal((await olive.person.get('/api/job/add-export/auto')).status, 404);
    // Someone else's job is not there to read.
    const sam = browser(s.fetch);
    await signIn(sam, { email: 'sam.sample@example.test' });
    assert.equal((await sam.json('/api/job/add-export/auto')).status, 404);
  } finally { l.link.stop(); await s.close(); }
});

test('the website cannot set by: auto', async () => {
  const { parseCommand } = await import('../../dashboard/lib/protocol.js');
  const { s, olive, l, runner } = await setUp();
  try {
    // A raw command with by: it is refused, from the site and even from the laptop's own page.
    for (const from of ['site', 'local']) {
      const raw = parseCommand({ type: 'auto', slug: 'add-export', on: true, by: 'auto' }, { from });
      assert.equal(raw.ok, false);
      assert.match(raw.error, /doesn’t take “by”/);
    }
    assert.equal(parseCommand({ type: 'auto-start', on: true, tag: 'x', by: 'auto' }, { from: 'site' }).ok, false);
    // Through the website's route: the extra field is not carried, and the queued command is the plain one.
    const r = await olive.person.send('POST', '/api/job/add-export/auto', { on: true, by: 'auto', tag: 'x', slug: 'other-job', type: 'approve' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await until(() => runner.handled.length === 1, { what: 'Auto to reach the laptop' });
    // The website carries only what it reads (slug from the address, on): the extra fields are not the laptop's to see.
    assert.deepEqual(runner.handled[0], { type: 'auto', slug: 'add-export', on: true });
    const stored = (await s.db.query("SELECT command FROM decisions WHERE kind = 'auto'")).rows[0].command;
    assert.deepEqual(typeof stored === 'string' ? JSON.parse(stored) : stored, { type: 'auto', slug: 'add-export', on: true });
    // Nor does anything queued for the laptop carry it.
    const sent = (await s.db.query('SELECT command FROM commands')).rows.map((x) => JSON.stringify(x.command));
    assert.ok(sent.every((c) => !c.includes('"by":"auto"')));
  } finally { l.link.stop(); await s.close(); }
});

test('the website keeps what the laptop sends of a long Auto list: the laptop and the site cut to the same numbers', async () => {
  const { cleanAutoLog } = await import('../lib/records.js');
  const { autoLogRecord, fit, RECORD_MAX } = await import('../../dashboard/runner/mirror.js');
  const { AUTO_LOG_LIMITS: L } = await import('../../dashboard/lib/auto-log.js');
  assert.deepEqual({ ...L }, { entries: 200, text: 1000, answers: 20, line: 400, summary: 3, at: 40, stage: 100, stopped: 300, tag: 100 });
  const long = 'w'.repeat(5000);
  const entries = Array.from({ length: 500 }, (_, i) => ({ at: '2026-11-11T08:00:00.000Z', stage: 'Plan', chose: `Go ${i}`, asked: long, why: long, risk: long, answers: Array.from({ length: 30 }, () => ({ question: long, choice: long, reason: long })) }));
  const sent = fit('auto-log', autoLogRecord({ on: true, stopped: null, tag: null, summary: [long, long, long], entries }));
  assert.ok(Buffer.byteLength(JSON.stringify(sent)) < RECORD_MAX);
  const kept = cleanAutoLog(sent);
  assert.ok(kept, 'the site does not refuse it');
  assert.equal(kept.entries[0].chose, 'Go 0');
  assert.deepEqual(kept.entries, sent.entries, 'the site cuts nothing more');
  // The site's own cleaner cuts at the same numbers.
  const wide = cleanAutoLog({ on: true, summary: [], entries: Array.from({ length: 300 }, () => ({ at: 'x', stage: 'Plan', chose: long, asked: 'a', why: 'w', answers: Array.from({ length: 30 }, () => ({ question: long, choice: 'c', reason: 'r' })) })) });
  assert.equal(wide.entries.length, L.entries);
  assert.equal(wide.entries[0].chose.length, L.text);
  assert.equal(wide.entries[0].answers.length, L.answers);
});

test('the website keeps the start time, the ticket and each entry’s kind and step, and cleans them', async () => {
  const { cleanAutoLog } = await import('../lib/records.js');
  const { AUTO_LOG_LIMITS: L } = await import('../../dashboard/lib/auto-log.js');
  const rec = {
    on: true, stopped: 'A migration needs you.', tag: 'auto-ok', summary: ['a', 'b', 'c'], startedAt: '2026-11-11T08:00:00.000Z', ticket: 'ORBIT-479',
    entries: [
      { at: '2026-11-11T08:09:00.000Z', stage: 'Build', chose: 'A migration needs you.', asked: '', why: '', kind: 'stop', stop: 'build' },
      { at: '2026-11-11T08:05:00.000Z', stage: 'Plan', chose: 'Approved', asked: 'Brief 1', why: 'It matches.', kind: 'approve', stop: 'plan' },
      { at: '2026-11-11T08:04:00.000Z', stage: 'Plan', chose: 'Yes', asked: 'Keep it?', why: 'Safer.', kind: 'answer', stop: null },
    ],
  };
  assert.deepEqual(cleanAutoLog(rec), rec, 'a record with the new fields comes out with them');
  // A record from an older laptop comes out as before: no new key is added.
  const old = { on: true, stopped: null, tag: null, summary: ['a', 'b', 'c'], entries: [{ at: 'x', stage: 'Plan', chose: 'c', asked: 'a', why: 'w' }] };
  assert.deepEqual(cleanAutoLog(old), old);
  // A kind that is not one of the four is left out; a step that is not one is null; the two facts are cleaned like the others.
  const bad = cleanAutoLog({
    ...rec, startedAt: 5, ticket: 'T'.repeat(500),
    entries: [{ ...rec.entries[0], kind: 'merge', stop: 'deploy' }, { ...rec.entries[1], kind: 7, stop: 3 }, { ...rec.entries[2], kind: 'allow', stop: 'test' }],
  });
  assert.equal(bad.startedAt, null);
  assert.equal(bad.ticket.length, L.tag);
  assert.deepEqual(bad.entries.map((e) => ['kind' in e ? e.kind : 'none', e.stop]), [['none', null], ['none', null], ['allow', 'test']]);
});

test('Auto on the website: another person’s job is a 404 and a flag that is not true or false is a 400, and nothing is queued either way', async () => {
  const { s, olive, l, runner } = await setUp();
  try {
    const sam = browser(s.fetch);
    await signIn(sam, { email: 'sam.sample@example.test' });
    const queued = async () => [(await s.db.query('SELECT count(*)::int AS n FROM commands')).rows[0].n, (await s.db.query("SELECT count(*)::int AS n FROM decisions WHERE kind = 'auto'")).rows[0].n];
    const before = await queued();
    assert.equal((await sam.send('POST', '/api/job/add-export/auto', { on: true })).status, 404);
    assert.equal((await olive.person.send('POST', '/api/job/add-export/auto', { on: 'yes' })).status, 400);
    assert.equal((await olive.person.send('POST', '/api/job/add-export/auto', {})).status, 400);
    assert.deepEqual(await queued(), before);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(runner.handled.length, 0, 'the laptop was sent nothing');
  } finally { l.link.stop(); await s.close(); }
});

test('the website accepts an upload for a video the progress names', async () => {
  const runner = mirrorRunner();
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'abc1234', 'AC-1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'abc1234', 'AC-1', 'video.webm'), Buffer.from('a video, not really'));
  runner.evidenceDir = dir;
  // Part way through a recording: no evidence.json yet, the first line done with its video.
  const progress = { commit: 'abc1234', startedAt: '2026-11-11T09:00:00.000Z', line: 2, of: 2, lines: [
    { id: 'AC-1', title: 'Export button', state: 'passed', video: 'abc1234/AC-1/video.webm', at: '2026-11-11T09:01:00.000Z' },
    { id: 'AC-2', title: 'Hidden from technicians', state: 'running', video: null, at: '2026-11-11T09:01:00.000Z' },
  ] };
  runner.local.evidence.view = async () => ({ evidence: null, commit: 'abc1234', wanted: true, why: null, recording: true, problem: null, progress, folder: '/home/someone/ev', folderUrl: 'file:///home/someone/ev/' });
  const { s, olive, l } = await setUp({ runner });
  try {
    await until(async () => (await count(s, 'SELECT count(*)::int AS n FROM evidence_files WHERE uploaded_at IS NOT NULL')) === 1, { what: 'the video to upload' });
    const row = (await s.db.query('SELECT file, pathname, content_type FROM evidence_files')).rows[0];
    const personId = (await s.db.query('SELECT person_id FROM runners WHERE id = $1', [olive.runnerId])).rows[0].person_id;
    assert.deepEqual(row, { file: 'abc1234/AC-1/video.webm', pathname: `evidence/${personId}/${olive.runnerId}/add-export/abc1234/AC-1/video.webm`, content_type: 'video/webm' });
    assert.equal(s.site.ctx.blob.files.get(row.pathname).bytes.toString(), 'a video, not really');
    const view = (await olive.person.json('/api/job/add-export/evidence')).body;
    assert.equal(view.progress.lines[0].video, 'abc1234/AC-1/video.webm');
    assert.deepEqual(view.onSite, ['abc1234/AC-1/video.webm']);
    const link = await olive.person.get('/api/job/add-export/evidence/file?path=abc1234%2FAC-1%2Fvideo.webm');
    assert.equal(link.status, 302);
    assert.equal(await (await s.fetch(link.headers.get('location'))).text(), 'a video, not really');
    // Only what the progress names, and never outside the job's own place.
    const ask = (body) => post(s, olive.token, '/api/runner/evidence/upload', body);
    assert.equal((await ask({ slug: 'add-export', file: 'abc1234/AC-2/video.webm', type: 'video/webm', size: 10 })).status, 404, 'a line still running names no video');
    assert.equal((await ask({ slug: 'add-export', file: '../abc1234/AC-1/video.webm', type: 'video/webm', size: 10 })).status, 400);
    assert.equal((await ask({ slug: 'add-export', file: '/abc1234/AC-1/video.webm', type: 'video/webm', size: 10 })).status, 400);
  } finally { l.link.stop(); await s.close(); }
});

test('the website has no live picture and says where it is', async () => {
  const runner = mirrorRunner();
  // The laptop is recording and could be watched there.
  const progress = { commit: 'abc1234', startedAt: '2026-11-11T09:00:00.000Z', line: 1, of: 1, lines: [
    { id: 'AC-1', title: 'Export button', state: 'running', video: null, at: '2026-11-11T09:00:01.000Z' },
  ] };
  runner.local.evidence.view = async () => ({ evidence: null, commit: 'abc1234', wanted: true, why: null, recording: true, watch: true, problem: null, progress, folder: '/home/someone/ev', folderUrl: 'file:///home/someone/ev/' });
  const { s, olive, l } = await setUp({ runner });
  try {
    const view = (await olive.person.json('/api/job/add-export/evidence')).body;
    assert.equal(view.recording, true, 'the laptop’s recording shows');
    assert.equal(view.watch, false, 'Watch is on the laptop only');
    const live = await olive.person.json('/api/job/add-export/evidence/live');
    assert.equal(live.status, 404);
    assert.equal(live.body.error, 'The live picture shows on your laptop.');
    // Nor can the laptop send one up.
    const ask = await post(s, olive.token, '/api/runner/evidence/upload', { slug: 'add-export', file: 'abc1234/run/live.jpg', type: 'image/jpeg', size: 10 });
    assert.equal(ask.status, 404);
    assert.equal(await count(s, 'SELECT count(*)::int AS n FROM evidence_files'), 0);
  } finally { l.link.stop(); await s.close(); }
});
