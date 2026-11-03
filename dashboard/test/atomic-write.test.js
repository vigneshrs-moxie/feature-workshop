// Saving a file whole (lib/atomic-write.js): a moment's "in use" from Windows is waited out, real
// errors are passed on, and no temporary file is left behind either way.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { replaceFile, tmpNameFor, writeFileAtomic } from '../lib/atomic-write.js';

const roots = [];
after(async () => { for (const r of roots) await fs.rm(r, { recursive: true, force: true }); });
async function folder() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starbase-atomic-'));
  roots.push(root);
  return root;
}
const busy = (code) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
/** A rename refused `times` times with code, then done for real. */
function refusing(times, code) {
  const calls = [];
  return { calls, rename: async (from, to) => { calls.push([from, to]); if (calls.length <= times) throw busy(code); await fs.rename(from, to); } };
}
const noWait = async () => {};

test('a save writes the whole file, and two at once never share a temporary file', async () => {
  const dir = await folder();
  const file = path.join(dir, 'round-1.json');
  assert.notEqual(tmpNameFor(file), tmpNameFor(file));
  await Promise.all(Array.from({ length: 20 }, (_, i) => writeFileAtomic(file, `{"n":${i}}\n`)));
  assert.match(await fs.readFile(file, 'utf8'), /^\{"n":\d+\}\n$/);
  assert.deepEqual(await fs.readdir(dir), ['round-1.json']);
});

test('on Windows a file in use for a moment is tried again, and the save lands', async () => {
  for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
    const dir = await folder();
    const file = path.join(dir, 'stack.json');
    const r = refusing(3, code);
    await writeFileAtomic(file, 'saved', { platform: 'win32', rename: r.rename, wait: noWait });
    assert.equal(await fs.readFile(file, 'utf8'), 'saved', code);
    assert.equal(r.calls.length, 4, code);
    assert.deepEqual(await fs.readdir(dir), ['stack.json'], code);
  }
});

test('on Windows it gives up after about three seconds, passes the error on and leaves no temporary file', async () => {
  const dir = await folder();
  const file = path.join(dir, 'stack.json');
  const tmp = tmpNameFor(file);
  await fs.writeFile(tmp, 'saved');
  let clock = 0;
  const waits = [];
  const r = refusing(Infinity, 'EPERM');
  await assert.rejects(
    replaceFile(tmp, file, { platform: 'win32', rename: r.rename, now: () => clock, wait: async (ms) => { waits.push(ms); clock += ms; } }),
    (err) => err.code === 'EPERM',
  );
  assert.ok(clock >= 3000 && clock < 3300, `waited ${clock} ms`);
  assert.deepEqual(waits.slice(0, 5), [10, 20, 40, 80, 160]);
  assert.ok(waits.every((ms) => ms <= 200));
  assert.deepEqual(await fs.readdir(dir), []);
});

test('anywhere but Windows, and for any other error, the first error is passed on at once', async () => {
  for (const [platform, code] of [['darwin', 'EPERM'], ['linux', 'EACCES'], ['win32', 'ENOENT'], ['win32', 'EXDEV']]) {
    const dir = await folder();
    const file = path.join(dir, 'rules.json');
    const r = refusing(Infinity, code);
    await assert.rejects(writeFileAtomic(file, 'saved', { platform, rename: r.rename, wait: noWait }), (err) => err.code === code);
    assert.equal(r.calls.length, 1, `${platform} ${code}`);
    assert.deepEqual(await fs.readdir(dir), [], `${platform} ${code}`);
  }
});

test('the mode is the new file’s', { skip: process.platform === 'win32' && 'Windows has no POSIX modes' }, async () => {
  const dir = await folder();
  const file = path.join(dir, 'token');
  await writeFileAtomic(file, 'x', { mode: 0o600 });
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});
