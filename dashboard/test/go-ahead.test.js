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

// ---------- through the driver ----------

import { Driver } from '../lib/driver.js';
import { State } from '../lib/state.js';
import { makeFakeQuery } from '../demo/fake-query.js';

const until = (driver, runId, statuses) => new Promise((resolve) => {
  const on = (r) => { if (r.id === runId && statuses.includes(r.status)) { driver.off('run', on); resolve(r); } };
  driver.on('run', on);
});

test('driver: in auto mode a covered push runs without a card and is logged; other settings still ask', async () => {
  const featuresDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-goahead-'));
  for (const mode of ['auto', 'hands-off']) {
    const state = new State(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-goahead-state-')));
    let settings = null;
    const driver = new Driver({
      queryFn: (args) => { settings = args.options.settings ?? null; return makeFakeQuery({ featuresDir })(args); },
      state, projectsDir: '/nonexistent',
      policy: async () => ({ auto: true, reason: 'Your saved rule: anything.' }), modeFor: async () => mode,
      cover: async (run, tool, input) => goAheadCovers(tool, input, { mode, stage: 'pr1', worktrees: [], featureDir: run.featureDir, cwd: run.cwd }),
      settingsFor: async () => ({ autoMode: { environment: ['**Trusted repo (this job)**: x'] } }),
    });
    driver.idleGraceMs = 30;
    const cards = [];
    driver.on('permission', (p) => { cards.push(p); setTimeout(() => driver.decide(p.id, { decision: 'allow' }), 5); });
    const run = await driver.start({ featureDir: `/f/${mode}`, slug: mode, title: mode, cwd: '/repo', text: 'Please push the branch.' });
    const done = await until(driver, run.id, ['done', 'error', 'stopped']);
    assert.equal(done.status, 'done', `${mode}: ${done.error}`);
    assert.deepEqual(settings, { autoMode: { environment: ['**Trusted repo (this job)**: x'] } }, 'the session gets the job’s settings');
    const pushCard = cards.find((c) => c.input?.command?.startsWith('git push -u origin'));
    const audit = await state.auditFor(`/f/${mode}`);
    const allowed = audit.find((e) => e.action === 'auto-allowed' && /git push -u origin/.test(e.preview ?? ''));
    if (mode === 'auto') {
      // The hook stepped aside, so auto mode's safety model judged it (here, the pretend one allowed it).
      assert.equal(pushCard, undefined, 'auto: no card for the covered push');
    } else {
      assert.ok(pushCard, 'hands-off: the push still asks');
      assert.equal(allowed, undefined, 'a saved rule never allows a hard line');
    }
    const refused = audit.filter((e) => e.action === 'hard-line-refused');
    assert.equal(refused.length, 1, `${mode}: the force push is still refused`);
  }
});

// When Claude Code itself asks (your own "ask" rule for git push in ~/.claude/settings.json), the
// request reaches the dashboard: a covered hard line is allowed and logged; an uncovered one asks.
test('driver: a covered hard line that Claude Code asks about is allowed and logged under Handled for you', async () => {
  const state = new State(await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-goahead-state-')));
  const decisions = {};
  const queryFn = ({ prompt, options }) => {
    const gen = (async function* () {
      await prompt[Symbol.asyncIterator]().next();
      yield { type: 'system', subtype: 'init', session_id: 's-g', permissionMode: 'auto' };
      const ask = (id, command) => options.canUseTool('Bash', { command }, { signal: new AbortController().signal, toolUseID: id, requestId: id, decisionReason: 'Your ask rule: Bash(git push *)' });
      decisions.push = await ask('t1', 'git push -u origin feature/x');
      decisions.merge = await Promise.race([ask('t2', 'gh pr merge 12'), new Promise((r) => setTimeout(() => r('card'), 300))]);
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0 };
    })();
    gen.interrupt = async () => {};
    return gen;
  };
  const driver = new Driver({
    queryFn, state, projectsDir: '/nonexistent', modeFor: async () => 'auto',
    cover: async (run, tool, input) => goAheadCovers(tool, input, { mode: 'auto', stage: 'pr1', worktrees: [], featureDir: run.featureDir, cwd: run.cwd }),
  });
  driver.idleGraceMs = 30;
  const cards = [];
  driver.on('permission', (p) => { cards.push(p); setTimeout(() => driver.decide(p.id, { decision: 'deny' }), 400); });
  const run = await driver.start({ featureDir: '/f/g', slug: 'g', title: 'G', cwd: '/repo', text: 'go' });
  await until(driver, run.id, ['done', 'error']);
  assert.equal(decisions.push.behavior, 'allow');
  assert.equal(decisions.merge, 'card', 'a merge still waits for you');
  assert.deepEqual(cards.map((c) => c.hardLine?.line), ['gh-pr-merge']);
  const allowed = (await state.auditFor('/f/g')).filter((e) => e.action === 'auto-allowed');
  assert.equal(allowed.length, 1);
  assert.match(allowed[0].reason, /approved the PR stage/);
});

// ---------- creating the org branch (2026-10-22) ----------

const SHA = 'a'.repeat(40);
const CREATE = `gh api -X POST repos/Moxie-Pest-Control-Phoenix/moxie-portal/git/refs -f ref=refs/heads/feature/x -f sha=${SHA}`;

test('org branch: creating a new one from a written-out commit is routine once building is approved', () => {
  assert.equal(hardLine('Bash', { command: CREATE }), null);
  for (const stage of ['implement', 'review', 'pr1']) {
    assert.equal(classify('Bash', { command: CREATE }, { ...ctx({ mode: 'hands-off', stage }) }).auto, true, stage);
  }
  assert.equal(classify('Bash', { command: CREATE }, ctx({ mode: 'hands-off', stage: 'spec' })).auto, false);
  assert.equal(classify('Bash', { command: CREATE }, ctx({ mode: 'ask-all', stage: 'pr1' })).auto, false);
  // Without -X, fields make it a POST; --silent is fine.
  assert.equal(classify('Bash', { command: `gh api --silent /repos/moxie-x/app/git/refs -f ref=refs/heads/f -f sha=${SHA}` }, ctx({ mode: 'hands-off', stage: 'pr1' })).auto, true);
});

test('org branch: anything else that writes its branches is refused; reading them is not', () => {
  for (const command of [
    `gh api -X PATCH repos/moxie-x/app/git/refs/heads/feature/x -f sha=${SHA} -F force=true`,
    'gh api -X DELETE repos/moxie-x/app/git/refs/heads/feature/x',
    `gh api -X POST repos/moxie-x/app/git/refs -f ref=refs/heads/staging -f sha=${SHA}`,
    `gh api -X POST repos/moxie-x/app/git/refs -f ref=refs/heads/release/1 -f sha=${SHA}`,
    `gh api -X POST repos/moxie-x/app/git/refs -f ref=refs/tags/v1 -f sha=${SHA}`,
    'gh api -X POST repos/moxie-x/app/git/refs -f ref=refs/heads/f -f sha=main',
    'gh api -X POST repos/moxie-x/app/git/refs --input body.json',
    `sudo gh api -X POST repos/moxie-x/app/git/refs -f ref=refs/heads/f -f sha=${SHA}`,
  ]) assert.equal(hardLine('Bash', { command })?.line, 'org-ref-write', command);
  assert.equal(hardLine('Bash', { command: 'gh api repos/moxie-x/app/git/refs/heads/feature/x --jq .object.sha' }), null);
  assert.equal(hardLine('Bash', { command: 'git push moxie feature/x' }).line, 'org-push');
});
