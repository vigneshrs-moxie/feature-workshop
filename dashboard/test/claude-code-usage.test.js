// Your Claude Code use outside this app (lib/claude-code-usage.js), on fixture folders made here:
// never the real ~/.claude. Each test builds a small projects folder the way Claude Code lays it out
// (<folder>/<session>.jsonl, <folder>/<session>/subagents/agent-<id>.jsonl) and points the reader at it.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { estimateCost } from '../lib/cost.js';
import { CACHE_FILE, ClaudeCodeUsage, hashOf, projectFolderName, readSetting, replyOf, writeSetting } from '../lib/claude-code-usage.js';

const NOW = Date.parse('2026-10-29T12:00:00Z');
const TEMP = ['/tmp', '/private/tmp'];
// Words that must never leave the reader: the reply's text, the prompt, a tool's input, a file name and the folders.
const SECRETS = ['SECRET-REPLY-TEXT', 'SECRET-PROMPT', 'secret-tool-input.txt', 'shop-repo', 'Users-pat'];
const CWD = '/Users/pat/code/shop-repo';
const FOLDER = projectFolderName(CWD);

/** One assistant line, as Claude Code writes it (the usage, and things the reader must drop). cwd null: a line without one. */
function reply({ id, t, model = 'claude-opus-5-5', session = 's-main', cwd = CWD, input = 100, output = 50, cacheRead = 1000, sidechain = false }) {
  return JSON.stringify({
    parentUuid: null, isSidechain: sidechain, userType: 'external', ...(cwd === null ? {} : { cwd }), sessionId: session, version: '2.1.0', gitBranch: 'main',
    message: {
      model, id, type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'SECRET-REPLY-TEXT' }, { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: `${cwd}/secret-tool-input.txt` } }],
      usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0 },
    },
    requestId: `req-${id}`, type: 'assistant', uuid: `u-${id}-${output}`, timestamp: new Date(t).toISOString(),
  });
}
const user = ({ t, session = 's-main', cwd = CWD }) => JSON.stringify({ type: 'user', cwd, sessionId: session, message: { role: 'user', content: 'SECRET-PROMPT' }, timestamp: new Date(t).toISOString() });

async function projects(files) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-ccu-')));
  const dir = path.join(root, 'projects');
  const state = path.join(root, 'state');
  for (const [rel, lines] of Object.entries(files)) {
    const p = path.join(dir, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, lines.map((l) => `${l}\n`).join(''));
  }
  return { root, dir, state, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}
const reader = (p, opts = {}) => new ClaudeCodeUsage({ projectsDir: p.dir, stateDir: p.state, user: 'vignesh', tempRoots: TEMP, now: () => NOW, minRefreshMs: 0, ...opts });
const H = 3600e3;

test('a reply is its usage numbers only: time, family, tokens, sub-agent or not', () => {
  const r = replyOf(JSON.parse(reply({ id: 'm1', t: NOW - H })));
  assert.deepEqual(r, { id: 'm1', t: NOW - H, family: 'opus', tokens: { input: 100, output: 50, cacheRead: 1000, cacheWrite5m: 0, cacheWrite1h: 0 }, sidechain: false });
  assert.equal(replyOf({ type: 'user', message: { usage: {} } }), null);
  assert.equal(replyOf({ type: 'assistant', timestamp: new Date(NOW).toISOString(), message: { id: 'x', model: '<synthetic>', usage: {} } }), null, 'Claude Code’s own synthetic replies cost nothing');
  assert.equal(replyOf({ type: 'assistant', timestamp: 'not a time', message: { id: 'x', model: 'claude-opus-5-5', usage: {} } }), null);
});

test('reading: each reply once (the last line of a streamed message wins), sub-agents counted, a malformed line skipped, cost from cost.js', async () => {
  const p = await projects({
    [`${FOLDER}/s-main.jsonl`]: [
      user({ t: NOW - 3 * H }),
      reply({ id: 'm1', t: NOW - 3 * H, output: 5 }),
      reply({ id: 'm1', t: NOW - 3 * H, output: 50 }), // the same message, streamed further: this one counts
      '{"type":"assistant","message":{"usage": broken',
      reply({ id: 'm2', t: NOW - 2 * H, model: 'claude-sonnet-5-5', output: 10 }),
    ],
    [`${FOLDER}/s-main/subagents/agent-a1.jsonl`]: [reply({ id: 'sub1', t: NOW - 2.5 * H, model: 'claude-haiku-5-5', sidechain: true })],
  });
  try {
    const r = reader(p);
    assert.equal(r.view().state, 'reading', 'nothing is said before the first read is done');
    assert.equal(r.view().replies, null);
    await r.refresh();
    const v = r.view();
    assert.equal(v.state, 'ready');
    assert.deepEqual(v.replies.map((x) => [x.t, x.family, x.tokens.output, x.sidechain, x.user]), [
      [new Date(NOW - 3 * H).toISOString(), 'opus', 50, false, 'vignesh'],
      [new Date(NOW - 2.5 * H).toISOString(), 'haiku', 50, true, 'vignesh'],
      [new Date(NOW - 2 * H).toISOString(), 'sonnet', 10, false, 'vignesh'],
    ]);
    assert.equal(v.replies[0].usd, Math.round(estimateCost('claude-opus-5-5', v.replies[0].tokens) * 1e6) / 1e6);
    assert.equal(r.stats.bad, 1, 'the malformed line is skipped and counted');
    // Only usage numbers: no text, prompt, tool input, file name or folder anywhere in what comes out.
    const out = JSON.stringify(v);
    for (const s of SECRETS) assert.ok(!out.includes(s), `${s} must not leave the reader`);
    assert.deepEqual(Object.keys(v.replies[0]).sort(), ['family', 'sidechain', 't', 'tokens', 'usd', 'user']);
    // Nor in the cache on disk: folders are kept as hashes only.
    const cache = await fs.readFile(path.join(p.state, CACHE_FILE), 'utf8');
    for (const s of SECRETS) assert.ok(!cache.includes(s), `${s} must not be in the cache`);
    assert.ok(!cache.includes(p.dir), 'not even the projects folder');
    assert.equal((await fs.stat(path.join(p.state, CACHE_FILE))).mode & 0o777, 0o600);
  } finally { await p.cleanup(); }
});

