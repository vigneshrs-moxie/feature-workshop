import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseProfile, parseBlock, loadProfile, fillPattern, tryItRules, devCommand, GENERAL, PROFILE_FILE, githubOfUrl, portsLabel } from '../lib/profile.js';

const doc = (block, notes = '') => `---\n${block}\n---\n${notes}`;
const errorsOf = (block) => parseProfile(doc(`name: X\n${block}`)).errors;

test('profile: reads key: value, groups two spaces in, lists, list items with settings, quotes and comments', () => {
  const { data, errors } = parseBlock([
    '# a comment',
    'name: Orbit',
    'quoted: "a # kept" # dropped',
    "single: 'it''s'",
    'plain: value # dropped',
    'group:',
    '  inner: 1',
    '  deeper:',
    '    leaf: yes',
    'list:',
    '  - one',
    '  - two words',
    'items:',
    '  - from: a',
    '    to: b',
    '    keys:',
    '      - K1',
    '  - from: c',
    '    to: d',
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(data, {
    name: 'Orbit', quoted: 'a # kept', single: 'it\'s', plain: 'value',
    group: { inner: '1', deeper: { leaf: 'yes' } },
    list: ['one', 'two words'],
    items: [{ from: 'a', to: 'b', keys: ['K1'] }, { from: 'c', to: 'd' }],
  });
});

test('profile: the block’s own mistakes, each with its line, in plain words', () => {
  const lines = (block) => parseProfile(doc(block)).errors.join('\n');
  assert.match(parseProfile('name: X\n').errors[0], /must start with a line of three dashes/);
  assert.match(parseProfile('---\nname: X\n').errors[0], /never end/);
  assert.match(lines('name: X\n   odd: 1'), /Line 3: indent with two spaces per level/);
  assert.match(lines('name: X\n\tbad: 1'), /Line 3: use spaces, not tabs/);
  assert.match(lines('name: X\nname: Y'), /Line 3: “name” is given twice/);
  assert.match(lines('name: X\njust words'), /Line 3: expected a setting written as “name: value”/);
  assert.match(lines('name: X\nlist: [a, b]'), /Line 3: write lists and groups on lines of their own/);
  assert.match(lines('name: "X'), /Line 2: a quote is opened and never closed/);
  assert.match(lines('name: X\ngroup:\n    four: 1'), /Line 4: indent with two spaces per level/);
});

test('profile: each field’s bad shape gives its own plain error', () => {
  const cases = [
    ['github: just-a-name', /^github must look like org\/repo/],
    ['remotes:\n  fork: "bad name"', /^fork \(under remotes\) must be a remote’s name/],
    ['remotes:\n  fork: origin\n  org: origin', /^remotes: fork and org must be two different remotes/],
    ['base: main', /^base must be a remote and a branch, like moxie\/main/],
    ['worktree: ../orbit-{n}', /^worktree must have \{slug\} in it/],
    ['worktree: /abs/{slug}', /^worktree must be a folder next to the repository/],
    ['branch: "{kind}/{port}"', /^branch can’t use \{port\}/],
    ['branch: "{kind}"', /^branch must have \{slug\} or \{n\} or \{title\} in it/],
    ['branch: "{kind} /{slug}"', /^branch must make a usable branch name/],
    ['slug: "Orbit-{n}"', /^slug may use only lower-case letters, numbers and dashes/],
    ['slug: orbit', /^slug must have \{n\} or \{title\} or \{key\} in it/],
    ['kinds:\n  bug: "two words"', /^bug \(under kinds\) must be one word/],
    ['prRoute: one step', /^prRoute must be a list of steps/],
    ['riskFloors:\n  - path: app/**\n    level: 5', /^level \(in riskFloors, item 1\) must be a level from 0 to 3/],
    ['riskFloors:\n  - level: 3', /^path \(in riskFloors, item 1\) is missing/],
    ['riskFloors:\n  - app/**', /^riskFloors must be a list, one “- path: …” item/],
    ['tryIt:\n  ports: 3001', /^ports \(under tryIt\) must look like 3001-3099/],
    ['tryIt:\n  ports: 3099-3001', /^ports \(under tryIt\) must look like 3001-3099/],
    ['tryIt:\n  url: http://localhost:3001', /^url \(under tryIt\) must be a web address with \{port\} in it/],
    ['tryIt:\n  app: ../elsewhere', /^app \(under tryIt\) must be the app’s folder inside the repository/],
    ['tryIt: npm run dev', /^tryIt must hold settings of its own/],
    ['filesToCopy:\n  - from: /etc/passwd\n    to: a', /^from \(in filesToCopy, item 1\) must be a file inside your main checkout/],
    ['filesToCopy:\n  - from: a', /^to \(in filesToCopy, item 1\) is missing/],
    ['filesToCopy:\n  - from: a\n    to: b\n    portKeys: AUTH_URL', /^portKeys \(in filesToCopy, item 1\) must be a list of setting names/],
    ['filesToCopy:\n  - from: a\n    to: b\n    signInSkip: "not a key"', /^signInSkip \(in filesToCopy, item 1\) must be the name of one setting/],
    ['database:\n  name: "bad-name"', /^name \(under database\) must be the local database’s name/],
    ['setup: npm install', /^setup must be a list of commands/],
    ['cleanup:\n  - ""', /^cleanup must be a list of commands/],
  ];
  for (const [block, want] of cases) {
    const errors = errorsOf(block);
    assert.equal(errors.length, 1, `${block}: ${errors.join(' | ')}`);
    assert.match(errors[0], want, block);
  }
  assert.match(parseProfile(doc('github: a/b')).errors[0], /^name is missing/);
});

test('profile: unknown keys are kept and warned about, never an error', () => {
  const r = parseProfile(doc('name: X\nstacks:\n  max: 3\ntryIt:\n  ports: 4000-4010\n  colour: blue', 'Notes for people.'));
  assert.equal(r.ok, true);
  assert.equal(r.profile.notes, 'Notes for people.');
  assert.deepEqual(r.profile.extra, { stacks: { max: '3' }, tryIt: { colour: 'blue' } });
  assert.deepEqual(r.profile.tryIt.ports, { first: 4000, last: 4010 });
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /doesn’t know “stacks”, so it is kept but not used/);
  assert.match(r.warnings[1], /doesn’t know “colour” \(under tryIt\)/);
});

test('profile: patterns fill, and an empty value takes one separator with it', () => {
  assert.equal(fillPattern('orbit-{n}-{title}', { n: 479, title: 'feedback-api' }), 'orbit-479-feedback-api');
  assert.equal(fillPattern('orbit-{n}-{title}', { n: 7, title: '' }), 'orbit-7');
  assert.equal(fillPattern('{kind}/{slug}', { kind: 'fix', slug: 'orbit-1-x' }), 'fix/orbit-1-x');
  assert.equal(fillPattern('{kind}/{slug}', { kind: null, slug: 'a' }), 'a');
  assert.equal(fillPattern('../orbit-{slug}', { slug: 'orbit-2' }), '../orbit-orbit-2');
  assert.equal(fillPattern('npm run dev -- -p {port}', { port: 3005 }), 'npm run dev -- -p 3005');
  assert.equal(fillPattern('http://localhost:{port}/{other}', { port: 1 }), 'http://localhost:1/{other}', 'what it isn’t given stays as it is');
});

test('profile: loadProfile reads a repository’s ground-control.md or a named file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-profile-'));
  assert.match((await loadProfile(dir)).errors[0], /There is no profile at/);
  await fs.writeFile(path.join(dir, PROFILE_FILE), doc('name: Here\ngithub: a/b'));
  const r = await loadProfile(dir);
  assert.equal(r.ok, true);
  assert.equal(r.file, path.join(dir, PROFILE_FILE));
  assert.equal(r.profile.github, 'a/b');
  await fs.writeFile(path.join(dir, 'other.md'), doc('github: a/b'));
  assert.equal((await loadProfile(path.join(dir, 'other.md'))).ok, false);
  await fs.rm(dir, { recursive: true, force: true });
});

test('profile: with no profile, Try it is today’s general case', () => {
  const r = tryItRules(null);
  assert.equal(r.profile, null);
  assert.deepEqual(r.ports, { first: 3001, last: null });
  assert.ok(r.appDirs.includes('app') && r.appDirs.includes(''));
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].signInSkip, 'DEV_BYPASS_AUTH');
  assert.equal(devCommand(r, 'next dev --turbopack', 3002), 'npm run dev -- -p 3002 -H 127.0.0.1');
  assert.equal(devCommand(r, 'vite', 3002), 'npm run dev');
  assert.equal(GENERAL.slug, '{key}-{title}');
  assert.equal(githubOfUrl('git@github.com:Org/repo.git'), 'Org/repo');
  assert.equal(portsLabel({ first: 3001, last: 3099 }), '3001-3099');
  assert.equal(portsLabel({ first: 3001, last: null }), '3001 and up');
});
