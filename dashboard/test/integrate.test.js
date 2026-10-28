// The integration board (lib/integrate.js and /api/integrate/*): a temp git repository with a
// main checkout and packet worktrees, never the real one. The test commands are tiny node
// scripts, so no real test suite runs and nothing calls a model.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  Integrator, listPackets, mergeNext, parseOwns, ownedMatcher, outsideOwned, briefTitle, cleanOrder, runningJobFor, parseWorktrees, DEFAULT_ORDER,
} from '../lib/integrate.js';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const PASS = [{ label: 'pretend tests', cmd: process.execPath, args: ['-e', 'console.log("all good")'], cwd: '.' }];
const FAIL = [{ label: 'pretend tests', cmd: process.execPath, args: ['-e', 'console.error("broken"); process.exit(1)'], cwd: '.' }];

let tmp;
before(async () => { tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'gc-integrate-'))); });
after(async () => { if (tmp) await fs.rm(tmp, { recursive: true, force: true }); });

const g = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });

async function write(dir, rel, text) {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fs.writeFile(path.join(dir, rel), text);
}

/**
 * A repository: main checkout `main` with two briefs, a bare remote `origin`, and two packet
 * worktrees. C adds its own file; D changes shared.txt (which main changes too when `conflict`)
 * and a file outside its Owns list.
 */
async function fixture(name, { conflict = false } = {}) {
  const dir = path.join(tmp, name);
  const main = path.join(dir, 'main');
  await fs.mkdir(main, { recursive: true });
  g(main, 'init', '-q', '-b', 'main');
  g(main, 'config', 'user.email', 'test@example.com');
  g(main, 'config', 'user.name', 'Test');
  g(main, 'config', 'commit.gpgsign', 'false');
  await write(main, 'shared.txt', 'one\n');
  await write(main, 'docs/plans/packets/C-job-lock.md', '# Packet C · Job lock\n\n## Owns\n`lib/lock.js` (new) and `test/lock.test.js`.\n\n## Steps\n1. `lib/other.js` is not owned.\n');
  await write(main, 'docs/plans/packets/D-usage-warnings.md', '# Packet D · Usage warnings\n\n## Owns\n`shared.txt`, the banner in `web/src/` (new file).\n');
  g(main, 'add', '.');
  g(main, 'commit', '-q', '-m', 'start');
  g(dir, 'init', '-q', '--bare', 'origin.git');
  g(main, 'remote', 'add', 'origin', path.join(dir, 'origin.git'));
  g(main, 'push', '-q', 'origin', 'main');
  g(main, 'worktree', 'add', '-q', path.join(dir, 'wt-C'), '-b', 'packet/C-job-lock', 'main');
  g(main, 'worktree', 'add', '-q', path.join(dir, 'wt-D'), '-b', 'packet/D-usage-warnings', 'main');
  await write(path.join(dir, 'wt-C'), 'lib/lock.js', 'export const lock = 1;\n');
  g(path.join(dir, 'wt-C'), 'add', '.');
  g(path.join(dir, 'wt-C'), 'commit', '-q', '-m', 'C: the lock');
  await write(path.join(dir, 'wt-D'), 'shared.txt', 'one\nfrom D\n');
  await write(path.join(dir, 'wt-D'), 'notes/outside.md', 'not owned\n');
  g(path.join(dir, 'wt-D'), 'add', '.');
  g(path.join(dir, 'wt-D'), 'commit', '-q', '-m', 'D: the warning');
  if (conflict) {
    await write(main, 'shared.txt', 'one\nfrom main\n');
    g(main, 'commit', '-q', '-am', 'main moves on');
  }
  return { dir, main, wtC: path.join(dir, 'wt-C'), wtD: path.join(dir, 'wt-D'), origin: path.join(dir, 'origin.git') };
}

test('parseWorktrees reads git worktree list --porcelain', () => {
  const out = 'worktree /a\nHEAD 111\nbranch refs/heads/main\n\nworktree /b\nHEAD 222\nbranch refs/heads/packet/C-job-lock\n\nworktree /c\nHEAD 333\ndetached\n';
  assert.deepEqual(parseWorktrees(out), [
    { path: '/a', head: '111', branch: 'main' },
    { path: '/b', head: '222', branch: 'packet/C-job-lock' },
    { path: '/c', head: '333', branch: null },
  ]);
});

