// Auto mode and your go-ahead (2026-10-21): which hard lines your own approval already covers
// (lib/hard-lines.js goAheadCovers), the db:* scripts that never touch a database, and the auto mode
// environment each Foreman session gets (lib/auto-env.js). Pure functions and a temp git repo only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { goAheadCovers, hardLine, PR_STAGES } from '../lib/hard-lines.js';
import { classify, commandParts } from '../lib/policy.js';
import { autoModeEnvironment, remotesOf } from '../lib/auto-env.js';

const WT = '/r/orbit-x';
const JOB = '/home/me/.claude/feature-work/x';
const ctx = (over = {}) => ({ mode: 'auto', stage: 'pr1', worktrees: [WT], featureDir: JOB, cwd: '/r/moxie-portal', ...over });
const covers = (command, over) => goAheadCovers('Bash', { command }, ctx(over));

// ---------- pushes and pull requests ----------

test('go-ahead: at a PR stage in auto mode, pushes to your fork and opening the PR are covered', () => {
  for (const stage of PR_STAGES) {
    for (const command of ['git push -u origin feature/x', 'git -C /r/orbit-x push origin feature/x', 'cd /r/orbit-x && git push origin feature/x && gh pr create --repo org/app --base staging --fill', 'timeout 60 git push origin x']) {
      assert.ok(covers(command, { stage }), `${stage}: ${command}`);
    }
  }
  assert.match(covers('git push origin x').reason, /approved the PR stage/);
  assert.match(covers('gh pr create --fill').reason, /pull request/);
});

test('go-ahead: before the PR stage, or in the other settings, a push still asks', () => {
  for (const stage of ['spec', 'plan', 'implement', 'test', 'review', null]) assert.equal(covers('git push origin x', { stage }), null, String(stage));
  for (const mode of ['hands-off', 'ask-all', undefined]) assert.equal(covers('git push origin x', { mode }), null, String(mode));
});

test('go-ahead: merges, migrations, refusals and hidden commands are never covered', () => {
  for (const command of [
    'gh pr merge 12 --squash', 'git push origin x && gh pr merge 12', 'npm run db:migrate', 'npx prisma migrate deploy', 'npm run db:restore',
    'git push --force origin x', 'git push moxie feature/x', 'bash -c "git push origin x"', 'eval "git push origin x"', 'git push origin x; npm run db:migrate',
  ]) {
    assert.equal(covers(command), null, command);
  }
});

test('go-ahead: a command with no hard line is left to the setting (nothing to cover)', () => {
  assert.equal(covers('git status'), null);
  assert.equal(goAheadCovers('Write', { file_path: '/x' }, ctx()), null);
});

// ---------- rm -rf ----------

test('go-ahead: rm -rf inside the job’s own folders is covered, at any stage', () => {
  for (const [command, cwd] of [
    ['rm -rf /r/orbit-x/app/.next /r/orbit-x/app/node_modules', null],
    ['cd /r/orbit-x/app && rm -rf .next node_modules', null],
    ['rm -rf dist', '/r/orbit-x/app'],
    [`rm -rf ${JOB}/checks/old`, null],
    ['rm -rf /tmp/orbit-check-s2', null],
    ['rm -rf -- build', '/r/orbit-x'],
  ]) {
    assert.ok(covers(command, { cwd, stage: 'implement' }), command);
  }
  assert.match(covers('rm -rf /r/orbit-x/dist').reason, /inside the job’s own folders/);
});

test('go-ahead: rm -rf anywhere else, of a whole job folder, or of anything it can’t see still asks', () => {
  for (const [command, cwd] of [
    ['rm -rf /r/orbit-x', null], ['rm -rf /r/orbit-x/', null], [`rm -rf ${JOB}`, null], ['rm -rf /tmp', null],
    ['rm -rf /r/moxie-portal/app/.next', null], ['rm -rf ~/Projects', null], ['rm -rf ../other', '/r/orbit-x'], ['rm -rf /r/orbit-x/../moxie-portal', null],
    ['rm -rf "$DIR"', '/r/orbit-x'], ['rm -rf /r/orbit-x/*', null], ['rm -rf dist', null], ['rm -rf /r/orbit-x/.git', null], ['rm -rf /r/orbit-x/.git/hooks', null],
    ['sudo rm -rf /r/orbit-x/dist', null], ['cd /r/orbit-x || true; rm -rf dist', null], ['cd somewhere && rm -rf dist', '/r/orbit-x'],
  ]) {
    assert.equal(covers(command, { cwd }), null, command);
  }
});