test('this app’s own job sessions are left out: by session id, by the job’s worktree, by its folder', async () => {
  const worktree = '/Users/pat/worktrees/orbit-479';
  const p = await projects({
    [`${FOLDER}/s-terminal.jsonl`]: [reply({ id: 't1', t: NOW - H, session: 's-terminal' })],
    [`${FOLDER}/s-job.jsonl`]: [reply({ id: 'j1', t: NOW - H, session: 's-job' })],
    [`${FOLDER}/s-job/subagents/agent-x.jsonl`]: [reply({ id: 'j2', t: NOW - H, session: 's-job', sidechain: true })],
    [`${projectFolderName(worktree)}/s-wt.jsonl`]: [reply({ id: 'w1', t: NOW - H, session: 's-wt', cwd: worktree })],
    [`${projectFolderName(`${worktree}/web`)}/s-wt-sub.jsonl`]: [reply({ id: 'w2', t: NOW - H, session: 's-wt-sub', cwd: `${worktree}/web` })],
    // No line says its folder: the folder Claude Code keeps it in does.
    [`${projectFolderName(worktree)}/s-nocwd.jsonl`]: [reply({ id: 'w3', t: NOW - H, session: 's-nocwd', cwd: null })],
  });
  try {
    const r = reader(p);
    await r.refresh();
    assert.equal(r.view().replies.length, 6, 'all six without exclusions');
    const v = r.view({ exclude: { sessions: new Set(['s-job']), dirs: [worktree] } });
    assert.deepEqual(v.replies.map((x) => x.tokens.output), [50]);
    assert.equal(v.replies.length, 1, 'only the terminal session is left');
  } finally { await p.cleanup(); }
});

test('a reply copied into another session (a resume or a fork) counts once, and is left out when a job’s copy may be the one', async () => {
  const p = await projects({
    [`${FOLDER}/s-a.jsonl`]: [reply({ id: 'shared', t: NOW - 2 * H, session: 's-a' })],
    [`${FOLDER}/s-b.jsonl`]: [reply({ id: 'shared', t: NOW - 2 * H, session: 's-b' }), reply({ id: 'b-own', t: NOW - H, session: 's-b' })],
  });
  try {
    const r = reader(p);
    await r.refresh();
    assert.equal(r.view().replies.length, 2, 'the shared message once, plus b’s own');
    // Copies born at the same moment can't be told apart: a copy in a left-out session leaves it out.
    for (const e of r.files.values()) e.born = 1;
    r.memo = null;
    assert.deepEqual(r.view({ exclude: { sessions: ['s-b'] } }).replies.length, 0);
    // The file made first is where the reply happened: s-a (a terminal session) first, s-b forked from it as a job.
    [...r.files.entries()].forEach(([f, e]) => { e.born = f.endsWith('s-a.jsonl') ? 1 : 2; });
    r.memo = null;
    assert.equal(r.view({ exclude: { sessions: ['s-b'] } }).replies.length, 1, 'the terminal session’s reply stays');
    r.memo = null;
    assert.equal(r.view({ exclude: { sessions: ['s-a'] } }).replies.length, 1, 'only b’s own reply: the shared one happened in s-a');
  } finally { await p.cleanup(); }
});

test('temp folders (the demo’s and tests’ runs) are left out, by working folder or by Claude Code’s folder name', async () => {
  const p = await projects({
    [`${FOLDER}/s-real.jsonl`]: [reply({ id: 'r1', t: NOW - H, session: 's-real' })],
    [`${projectFolderName('/private/tmp/fw-demo-1')}/s-demo.jsonl`]: [reply({ id: 'd1', t: NOW - H, session: 's-demo', cwd: '/private/tmp/fw-demo-1' })],
    [`${projectFolderName('/tmp/fw-test-2')}/s-test.jsonl`]: [reply({ id: 'd2', t: NOW - H, session: 's-test', cwd: null })],
  });
  try {
    const r = reader(p);
    await r.refresh();
    assert.equal(r.view().replies.length, 1);
  } finally { await p.cleanup(); }
});