test('the Owns paragraph is read leniently, and owned paths match folders, globs, tests beside a file and the route and nav entries', () => {
  const text = '# Packet T · Telemetry\n\n## Owns\n`dashboard/lib/usage-log.js` (new: writes `~/.ground-control/usage.jsonl`), the `/api/telemetry/*` routes in `dashboard/server.js`, `telemetry.test.js`, `web/src/…/Usage*`, `web/src/views/Telemetry.tsx` plus its test, branch `packet/T-telemetry`, `set -o noclobber`, one route and the nav entry.\n\n## Steps\n`not/this.js`\n';
  const owned = parseOwns(text);
  assert.deepEqual(owned, ['dashboard/lib/usage-log.js', 'dashboard/server.js', 'telemetry.test.js', 'web/src/…/Usage*', 'web/src/views/Telemetry.tsx', 'web/src/app/router.ts', 'web/src/app/App.tsx']);
  assert.equal(briefTitle(text), 'Telemetry');
  const isOwned = ownedMatcher([...owned, 'web/src/views/']);
  for (const p of ['dashboard/server.js', 'dashboard/test/telemetry.test.js', 'web/src/components/UsageBanner.tsx', 'web/src/views/Telemetry.test.tsx', 'web/src/views/Other.tsx', 'web/src/app/App.tsx']) assert.ok(isOwned(p), p);
  for (const p of ['not/this.js', 'dashboard/lib/driver.js', 'web/src/app/app.css']) assert.ok(!isOwned(p), p);
  assert.equal(parseOwns('# Packet X\n\nNo list here.\n'), null);
  assert.equal(outsideOwned(['a.js'], null), null, 'an unreadable list is unknown, not "none"');
});

test('listPackets: the packet worktrees with branch, base, ahead and behind, last commit, merge state, tests and files outside Owns', async () => {
  const fx = await fixture('list');
  // Asked from a packet's worktree, it still finds the main checkout.
  const testsStates = new Map([['C', { state: 'green', at: '2026-10-28T10:00:00Z' }]]);
  const { root, base, packets } = await listPackets({ root: fx.wtD, testsStates });
  assert.equal(root, fx.main);
  assert.equal(base, 'main');
  assert.deepEqual(packets.map((p) => p.id), ['C', 'D']);
  const [c, d] = packets;
  assert.equal(c.name, 'Job lock');
  assert.equal(c.path, fx.wtC);
  assert.equal(c.branch, 'packet/C-job-lock');
  assert.equal(c.base, 'main');
  assert.equal(c.ahead, 1);
  assert.equal(c.behind, 0);
  assert.equal(c.state, 'waiting');
  assert.equal(c.lastCommit.subject, 'C: the lock');
  assert.match(c.lastCommit.sha, /^[0-9a-f]{40}$/);
  assert.ok(c.lastCommit.time);
  assert.equal(c.testsState, 'green');
  assert.equal(d.testsState, 'unknown');
  assert.deepEqual(c.touchedOutsideOwned, []);
  assert.deepEqual(d.touchedOutsideOwned, ['notes/outside.md']);
});

test('a packet with no commits yet is "empty", not merged, and its brief missing makes outside-owned unknown', async () => {
  const fx = await fixture('empty');
  g(fx.main, 'worktree', 'add', '-q', path.join(fx.dir, 'wt-E'), '-b', 'packet/E-decisions', 'main');
  const { packets } = await listPackets({ root: fx.main });
  const e = packets.find((p) => p.id === 'E');
  assert.equal(e.state, 'empty');
  assert.equal(e.ahead, 0);
  assert.equal(e.touchedOutsideOwned, null);
  assert.equal(e.name, 'decisions');
});

