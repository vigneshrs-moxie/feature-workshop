import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { suggestLevel, changedPaths, RISK_TRIGGERS } from '../lib/levels.js';

test('levels: size words decide when nothing risky is mentioned', () => {
  assert.equal(suggestLevel({ description: 'Fix the typo in the footer' }).level, 0);
  assert.equal(suggestLevel({ description: 'Change the colour of the Save button' }).level, 0);
  assert.equal(suggestLevel({ description: 'Rename the Tickets tab to Requests' }).level, 0);
  assert.equal(suggestLevel({ description: 'Add a Copy ID button next to the ticket ID on the admin ticket page' }).level, 1);
  assert.equal(suggestLevel({ description: 'Refactor the ticket list into a reusable table' }).level, 2);
  assert.equal(suggestLevel({ description: 'Add a filter to the ticket list and also show the totals at the bottom of the page' }).level, 2);
  const r = suggestLevel({ description: 'Fix the typo in the footer' });
  assert.equal(r.floor, 0, 'no risk trigger, no floor');
  assert.deepEqual(r.triggers, []);
  assert.ok(r.reasons.length && r.reasons.every((s) => typeof s === 'string'));
});

test('levels: risk triggers in the description set a floor', () => {
  const cases = [
    ['Fix the typo in the migration that adds visits', 3, 'migrations'],
    ['Rename the sign-in button', 3, 'auth'],
    ['Let managers change roles', 3, 'auth'],
    ['Use getScope on the reports page', 3, 'scope'],
    ['Respect scopeWhere in the export', 3, 'scope'],
    ['Fix office visibility for entity_branches', 2, 'office-visibility'],
    ['Tweak the people search', 2, 'people'],
    ['Send an email when a ticket closes', 2, 'email'],
    ['Add a feature flag for the new board', 2, 'shared-config'],
  ];
  for (const [description, floor, id] of cases) {
    const r = suggestLevel({ description });
    assert.ok(r.triggers.includes(id), `${description}: ${id}`);
    assert.ok(r.floor >= floor, `${description}: floor L${floor}`);
    assert.ok(r.level >= floor, `${description}: never under the floor`);
    assert.ok(r.reasons.some((s) => s.includes(`at least L${floor}`)), `${description}: says why`);
  }
  assert.equal(suggestLevel({ description: 'Fix the typo in the email footer' }).level, 2, 'a tweak to email is still L2');
});

test('levels: changed paths raise the floor too', () => {
  const r = suggestLevel({ description: 'Fix the typo', paths: ['db/migrations/0042_add_visits.sql', 'src/app.ts'] });
  assert.equal(r.level, 3);
  assert.ok(r.reasons.some((s) => s.includes('db/migrations/0042_add_visits.sql')));
  assert.equal(suggestLevel({ description: 'Fix the typo', paths: ['src/lib/scope.ts'] }).floor, 3);
  assert.equal(suggestLevel({ description: 'Fix the typo', paths: ['src/auth/session.ts'] }).floor, 3);
  assert.equal(suggestLevel({ description: 'Fix the typo', paths: ['src/lib/mailer.ts'] }).floor, 2);
  assert.equal(suggestLevel({ description: 'Fix the typo', paths: ['package.json'] }).floor, 2);
  assert.equal(suggestLevel({ description: 'Fix the typo', paths: ['src/authors/list.ts'] }).floor, 0, 'authors is not auth');
  assert.equal(suggestLevel({ description: 'Fix the typo', paths: ['src/ui/footer.tsx'] }).level, 0);
  assert.equal(suggestLevel({ description: 'Fix the typo', paths: 'not a list' }).level, 0);
});

test('levels: one trigger list, each with a floor of L2 or L3', () => {
  assert.deepEqual(RISK_TRIGGERS.map((t) => t.id), ['migrations', 'auth', 'scope', 'office-visibility', 'people', 'email', 'shared-config']);
  for (const t of RISK_TRIGGERS) {
    assert.ok([2, 3].includes(t.floor));
    assert.ok(t.text instanceof RegExp && t.path instanceof RegExp && t.label);
  }
  assert.deepEqual(RISK_TRIGGERS.filter((t) => t.floor === 3).map((t) => t.id), ['migrations', 'auth', 'scope']);
});

test('levels: the git helper lists changed paths and tolerates anything else', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-levels-')));
  try {
    assert.deepEqual(await changedPaths(root, 'main'), [], 'not a repository');
    assert.deepEqual(await changedPaths(path.join(root, 'missing'), 'main'), [], 'no such folder');
    assert.deepEqual(await changedPaths('relative/path', 'main'), []);
    assert.deepEqual(await changedPaths(root, '--output=/tmp/x'), [], 'a base that looks like an option is refused');

    const repo = path.join(root, 'repo');
    await fs.mkdir(repo);
    const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    await fs.writeFile(path.join(repo, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    git('checkout', '-q', '-b', 'feature/x');
    await fs.mkdir(path.join(repo, 'db', 'migrations'), { recursive: true });
    await fs.writeFile(path.join(repo, 'db', 'migrations', '001.sql'), 'select 1;\n');
    await fs.writeFile(path.join(repo, 'a.txt'), 'b\n');
    git('add', '.');
    git('commit', '-q', '-m', 'second');
    assert.deepEqual((await changedPaths(repo, 'main')).sort(), ['a.txt', 'db/migrations/001.sql']);
    assert.deepEqual(await changedPaths(repo, 'no-such-branch'), [], 'an unknown base');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
