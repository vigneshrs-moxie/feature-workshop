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

test('levels: "add a column" is a migration only when the database is mentioned; otherwise at most a floor of L2', () => {
  const page = suggestLevel({ description: 'Add a column for the visit date to the jobs list' });
  assert.ok(!page.triggers.includes('migrations'), 'a column in a list on a page');
  assert.equal(page.floor, 2);
  assert.equal(page.level, 2);
  assert.ok(page.reasons.some((s) => /may change stored data, so at least L2/.test(s)));
  const table = suggestLevel({ description: 'Add a new table for visit notes' });
  assert.ok(!table.triggers.includes('migrations'));
  assert.equal(table.floor, 2);

  const db = suggestLevel({ description: 'Add a notes column to the visits table in the database' });
  assert.ok(db.triggers.includes('migrations'));
  assert.equal(db.level, 3);
  assert.ok(!db.reasons.some((s) => /may change stored data/.test(s)), 'said once, as the migration');
  assert.equal(suggestLevel({ description: 'Add a SQL column for the audit time' }).level, 3);
});

test('levels: the size reason never contradicts a level a floor raised', () => {
  const r = suggestLevel({ description: 'Rename the sign-in button' });
  assert.equal(r.level, 3);
  assert.ok(!r.reasons.some((s) => /so L[012]\./.test(s)), r.reasons.join(' | '));
  assert.ok(r.reasons.includes('Otherwise a small tweak (wording, a rename, a colour) (L0).'), r.reasons.join(' | '));
  const plain = suggestLevel({ description: 'Add a Copy ID button next to the ticket ID on the admin ticket page' });
  assert.ok(plain.reasons.includes('A short single change, so L1.'), plain.reasons.join(' | '));
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
  assert.equal(suggestLevel({ description: 'Fix the typo', paths: ['public/icons/telescope.svg'] }).floor, 0, 'telescope is not scope');
  for (const p of ['src/getScope.ts', 'lib/scope_where.js', 'src/scopes/index.ts', 'src/data-scope.ts']) {
    assert.equal(suggestLevel({ description: 'Fix the typo', paths: [p] }).floor, 3, p);
  }
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

test('levels: the git helper lists changed paths; null on trouble, [] when nothing changed', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fw-levels-')));
  try {
    assert.equal(await changedPaths(root, 'main'), null, 'not a repository');
    assert.equal(await changedPaths(path.join(root, 'missing'), 'main'), null, 'no such folder');
    assert.equal(await changedPaths('relative/path', 'main'), null);
    assert.equal(await changedPaths(root, '--output=/tmp/x'), null, 'a base that looks like an option is refused');

    const repo = path.join(root, 'repo');
    await fs.mkdir(repo);
    const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    await fs.writeFile(path.join(repo, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    git('checkout', '-q', '-b', 'feature/x');
    assert.deepEqual(await changedPaths(repo, 'main'), [], 'nothing changed yet');
    await fs.mkdir(path.join(repo, 'db', 'migrations'), { recursive: true });
    await fs.writeFile(path.join(repo, 'db', 'migrations', '001.sql'), 'select 1;\n');
    await fs.writeFile(path.join(repo, 'a.txt'), 'b\n');
    await fs.writeFile(path.join(repo, 'odd\tname "q".txt'), 'x\n');
    git('add', '.');
    git('commit', '-q', '-m', 'second');
    assert.deepEqual((await changedPaths(repo, 'main')).sort(), ['a.txt', 'db/migrations/001.sql', 'odd\tname "q".txt'], 'odd names come through as they are');
    assert.equal(await changedPaths(repo, 'no-such-branch'), null, 'an unknown base');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