test('commandParts follows cd the way the routine list does', () => {
  const parts = commandParts('cd /r/orbit-x/app && npm test; ls', '/start');
  assert.deepEqual(parts.map((p) => p.cwd), ['/start', '/r/orbit-x/app', null]);
  assert.equal(commandParts('echo `x`'), null);
});

// ---------- db:* scripts that aren't database changes ----------

test('hard lines: db:renumber and other file-only db:* scripts are not database changes', () => {
  for (const command of ['npm run db:renumber -- --check --base moxie/main --floor 0', 'npm run db:status', 'pnpm db:generate', 'cd app && npm run db:renumber -- --check 2>&1 | tail -8; echo "exit ${PIPESTATUS[0]}"']) {
    assert.equal(hardLine('Bash', { command }), null, command);
  }
  for (const command of ['npm run db:migrate -- 0135_x', 'npm run db:renumber && npm run db:migrate', 'npm run db:restore', 'echo "${PIPESTATUS[0]}"; npm run db:push']) {
    assert.equal(hardLine('Bash', { command })?.line, 'database', command);
  }
  const verdict = classify('Bash', { command: 'npm run db:renumber -- --check' }, { mode: 'hands-off', stage: 'implement', featureDir: JOB, worktrees: [WT], cwd: '/r/orbit-x/app' });
  assert.equal(verdict.auto, true, 'a routine check during the build');
});

test('hard lines: raw text names gh pr create and merge apart', () => {
  assert.equal(hardLine('Bash', { command: 'U=$(gh pr create --fill) && echo "$U" # x' })?.line, 'gh-pr-create');
  assert.equal(hardLine('Bash', { command: 'x=`gh pr merge 3`' })?.line, 'gh-pr-merge');
});

// ---------- the auto mode environment ----------

test('auto env: names the job, its repo and worktrees, the fork and the org remote', () => {
  const lines = autoModeEnvironment(
    { title: 'Damage list', slug: 'damage', repoPath: '/r/moxie-portal', worktrees: ['/r/orbit-damage', '/r/moxie-portal'], featureDir: JOB },
    [{ name: 'origin', url: 'https://github.com/me/moxie-portal-vrs.git' }, { name: 'moxie', url: 'https://github.com/Moxie-Pest-Control-Phoenix/moxie-portal.git' }],
  );
  assert.equal(lines.length, 3);
  assert.match(lines[0], /Foreman for the job "Damage list"/);
  assert.match(lines[1], /`\/r\/moxie-portal`, `\/r\/orbit-damage`/);
  assert.match(lines[1], /`origin` = https:\/\/github.com\/me\/moxie-portal-vrs.git, the user's fork/);
  assert.match(lines[1], /`moxie` = https:\/\/github.com\/Moxie-Pest-Control-Phoenix\/moxie-portal.git\. Pull requests from the fork/);
  assert.match(lines[1], /refuses any direct push to it and any force push/);
  assert.match(lines[2], /feature-work\/x/);
  assert.deepEqual(autoModeEnvironment({ slug: 'x', repoPath: null }), []);
});

test('auto env: reads the push remotes from git', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-env-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('remote', 'add', 'origin', 'https://github.com/me/app.git');
  git('remote', 'add', 'moxie', 'git@github.com:moxie-pest/app.git');
  assert.deepEqual((await remotesOf(repo)).sort((a, b) => a.name.localeCompare(b.name)), [
    { name: 'moxie', url: 'git@github.com:moxie-pest/app.git' },
    { name: 'origin', url: 'https://github.com/me/app.git' },
  ]);
  assert.deepEqual(await remotesOf(path.join(repo, 'missing')), []);
  assert.deepEqual(await remotesOf(null), []);
});
