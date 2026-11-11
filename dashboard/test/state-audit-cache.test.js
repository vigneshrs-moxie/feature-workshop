// The audit file is parsed once while it does not change (lib/state.js auditAll): one parse serves every
// job and every caller, and a write through state.audit is seen by the next read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { State } from '../lib/state.js';

test('two reads with no write between them parse the file once; a write is seen by the next read', async () => {
  const state = new State(await fs.mkdtemp(path.join(os.tmpdir(), 'sb-audit-cache-')));
  await state.audit({ action: 'a', featureDir: '/f/one' });
  await state.audit({ action: 'b', featureDir: '/f/two' });
  const before = state.auditParses ?? 0;
  assert.deepEqual((await state.auditFor('/f/one')).map((e) => e.action), ['a']);
  assert.deepEqual((await state.auditFor('/f/two')).map((e) => e.action), ['b']);
  assert.equal((state.auditParses ?? 0) - before, 1, 'one parse served both jobs');
  await state.audit({ action: 'c', featureDir: '/f/one' });
  assert.deepEqual((await state.auditFor('/f/one')).map((e) => e.action), ['a', 'c']);
  assert.equal((state.auditParses ?? 0) - before, 2);
  // A line another process appended is seen too (the file's size changed).
  await fs.appendFile(state.auditFile, `${JSON.stringify({ at: new Date().toISOString(), action: 'd', featureDir: '/f/one' })}\n`);
  assert.deepEqual((await state.auditFor('/f/one')).map((e) => e.action), ['a', 'c', 'd']);
  // What a caller does with the list does not reach the next read.
  (await state.auditFor('/f/one')).pop();
  assert.equal((await state.auditFor('/f/one')).length, 3);
});