test('order and packets at once: saved in integrate.json, checked, the plan order by default; the slots in use count unmerged worktrees', async () => {
  const fx = await fixture('order');
  const configDir = path.join(fx.dir, 'gc');
  const board = new Integrator({ root: fx.main, configDir, commands: PASS });
  let cfg = await board.config();
  assert.deepEqual(cfg.order, DEFAULT_ORDER);
  assert.equal(cfg.slots, 3);
  await board.saveOrder(['D', 'C', 'D']);
  await board.saveSlots(5);
  cfg = JSON.parse(await fs.readFile(path.join(configDir, 'integrate.json'), 'utf8'));
  assert.deepEqual(cfg.order, ['D', 'C']);
  assert.equal(cfg.slots, 5);
  await assert.rejects(board.saveOrder(['C', '../x']), /not a packet id/);
  await assert.rejects(board.saveSlots(0), /whole number from 1 to 20/);
  assert.throws(() => cleanOrder('C'), /must be a list/);
  let view = await board.view();
  assert.deepEqual(view.order.map((o) => [o.id, o.state, o.name]), [['D', 'waiting', 'Usage warnings'], ['C', 'waiting', 'Job lock']]);
  assert.equal(view.next.id, 'D');
  assert.equal(view.slots, 5);
  assert.equal(view.inUse, 2);
  // C merged by hand: one slot frees up.
  g(fx.main, 'merge', '-q', '--no-ff', 'packet/C-job-lock', '-m', 'by hand');
  view = await board.view();
  assert.equal(view.inUse, 1);
  assert.equal(view.order.find((o) => o.id === 'C').state, 'merged');
});