test('a file that grows between reads: only the new part is read; a half-written line waits; the cache carries over', async () => {
  const p = await projects({ [`${FOLDER}/s-main.jsonl`]: [reply({ id: 'm1', t: NOW - 3 * H })] });
  const file = path.join(p.dir, FOLDER, 's-main.jsonl');
  try {
    const r = reader(p);
    await r.refresh();
    const first = r.stats.bytesRead;
    assert.equal(first, (await fs.stat(file)).size);
    // Claude Code appends a reply, and is halfway through writing the next line.
    const more = `${reply({ id: 'm2', t: NOW - 2 * H })}\n`;
    const half = reply({ id: 'm3', t: NOW - H }).slice(0, 80);
    await fs.appendFile(file, more + half);
    await r.refresh();
    assert.equal(r.stats.bytesRead - first, Buffer.byteLength(more + half), 'only the new bytes were read');
    assert.deepEqual(r.view().replies.map((x) => x.t), [NOW - 3 * H, NOW - 2 * H].map((t) => new Date(t).toISOString()), 'the half line isn’t counted yet');
    // The line is finished: it counts, read from where the last whole line ended.
    await fs.appendFile(file, `${reply({ id: 'm3', t: NOW - H }).slice(80)}\n`);
    await r.refresh();
    assert.equal(r.view().replies.length, 3);
    // A new reader (the dashboard restarted) starts from the cache: nothing unchanged is read again.
    const again = reader(p);
    await again.refresh();
    assert.equal(again.stats.bytesRead, 0);
    assert.equal(again.view().replies.length, 3);
    // A file replaced by a shorter one is read again from the start.
    await fs.writeFile(file, `${reply({ id: 'n1', t: NOW - H })}\n`);
    await again.refresh();
    assert.deepEqual(again.view().replies.map((x) => x.tokens.output), [50]);
    assert.equal(again.view().replies.length, 1);
  } finally { await p.cleanup(); }
});

test('only files changed in the last 100 days, and only replies from then on; a deleted file goes', async () => {
  const p = await projects({
    [`${FOLDER}/s-old.jsonl`]: [reply({ id: 'o1', t: NOW - 120 * 24 * H, session: 's-old' })],
    [`${FOLDER}/s-mixed.jsonl`]: [reply({ id: 'o2', t: NOW - 101 * 24 * H, session: 's-mixed' }), reply({ id: 'n2', t: NOW - H, session: 's-mixed' })],
  });
  const old = path.join(p.dir, FOLDER, 's-old.jsonl');
  try {
    const t = new Date(NOW - 120 * 24 * H);
    await fs.utimes(old, t, t);
    const r = reader(p);
    await r.refresh();
    assert.deepEqual(r.view().replies.map((x) => x.t), [new Date(NOW - H).toISOString()]);
    assert.equal(r.stats.files, 1, 'the old file isn’t opened');
    await fs.rm(path.join(p.dir, FOLDER, 's-mixed.jsonl'));
    await r.refresh();
    assert.deepEqual(r.view().replies, []);
  } finally { await p.cleanup(); }
});

test('the first read runs in the background: poke() never waits, and a view says reading until it is done', async () => {
  const lines = [];
  for (let i = 0; i < 2000; i++) lines.push(reply({ id: `m${i}`, t: NOW - H + i }));
  const p = await projects({ [`${FOLDER}/s-big.jsonl`]: lines });
  try {
    const r = reader(p);
    r.poke();
    assert.equal(r.view().state, 'reading');
    assert.ok(r.running, 'a read is under way');
    await r.running;
    assert.equal(r.view().state, 'ready');
    assert.equal(r.view().replies.length, 2000);
    assert.equal(r.view({ since: NOW - H + 1000 }).replies.length, 1000, 'since and until pick the window');
  } finally { await p.cleanup(); }
});

test('no projects folder: ready, with nothing', async () => {
  const r = new ClaudeCodeUsage({ projectsDir: path.join(os.tmpdir(), 'fw-ccu-none-here'), stateDir: null, tempRoots: TEMP, now: () => NOW });
  await r.refresh();
  assert.deepEqual(r.view(), { state: 'ready', readAt: new Date(NOW).toISOString(), error: null, replies: [] });
});

test('the setting: on unless turned off, kept in the state folder', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-ccu-set-'));
  try {
    assert.deepEqual(await readSetting(dir), { count: true });
    await writeSetting(dir, { count: false });
    assert.deepEqual(await readSetting(dir), { count: false });
    await writeSetting(dir, { count: true });
    assert.deepEqual(await readSetting(dir), { count: true });
    await assert.rejects(writeSetting(dir, { count: 'yes' }), /true or false/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('hashes and folder names', () => {
  assert.equal(projectFolderName('/Users/pat/code/shop.repo'), '-Users-pat-code-shop-repo');
  assert.equal(hashOf('a'), hashOf('a'));
  assert.equal(hashOf('a').length, 16);
});
