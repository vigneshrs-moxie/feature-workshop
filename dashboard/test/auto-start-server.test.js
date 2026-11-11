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
    assert.deepEqual(first.autoStart, { on: false, tag: '', paused: null });
    assert.equal(first.tagsShown, true);
    assert.deepEqual(first.items.find((i) => i.key === 'ORBIT-1').tags, ['auto']);
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'x'.repeat(61) } } })).status, 400);
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: 'yes', tag: 'a' } } })).status, 400);
    assert.equal((await write('POST', '/api/settings', { workflow: { autoStart: { on: true } } })).status, 400);
    const ok = await write('POST', '/api/settings', { workflow: { autoStart: { on: false, tag: '  nightly  ' } } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.workflow.autoStart, { on: false, tag: 'nightly' });
    assert.deepEqual((await inbox()).autoStart, { on: false, tag: 'nightly', paused: null });
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

test('a tagged ticket is tried once, an untagged one never', { timeout: 90_000 }, async () => {
  await withDashboard(() => [row(1, ['Auto']), row(2, []), row(3, ['other'], { subject: 'auto', description: 'tag auto' })], async ({ dirs, write, inbox, until }) => {
    await until(async () => (await inbox()).items?.length === 3, 'the list');
    const set = await write('POST', '/api/settings', { workflow: { autoStart: { on: true, tag: 'auto' } } });
    assert.equal(set.status, 200);
    const mem = await until(async () => { const m = await memoryOf(dirs); return m?.started?.[0]?.slug || m?.failed?.length ? m : null; }, 'the memory file');
    // This test machine has no repository registered for Orbit's tickets, so the start may fail: either way it is remembered once.
    assert.deepEqual([...mem.started, ...mem.failed].map((e) => e.key), ['ORBIT-1']);
    if (mem.started.length) {
      assert.equal(mem.started[0].tag, 'auto');
      const sessions = JSON.parse(await fs.readFile(path.join(dirs.state, 'sessions.json'), 'utf8'));
      const rec = Object.values(sessions).find((v) => v.auto);
      assert.equal(rec.auto.on, true);
      assert.equal(rec.auto.by, 'tag');
      assert.equal(rec.auto.tag, 'auto');
    } else {
      const b = await until(async () => { const x = await inbox(); return x.items.find((i) => i.key === 'ORBIT-1')?.autoStartFailed ? x : null; }, 'the failed row');
      assert.match(b.items.find((i) => i.key === 'ORBIT-1').autoStartFailed, /\w/);
    }
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
