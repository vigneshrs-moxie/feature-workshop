// Auto start through a running (demo) dashboard and a fake Orbit: the setting, the start with Auto
// on by the tag, the memory file in the state folder. No model is called; Orbit only sees GET.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startDashboard } from './helpers/dashboard.js';

const TOKEN = `orbfb_${'a'.repeat(43)}`;
const row = (n, tags, o = {}) => ({ id: `id-${n}`, number: n, subject: `Problem ${n}`, type: 'bug', status: 'open', severity: 'medium', priority: null, queuePosition: null, storyPoints: 2, description: `auto ${n}`, createdAt: `2026-10-0${n}T00:00:00Z`, activityAt: `2026-10-0${n}T00:00:00Z`, ...(tags ? { tags: tags.map((name, i) => ({ id: `t${i}`, name, color: 'blue', archived: false })) } : {}), ...o });

async function withDashboard(rowsNow, body) {
  const methods = [];
  const orbit = http.createServer((req, res) => {
    methods.push(req.method);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const rows = rowsNow();
    res.end(JSON.stringify({ audience: 'tech', total: rows.length, tickets: rows }));
  });
  await new Promise((r) => orbit.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${orbit.address().port}`;
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sb-autostart-srv-')));
  const dirs = Object.fromEntries(['feature-work', 'state', 'projects', 'agents', 'skills', 'home'].map((d) => [d, path.join(root, d)]));
  for (const d of Object.values(dirs)) await fs.mkdir(d, { recursive: true });
  const d = await startDashboard({ env: { HOME: dirs.home, STARBASE_FEATURES_DIR: dirs['feature-work'], STARBASE_PROJECTS_DIR: dirs.projects, STARBASE_AGENTS_DIR: dirs.agents, STARBASE_SKILLS_DIR: dirs.skills, STARBASE_STATE_DIR: dirs.state, STARBASE_ORBIT_URL: '', STARBASE_USER: 'vignesh', STARBASE_DIR: '' } });
  try {
    const token = (await (await fetch(`${d.base}/api/meta`)).json()).token;
    const write = async (method, p, b = {}) => {
      const res = await fetch(d.base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Starbase-Token': token }, body: JSON.stringify(b) });
      return { status: res.status, body: await res.json() };
    };
    const inbox = async () => (await fetch(`${d.base}/api/orbit/inbox`)).json();
    const until = async (fn, what) => {
      for (let i = 0; i < 100; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
      throw new Error(`Timed out waiting for ${what}`);
    };
    assert.equal((await write('POST', '/api/orbit/token', { token: TOKEN, url })).status, 200);
    await body({ d, dirs, write, inbox, until });
    assert.deepEqual([...new Set(methods)], ['GET'], 'Orbit only ever sees GET');
  } finally {
    await d.stop();
    await new Promise((r) => { orbit.closeAllConnections?.(); orbit.close(r); });
    await fs.rm(root, { recursive: true, force: true });
  }
}

const memoryOf = async (dirs) => JSON.parse(await fs.readFile(path.join(dirs.state, 'auto-start.json'), 'utf8').catch(() => 'null'));

test('the setting is saved trimmed, refused when wrong, and the inbox answer carries it with tagsShown', { timeout: 60_000 }, async () => {
  await withDashboard(() => [row(1, ['auto']), row(2, [])], async ({ write, inbox, until }) => {
    const first = await until(async () => { const b = await inbox(); return b.items?.length === 2 ? b : null; }, 'the list');
    assert.deepEqual(first.autoStart, { on: false, tag: '', max: 5, paused: null });
    assert.equal(first.tagsShown, true);
    assert.deepEqual(first.items.find((i) => i.key === 'ORBIT-1').tags, ['auto']);
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'x'.repeat(61) } } })).status, 400);
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: 'yes', tag: 'a' } } })).status, 400);
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: true } } })).status, 400);
    const ok = await write('POST', '/api/settings', { workflow: { autoStart: { on: false, tag: '  nightly  ' } } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.workflow.autoStart, { on: false, tag: 'nightly', max: 5 });
    assert.deepEqual((await inbox()).autoStart, { on: false, tag: 'nightly', max: 5, paused: null });
  });
});

test('with the switch off, or no tag, no job starts and no memory file is written', { timeout: 60_000 }, async () => {
  await withDashboard(() => [row(1, ['auto'])], async ({ dirs, write, inbox, until }) => {
    await until(async () => (await inbox()).items?.length === 1, 'the list');
    await write('POST', '/api/settings', { workflow: { autoStart: { on: false, tag: 'auto' } } });
    await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: '' } } });
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(await memoryOf(dirs), null);
    assert.deepEqual(await fs.readdir(dirs['feature-work']), []);
  });
});

test('Orbit showing no tags to this token: nothing starts, and the answer says so', { timeout: 60_000 }, async () => {
  await withDashboard(() => [row(1, null, { description: 'auto' })], async ({ dirs, write, inbox, until }) => {
    const b = await until(async () => { const x = await inbox(); return x.items?.length === 1 ? x : null; }, 'the list');
    assert.equal(b.tagsShown, false);
    await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'auto' } } });
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(await memoryOf(dirs), null);
  });
});

test('with no repository registered, a tagged ticket fails to start, once, says why on its row and in the queue, and tells nobody; an untagged one is never tried', { timeout: 90_000 }, async () => {
  await withDashboard(() => [row(1, ['Auto']), row(2, []), row(3, ['other'], { subject: 'auto', description: 'tag auto' })], async ({ d, dirs, write, inbox, until }) => {
    await until(async () => (await inbox()).items?.length === 3, 'the list');
    const set = await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'auto' } } });
    assert.equal(set.status, 200);
    // This dashboard has no repository registered for Orbit's tickets: the start must fail, and is remembered once.
    const mem = await until(async () => { const m = await memoryOf(dirs); return m?.failed?.length ? m : null; }, 'the failed start');
    assert.deepEqual(mem.started, []);
    assert.deepEqual(mem.failed.map((e) => e.key), ['ORBIT-1']);
    assert.match(mem.failed[0].reason, /repository/);
    const b = await until(async () => { const x = await inbox(); return x.items.find((i) => i.key === 'ORBIT-1')?.autoStartFailed ? x : null; }, 'the failed row');
    assert.match(b.items.find((i) => i.key === 'ORBIT-1').autoStartFailed, /repository/);
    assert.deepEqual(await fs.readdir(dirs['feature-work']), [], 'no job folder');
    const q = await until(async () => { const s = (await (await fetch(`${d.base}/api/snapshot`)).json()).autoQueue; return s?.tickets?.some((t) => t.key === 'ORBIT-1') ? s : null; }, 'the queue');
    const failed = q.tickets.find((t) => t.key === 'ORBIT-1');
    const history = (await (await fetch(`${d.base}/api/notifications`)).json()).history ?? [];
    assert.deepEqual({ notes: history, group: failed.group, reason: /repository/.test(failed.reason ?? '') }, { notes: [], group: 'failed', reason: true }, 'no notification, and the snapshot\'s autoQueue lists it as failed with its reason');
    await new Promise((r) => setTimeout(r, 500));
    const after = await memoryOf(dirs);
    assert.equal(after.started.length + after.failed.length, 1, 'once only');
  });
});

test('with a repository registered, the ticket starts a job with Auto on by the tag, and the next starts too (up to five at a time)', { timeout: 90_000 }, async () => {
  await withDashboard(() => [row(1, ['auto']), row(2, ['auto'])], async ({ dirs, write, inbox, until }) => {
    const repo = path.join(dirs.home, 'widgets');
    await fs.mkdir(repo);
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'start');
    git('remote', 'add', 'origin', 'git@github.com:acme/widgets.git');
    git('remote', 'add', 'upstream', 'git@github.com:acme-org/widgets.git');
    await fs.writeFile(path.join(repo, 'starbase.md'), '---\nname: Widgets\ngithub: acme-org/widgets\nremotes:\n  fork: origin\n  org: upstream\n---\nNotes.\n');
    const reg = await write('POST', '/api/repos/registry', { path: repo });
    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    await until(async () => (await inbox()).items?.length === 2, 'the list');
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'auto' } } })).status, 200);
    const mem = await until(async () => { const m = await memoryOf(dirs); return m?.started?.[0]?.slug || m?.failed?.length ? m : null; }, 'the memory file');
    assert.deepEqual(mem.failed, []);
    assert.equal(mem.started[0].key, 'ORBIT-1');
    const sessions = JSON.parse(await fs.readFile(path.join(dirs.state, 'sessions.json'), 'utf8'));
    const rec = Object.values(sessions).find((v) => v.auto);
    assert.deepEqual({ on: rec.auto.on, by: rec.auto.by, tag: rec.auto.tag }, { on: true, by: 'tag', tag: 'auto' });
    const both = await until(async () => { const m = await memoryOf(dirs); return m?.started?.length === 2 && m.started.every((e) => e.slug) ? m : null; }, 'the second start');
    assert.deepEqual(both.started.map((e) => e.key), ['ORBIT-1', 'ORBIT-2'], 'the second starts while the first has no PR #1: five places');
    assert.deepEqual(both.failed, []);
  });
});

// ---------- Auto queue: every working Auto job holds a place; N is the setting ----------

/** A job folder written straight into feature-work, as a job he started himself (no ticket, no Auto). */
async function writeHandJob(dirs, slug) {
  const dir = path.join(dirs['feature-work'], slug);
  await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ schema_version: 1, slug, title: `Hand ${slug}`, route: 'quick', stage: 'implement', stage_state: 'working', updated_at: new Date().toISOString() }, null, 2));
  await fs.writeFile(path.join(dir, 'options.json'), JSON.stringify({ schema_version: 2, level: 1, flow: 'quick', title: `Hand ${slug}` }, null, 2));
  return dir;
}
const sessionsOf = async (dirs) => JSON.parse(await fs.readFile(path.join(dirs.state, 'sessions.json'), 'utf8').catch(() => '{}'));

test('the setting takes max of 1 to 10, refuses anything else in plain words, and keeps the saved max when none is sent', { timeout: 60_000 }, async () => {
  await withDashboard(() => [row(1, [])], async ({ write, inbox, until }) => {
    await until(async () => (await inbox()).items?.length === 1, 'the list');
    for (const max of [0, 11, 2.5, '3', null]) {
      const bad = await write('POST', '/api/settings', { workflow: { autoStart: { on: false, tag: 'auto', max } } });
      assert.equal(bad.status, 400, String(max));
      assert.equal(bad.body.error ?? bad.body.message, 'Auto start: on or off, a tag of at most 60 characters, and 1 to 10 jobs at a time.');
    }
    const three = await write('POST', '/api/settings', { workflow: { autoStart: { on: false, tag: 'auto', max: 3 } } });
    assert.equal(three.status, 200);
    assert.deepEqual(three.body.workflow.autoStart, { on: false, tag: 'auto', max: 3 });
    const kept = await write('POST', '/api/settings', { workflow: { autoStart: { on: false, tag: 'nightly' } } });
    assert.deepEqual(kept.body.workflow.autoStart, { on: false, tag: 'nightly', max: 3 }, 'no max sent: his N stays');
    assert.deepEqual((await inbox()).autoStart, { on: false, tag: 'nightly', max: 3, paused: null });
  });
});

test('a job he switches to Auto by hand counts as a place, and the switch is never refused for places', { timeout: 60_000 }, async () => {
  await withDashboard(() => [row(1, ['auto'])], async ({ d, dirs, write, inbox, until }) => {
    await writeHandJob(dirs, 'hand-one');
    await writeHandJob(dirs, 'hand-two');
    await until(async () => (await inbox()).items?.length === 1, 'the list');
    await until(async () => (await fetch(`${d.base}/api/job/hand-two`)).status === 200, 'the two jobs');
    const one = await write('POST', '/api/job/hand-one/auto', { on: true });
    assert.equal(one.status, 200, JSON.stringify(one.body));
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'auto', max: 1 } } })).status, 200);
    const two = await write('POST', '/api/job/hand-two/auto', { on: true });
    assert.equal(two.status, 200, JSON.stringify(two.body));
    assert.equal(two.body.auto.on, true);
    await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'auto', max: 1 } } }); // a pass with both on
    await new Promise((r) => setTimeout(r, 800));
    // The one place is his hand-switched job's: the tagged ticket is not even tried.
    assert.equal(await memoryOf(dirs), null);
    assert.deepEqual((await fs.readdir(dirs['feature-work'])).sort(), ['hand-one', 'hand-two']);
    const sessions = await sessionsOf(dirs);
    for (const slug of ['hand-one', 'hand-two']) {
      const rec = sessions[path.join(dirs['feature-work'], slug)]?.auto;
      assert.deepEqual({ on: rec?.on, stopped: rec?.stopped ?? null, began: rec?.began }, { on: true, stopped: null, began: 'you' }, slug);
    }
    // The positive control: with a third place the same save's pass does try the ticket (it fails here, no repository is
    // registered). So the passes above ran, and held it back for the places alone.
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'auto', max: 3 } } })).status, 200);
    const tried = await until(async () => { const m = await memoryOf(dirs); return m?.failed?.length ? m : null; }, 'the ticket to be tried');
    assert.deepEqual(tried.failed.map((e) => e.key), ['ORBIT-1']);
  });
});

test('removing the tag holds back only a ticket not started', { timeout: 90_000 }, async () => {
  let tagged = true;
  let back = false; // the positive control at the end puts the tag back on ORBIT-2
  await withDashboard(() => [row(1, tagged ? ['auto'] : []), row(2, tagged || back ? ['auto'] : [])], async ({ d, dirs, write, inbox, until }) => {
    const repo = path.join(dirs.home, 'widgets');
    await fs.mkdir(repo);
    const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'start');
    git('remote', 'add', 'origin', 'git@github.com:acme/widgets.git');
    git('remote', 'add', 'upstream', 'git@github.com:acme-org/widgets.git');
    await fs.writeFile(path.join(repo, 'starbase.md'), '---\nname: Widgets\ngithub: acme-org/widgets\nremotes:\n  fork: origin\n  org: upstream\n---\nNotes.\n');
    assert.equal((await write('POST', '/api/repos/registry', { path: repo })).status, 200);
    await until(async () => (await inbox()).items?.length === 2, 'the list');
    // One place: the first ticket starts, the second waits for it.
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'auto', max: 1 } } })).status, 200);
    const mem = await until(async () => { const m = await memoryOf(dirs); return m?.started?.[0]?.slug ? m : null; }, 'the first start');
    assert.deepEqual(mem.started.map((e) => e.key), ['ORBIT-1']);
    const slug = mem.started[0].slug;
    // The tag comes off both tickets in Orbit, and the Inbox reads it again.
    tagged = false;
    await until(async () => {
      const b = await (await fetch(`${d.base}/api/orbit/inbox?refresh=1`)).json();
      return b.items?.length === 2 && b.items.every((i) => Array.isArray(i.tags) && i.tags.length === 0);
    }, 'the tags to be gone');
    // A free place now (N is 2): still the second ticket does not start, it has lost its tag.
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'auto', max: 2 } } })).status, 200);
    await new Promise((r) => setTimeout(r, 800));
    const after = await memoryOf(dirs);
    assert.deepEqual(after.started.map((e) => e.key), ['ORBIT-1'], 'the ticket not started is held back');
    assert.deepEqual(after.failed, []);
    // The started job is still an Auto job.
    const rec = Object.entries(await sessionsOf(dirs)).find(([dir]) => path.basename(dir) === slug)?.[1]?.auto;
    assert.equal(rec?.began, 'tag');
    assert.equal(rec?.on, true, `still in Auto: ${JSON.stringify(rec)}`);
    // The positive control: the tag back on ORBIT-2, and the same save starts it. So the pass above ran, and held it back for its tag alone.
    back = true;
    await until(async () => {
      const b = await (await fetch(`${d.base}/api/orbit/inbox?refresh=1`)).json();
      return b.items?.find((i) => i.key === 'ORBIT-2')?.tags?.includes('auto');
    }, 'the tag to be back');
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'auto', max: 2 } } })).status, 200);
    const both = await until(async () => { const m = await memoryOf(dirs); return m?.started?.length === 2 && m.started.every((e) => e.slug) ? m : null; }, 'ORBIT-2 to start');
    assert.deepEqual(both.started.map((e) => e.key), ['ORBIT-1', 'ORBIT-2']);
  });
});

// ---------- Auto queue: the snapshot's autoQueue from a real Inbox, and the page hears it change ----------

/** The change events that carry the queue (queue: true), from the ring of v2 events. */
function queueChanges(base, epoch, ms = 300) {
  return new Promise((resolve) => {
    const seen = [];
    const req = http.get(`${base}/api/events?v=2&since=0&epoch=${epoch}`, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const data = buf.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
          buf = buf.slice(i + 2);
          if (data) seen.push(JSON.parse(data.slice(6)));
        }
      });
    });
    req.on('error', () => {});
    setTimeout(() => { req.destroy(); resolve(seen.filter((e) => e.type === 'change' && e.data?.queue === true).length); }, ms);
  });
}

test('the snapshot\'s autoQueue lists the Inbox\'s Auto tickets: couldn\'t start, working by its job, next up; untagged ones not at all', { timeout: 90_000 }, async () => {
  let rows = [row(1, ['auto']), row(2, []), row(5, ['auto'])];
  await withDashboard(() => rows, async ({ d, dirs, write, inbox, until }) => {
    await writeHandJob(dirs, 'orbit-5-hand');
    await until(async () => (await inbox()).items?.length === 3, 'the list');
    await until(async () => (await fetch(`${d.base}/api/job/orbit-5-hand`)).status === 200, 'the job');
    assert.equal((await write('POST', '/api/job/orbit-5-hand/auto', { on: true })).status, 200);
    // Two places, one taken by his job: ORBIT-1 is tried and fails (no repository registered).
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'auto', max: 2 } } })).status, 200);
    await until(async () => (await memoryOf(dirs))?.failed?.length === 1, 'the failed start');
    // One place now, taken: a new tagged ticket waits.
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'auto', max: 1 } } })).status, 200);
    rows = [...rows, row(6, ['auto'])];
    await until(async () => (await (await fetch(`${d.base}/api/orbit/inbox?refresh=1`)).json()).items?.length === 4, 'the new ticket');
    const q = await until(async () => {
      const s = (await (await fetch(`${d.base}/api/snapshot`)).json()).autoQueue;
      return s?.tickets?.some((t) => t.key === 'ORBIT-6') ? s : null;
    }, 'the queue with ORBIT-6');
    const byKey = Object.fromEntries(q.tickets.map((t) => [t.key, t]));
    assert.deepEqual(Object.keys(byKey).sort(), ['ORBIT-1', 'ORBIT-5', 'ORBIT-6']);
    assert.equal(byKey['ORBIT-1'].group, 'failed');
    assert.match(byKey['ORBIT-1'].reason, /repository/);
    assert.deepEqual(byKey['ORBIT-5'], { key: 'ORBIT-5', title: 'Problem 5', group: 'working', slug: 'orbit-5-hand', reason: null });
    assert.deepEqual(byKey['ORBIT-6'], { key: 'ORBIT-6', title: 'Problem 6', group: 'next', slug: null, reason: null });
    assert.deepEqual({ on: q.on, tag: q.tag, max: q.max, working: q.working, unfinished: q.unfinished, paused: q.paused }, { on: true, tag: 'auto', max: 1, working: 1, unfinished: 1, paused: null });
  });
});

test('the page hears the queue: a pass that marks a ticket failed sends one change, the Inbox list changing one, a look that changes nothing none', { timeout: 90_000 }, async () => {
  let rows = [row(1, [])];
  await withDashboard(() => rows, async ({ d, dirs, write, inbox, until }) => {
    const settle = () => new Promise((r) => setTimeout(r, 800));
    const count = async () => queueChanges(d.base, (await (await fetch(`${d.base}/api/snapshot`)).json()).epoch);
    await until(async () => (await inbox()).items?.length === 1, 'the list');
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'auto' } } })).status, 200);
    await settle();
    const n0 = await count();
    assert.ok(n0 >= 1, 'the setting itself is a queue change');
    // The Inbox read again with nothing changed: the starter's pass changes nothing, no change is sent.
    await fetch(`${d.base}/api/orbit/inbox?refresh=1`);
    await settle();
    assert.equal(await count(), n0, 'nothing differs: no change');
    // The tag goes on: the pass tries it and it fails (no repository). One change for the look.
    rows = [row(1, ['auto'])];
    await fetch(`${d.base}/api/orbit/inbox?refresh=1`);
    await until(async () => (await memoryOf(dirs))?.failed?.length === 1, 'the failed start');
    await settle();
    assert.equal(await count(), n0 + 1, 'the failed start');
    // A new untagged ticket: the Inbox list changed, the starter changes nothing. One change.
    rows = [row(1, ['auto']), row(2, [])];
    await fetch(`${d.base}/api/orbit/inbox?refresh=1`);
    await settle();
    assert.equal(await count(), n0 + 2, 'the Inbox list changed');
  });
});