test('merge next: merges the first packet in order that is not merged, with the plain message, runs the tests, never pushes', async () => {
  const fx = await fixture('merge');
  const remoteBefore = g(fx.origin, 'rev-parse', 'main').trim();
  const out = [];
  const stages = [];
  const r = await mergeNext({ root: fx.main, order: ['C', 'D'], commands: PASS, onOutput: (t) => out.push(t), onStage: (s) => stages.push(s.stage) });
  assert.equal(r.outcome, 'merged', r.message);
  assert.equal(r.id, 'C');
  assert.equal(r.tests.ok, true);
  assert.deepEqual(stages, ['merging', 'testing']);
  assert.match(out.join(''), /all good/);
  assert.equal(g(fx.main, 'log', '-1', '--format=%s').trim(), 'Merge packet C: Job lock');
  assert.equal(g(fx.main, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ').length, 3, 'a merge commit (--no-ff)');
  assert.equal(r.sha, g(fx.main, 'rev-parse', 'HEAD').trim());
  // The next one in order is D; failing tests are reported and the merge stays.
  const r2 = await mergeNext({ root: fx.main, order: ['C', 'D'], commands: FAIL });
  assert.equal(r2.outcome, 'merged');
  assert.equal(r2.id, 'D');
  assert.equal(r2.tests.ok, false);
  assert.match(r2.message, /pretend tests failed/);
  assert.equal(g(fx.main, 'log', '-1', '--format=%s').trim(), 'Merge packet D: Usage warnings');
  const r3 = await mergeNext({ root: fx.main, order: ['C', 'D'], commands: PASS });
  assert.equal(r3.outcome, 'nothing');
  // Never pushed.
  assert.equal(g(fx.origin, 'rev-parse', 'main').trim(), remoteBefore);
});

test('merge next stops at a packet with no branch or no commits rather than skip it', async () => {
  const fx = await fixture('blocked');
  let r = await mergeNext({ root: fx.main, order: ['Z', 'C'], commands: PASS });
  assert.equal(r.outcome, 'blocked');
  assert.match(r.message, /Packet Z is next in the order, but there is no packet\/Z-… branch yet/);
  g(fx.main, 'worktree', 'add', '-q', path.join(fx.dir, 'wt-E'), '-b', 'packet/E-decisions', 'main');
  r = await mergeNext({ root: fx.main, order: ['E', 'C'], commands: PASS });
  assert.equal(r.outcome, 'blocked');
  assert.match(r.message, /nothing is committed on packet\/E-decisions yet/);
  assert.equal(g(fx.main, 'log', '-1', '--format=%s').trim(), 'start');
});

test('merge next on a conflict: lists the files, undoes nothing, runs no tests; the next try is refused until it is settled', async () => {
  const fx = await fixture('conflict', { conflict: true });
  let ran = false;
  const r = await mergeNext({ root: fx.main, order: ['D'], commands: [{ label: 'x', cmd: process.execPath, args: ['-e', ''], cwd: '.' }], onStage: (s) => { if (s.stage === 'testing') ran = true; } });
  assert.equal(r.outcome, 'conflict');
  assert.deepEqual(r.files, ['shared.txt']);
  assert.match(r.message, /conflict in one file\. Nothing was undone/);
  assert.equal(ran, false);
  assert.equal(execFileSync('git', ['-C', fx.main, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'], { encoding: 'utf8' }).trim().length, 40, 'the merge is still under way');
  const again = await mergeNext({ root: fx.main, order: ['D'], commands: PASS });
  assert.equal(again.outcome, 'refused');
  assert.match(again.message, /A merge is already under way/);
  assert.deepEqual(again.files, ['shared.txt']);
});

test('merge next refuses while a job runs on the main checkout, or while it has uncommitted changes', async () => {
  const fx = await fixture('busy');
  const stateDir = path.join(fx.dir, 'state');
  const jobDir = path.join(fx.dir, 'feature-work', 'some-job');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, 'sessions.json'), JSON.stringify({ [jobDir]: { cwd: fx.main, status: 'running' }, '/elsewhere/job': { cwd: '/elsewhere', status: 'running' } }));
  let r = await mergeNext({ root: fx.main, order: ['C'], commands: PASS, stateDirs: [path.join(fx.dir, 'missing'), stateDir] });
  assert.equal(r.outcome, 'refused');
  assert.match(r.message, /A job is running on the main checkout \(some-job\)/);
  assert.equal(g(fx.main, 'log', '-1', '--format=%s').trim(), 'start', 'nothing merged');

  // Not marked running, but its job lock (packet C) is held by a live process.
  await fs.writeFile(path.join(stateDir, 'sessions.json'), JSON.stringify({ [jobDir]: { cwd: fx.main, repoPath: fx.main } }));
  await fs.writeFile(path.join(jobDir, 'lock.json'), JSON.stringify({ pid: process.pid }));
  assert.equal((await runningJobFor(fx.main, { stateDirs: [stateDir] }))?.slug, 'some-job');
  await fs.rm(path.join(jobDir, 'lock.json'));
  assert.equal(await runningJobFor(fx.main, { stateDirs: [stateDir] }), null);
  // This dashboard's own run counts too.
  r = await mergeNext({ root: fx.main, order: ['C'], commands: PASS, stateDirs: [stateDir], extraRunning: async () => ({ slug: 'driven-here' }) });
  assert.match(r.message, /driven-here/);

  await write(fx.main, 'shared.txt', 'changed, not committed\n');
  r = await mergeNext({ root: fx.main, order: ['C'], commands: PASS, stateDirs: [stateDir] });
  assert.equal(r.outcome, 'refused');
  assert.match(r.message, /changes that aren’t committed/);
});

test('the board: one step at a time, a packet’s tests run in its worktree and set its state, the last result is kept', async () => {
  const fx = await fixture('board');
  const board = new Integrator({ root: fx.main, configDir: path.join(fx.dir, 'gc'), commands: [{ label: 'where', cmd: process.execPath, args: ['-e', 'console.log(process.cwd()); setTimeout(() => {}, 400)'], cwd: '.' }] });
  const lines = [];
  board.on('line', (e) => lines.push(e.text));
  const { done } = await board.runPacketTests('C');
  await assert.rejects(board.runPacketTests('D'), /tests for packet C are running now/);
  assert.throws(() => board.mergeNext(), /running now/);
  const result = await done;
  assert.equal(result.outcome, 'tests');
  assert.ok(lines.join('').includes(fx.wtC), 'ran in the packet’s worktree');
  let view = await board.view();
  assert.equal(view.packets.find((p) => p.id === 'C').testsState, 'green');
  assert.equal(view.packets.find((p) => p.id === 'D').testsState, 'unknown');
  await assert.rejects(board.runPacketTests('Q'), /No worktree for packet Q/);

  await board.saveOrder(['C']);
  const merged = await board.mergeNext().done;
  assert.equal(merged.outcome, 'merged');
  view = await board.view();
  assert.equal(view.last.outcome, 'merged');
  assert.equal(view.running, null);
  const saved = JSON.parse(await fs.readFile(path.join(fx.dir, 'gc', 'integrate.json'), 'utf8'));
  assert.equal(saved.last.id, 'C');
});

// ---------- The routes ----------

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

test('the /api/integrate routes: the list, saving the order and slots (with the page token), the stream, merge next', async () => {
  const fx = await fixture('server');
  const home = path.join(fx.dir, 'home');
  const dirs = ['feature-work', 'projects', 'agents', 'skills', 'state'].map((d) => path.join(fx.dir, d));
  for (const d of [home, ...dirs]) await fs.mkdir(d, { recursive: true });
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const output = [];
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env, PORT: String(port), WIREFRAMES_PORT: String(await freePort()), HOME: home, WORKSHOP_DEMO: '1', WORKSHOP_PLAN_USAGE: 'off',
      WORKSHOP_FEATURES_DIR: dirs[0], WORKSHOP_PROJECTS_DIR: dirs[1], WORKSHOP_AGENTS_DIR: dirs[2], WORKSHOP_SKILLS_DIR: dirs[3], WORKSHOP_STATE_DIR: dirs[4],
      INTEGRATE_ROOT: fx.main,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`The dashboard didn't start:\n${output.join('')}`)), 15000);
      child.stdout.on('data', (d) => { output.push(String(d)); if (output.join('').includes('Feature Workshop running')) { clearTimeout(timer); resolve(); } });
      child.stderr.on('data', (d) => output.push(String(d)));
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`The dashboard exited (${code}):\n${output.join('')}`)); });
    });
    const token = (await (await fetch(`${base}/api/meta`)).json()).token;
    const post = async (p, body, auth = true) => {
      const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Workshop-Token': token } : {}) }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    let view = await (await fetch(`${base}/api/integrate`)).json();
    assert.equal(view.root, fx.main);
    assert.deepEqual(view.packets.map((p) => p.id), ['C', 'D']);
    assert.deepEqual(view.order.map((o) => o.id), DEFAULT_ORDER);
    assert.equal(view.slots, 3);
    assert.equal(view.inUse, 2);

    assert.equal((await post('/api/integrate/order', { order: ['C'] }, false)).status, 403);
    assert.equal((await post('/api/integrate/order', { order: ['C', 'no good'] })).status, 400);
    assert.deepEqual((await post('/api/integrate/order', { order: ['C', 'D'] })).body.order, ['C', 'D']);
    assert.equal((await post('/api/integrate/slots', { slots: 2 })).body.slots, 2);
    const saved = JSON.parse(await fs.readFile(path.join(home, '.ground-control', 'integrate.json'), 'utf8'));
    assert.deepEqual([saved.order, saved.slots], [['C', 'D'], 2]);
    assert.equal((await post('/api/integrate/run-tests', { id: 'Q' })).status, 404);

    // The stream says hello, then a merge's steps. The server's test commands are the real
    // npm ones, which fail in this bare fixture (no package.json): the merge still happens and
    // the failure is reported, no push, no model.
    const ac = new AbortController();
    const stream = await fetch(`${base}/api/integrate/stream`, { signal: ac.signal });
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    const reader = stream.body.getReader();
    let seen = '';
    const done = (async () => {
      while (!seen.includes('"type":"done"')) {
        const { value, done: end } = await reader.read();
        if (end) break;
        seen += Buffer.from(value).toString('utf8');
      }
    })();
    const started = await post('/api/integrate/merge-next', {});
    assert.equal(started.status, 202);
    await done;
    ac.abort();
    assert.match(seen, /"type":"hello"/);
    assert.match(seen, /Merge packet C: Job lock/);
    view = await (await fetch(`${base}/api/integrate`)).json();
    assert.equal(view.last.outcome, 'merged');
    assert.equal(view.last.id, 'C');
    assert.equal(g(fx.main, 'log', '-1', '--format=%s').trim(), 'Merge packet C: Job lock');
  } finally {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM'); // exactly the dashboard this test started
    await gone;
  }
});
