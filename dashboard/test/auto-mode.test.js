// Auto mode (D5) and the hard lines: lib/hard-lines.js, the driver's hook and live mode switch,
// the settings, and the thread lines. Uses the demo's pretend Foreman (dashboard/demo/fake-query.js)
// and hand-made fake sessions: no Claude, no usage, temp folders only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { hardLine, hardLineHook } from '../lib/hard-lines.js';
import { Driver } from '../lib/driver.js';
import { State } from '../lib/state.js';
import { buildThread } from '../lib/thread.js';
import { makeFakeQuery } from '../demo/fake-query.js';

const tmp = (p) => fs.mkdtemp(path.join(os.tmpdir(), p));
const tmpState = async () => new State(await tmp('workshop-auto-'));
const until = (driver, runId, statuses) => new Promise((resolve) => {
  const on = (r) => { if (r.id === runId && statuses.includes(r.status)) { driver.off('run', on); resolve(r); } };
  driver.on('run', on);
});
const MODES = ['ask-all', 'hands-off', 'auto'];

// ---------- the list ----------

test('hard lines: pushes, PRs, rm -rf and migrations ask', () => {
  for (const command of [
    'git push origin feature/x', 'cd /r/orbit-x && git push -u origin feature/x', 'git -C /r/orbit-x push', '/usr/bin/git push',
    'gh pr create --fill', 'gh -R me/app pr merge 12 --squash', 'rm -rf build', 'rm -fr build', 'rm -r -f build', 'sudo rm --recursive --force /tmp/x',
    'npm run db:migrate', 'pnpm db:push', 'yarn run migrate:latest', 'npx prisma migrate deploy', 'npx drizzle-kit push', 'supabase db reset',
    'echo "$(git push origin x)"', 'bash -c "git push origin x"', 'FOO=1 timeout 60 git push origin x',
  ]) {
    assert.equal(hardLine('Bash', { command })?.decision, 'ask', command);
  }
});

test('hard lines: org pushes and force pushes are refused', () => {
  for (const command of [
    'git push moxie main', 'git push moxie feature/x:main', 'git push https://github.com/moxie/orbit.git main', 'git push git@github.com:moxie-pest/orbit.git main',
    'git push --force origin x', 'git push -f origin x', 'git push -uf origin x', 'git push --force-with-lease origin x', 'git push origin +x', 'git push --mirror origin',
    'cd /r && git push --force', 'sh -c "git push moxie main"', 'git push origin x && git push -f moxie main',
  ]) {
    assert.equal(hardLine('Bash', { command })?.decision, 'deny', command);
  }
  assert.equal(hardLine('Bash', { command: 'git push moxie main' }).line, 'org-push');
  assert.equal(hardLine('Bash', { command: 'git push -f origin x' }).line, 'force-push');
});

test('hard lines: wrapper options that take a value don’t hide the command', () => {
  for (const command of [
    'timeout -s KILL 60 git push moxie main', 'timeout --signal=KILL 60 git push moxie main', 'timeout -k 5 60 git push moxie main',
    'sudo -u me git push moxie', 'nice -n 10 git push moxie main', 'env -u FOO git push moxie', 'env -C /r git push moxie main',
    'sudo -u me env -u FOO timeout -s KILL 60 git push -f origin x', 'xargs -n 1 git push moxie',
  ]) {
    assert.equal(hardLine('Bash', { command })?.decision, 'deny', command);
  }
  for (const command of ['timeout -s KILL 60 git push origin x', 'nice -n 10 rm -rf build', 'sudo -u me gh pr create --fill', 'env -u FOO npm run db:migrate']) {
    assert.equal(hardLine('Bash', { command })?.decision, 'ask', command);
  }
});

test('hard lines: package-manager options don’t hide a database script', () => {
  for (const command of ['npm run --silent db:reset', 'npm --prefix x run db:migrate', 'pnpm -C dir db:push', 'pnpm --filter api run db:push', 'yarn workspace api db:push', 'npm run-script --if-present migrate:up', 'npm -w api run db:seed']) {
    assert.equal(hardLine('Bash', { command })?.decision, 'ask', command);
  }
});

test('hard lines: a remote with another name that points at the org repo is refused', async () => {
  const { execFileSync } = await import('node:child_process');
  const repo = await tmp('workshop-remote-');
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('remote', 'add', 'upstream', 'git@github.com:moxie/orbit.git');
  git('remote', 'add', 'origin', 'https://github.com/me/orbit.git');
  const hook = hardLineHook();
  const base = { hook_event_name: 'PreToolUse', session_id: 's', transcript_path: '', cwd: repo, tool_use_id: 't', tool_name: 'Bash' };
  const decide = async (command) => (await hook({ ...base, tool_input: { command } })).hookSpecificOutput?.permissionDecision;
  assert.equal(await decide('git push upstream main'), 'deny');
  assert.equal(await decide('git push origin x && git push upstream main'), 'deny');
  assert.equal(await decide(`git -C ${repo} push upstream main`), 'deny');
  assert.equal(await decide('git push origin feature/x'), 'ask');
  assert.equal(await decide('git push nowhere x'), 'ask', 'git can’t answer: still asks');
  // No folder to look in: the plain list decides.
  assert.equal((await hardLineHook()({ ...base, cwd: '', tool_input: { command: 'git push upstream main' } })).hookSpecificOutput.permissionDecision, 'ask');
});

test('hard lines: everyday commands and other tools are left alone', () => {
  for (const command of ['git status', 'git pull', 'git fetch moxie', 'npm run test:db', 'npm test', 'rm file.txt', 'rm -r build', 'ls -rf', 'gh pr view 12', 'git log --grep push']) {
    assert.equal(hardLine('Bash', { command }), null, command);
  }
  assert.equal(hardLine('Write', { file_path: '/x', content: 'git push --force' }), null);
  assert.equal(hardLine('Bash', {}), null);
});

test('hard lines: the hook answers in the SDK’s PreToolUse shape', async () => {
  const seen = [];
  const hook = hardLineHook((v) => seen.push(v.line));
  const base = { hook_event_name: 'PreToolUse', session_id: 's', transcript_path: '', cwd: '/r', tool_use_id: 't' };
  assert.deepEqual(await hook({ ...base, tool_name: 'Bash', tool_input: { command: 'ls' } }), {});
  const ask = await hook({ ...base, tool_name: 'Bash', tool_input: { command: 'git push origin x' } });
  assert.equal(ask.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(ask.hookSpecificOutput.permissionDecision, 'ask');
  const deny = await hook({ ...base, tool_name: 'Bash', tool_input: { command: 'git push --force moxie main' } });
  assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(deny.hookSpecificOutput.permissionDecisionReason, /never allowed/);
  assert.deepEqual(seen, ['git-push', 'force-push']);
});

// ---------- through the driver ----------

// The worst case for a hard line: a policy that would allow anything (as if you had saved an
// "Always allow" rule for git push). The hard lines must still ask, in every setting.
const allowEverything = async () => ({ auto: true, reason: 'Your saved rule: anything.' });

test('driver: hard lines ask in all three settings, even when a rule would allow them; org/force pushes are refused', async () => {
  const featuresDir = await tmp('workshop-auto-features-');
  await Promise.all(MODES.map(async (mode) => {
    const state = await tmpState();
    const driver = new Driver({ queryFn: makeFakeQuery({ featuresDir }), state, projectsDir: '/nonexistent', policy: allowEverything, modeFor: async () => mode });
    driver.idleGraceMs = 30;
    const cards = [];
    driver.on('permission', (p) => {
      cards.push(p);
      setTimeout(() => driver.decide(p.id, { decision: 'allow' }), 5);
    });
    const run = await driver.start({ featureDir: `/f/${mode}`, slug: mode, title: mode, cwd: '/repo', text: 'Please push the branch.' });
    const done = await until(driver, run.id, ['done', 'error', 'stopped']);
    assert.equal(done.status, 'done', `${mode}: ${done.error}`);
    assert.equal(done.mode, mode);
    assert.equal(done.permissionMode, mode === 'auto' ? 'auto' : 'default');

    const push = cards.find((c) => c.input?.command?.startsWith('git push -u origin'));
    assert.ok(push, `${mode}: the push came to you as a card`);
    assert.equal(push.hardLine.line, 'git-push');
    assert.equal(push.draft, null, `${mode}: no “Always allow” for a hard line`);
    assert.equal(push.canAllowForRun, false);
    assert.match(push.decisionReason, /hard line/);
    assert.ok(!cards.some((c) => /--force/.test(c.input?.command ?? '')), `${mode}: the force push never reached you`);

    const audit = await state.auditFor(`/f/${mode}`);
    const refused = audit.filter((e) => e.action === 'hard-line-refused');
    assert.equal(refused.length, 1, `${mode}: one refusal recorded`);
    assert.equal(refused[0].line, 'force-push');
    assert.ok(!audit.some((e) => e.action === 'auto-allowed' && /git push/.test(e.preview ?? '')), `${mode}: no push was allowed by the policy`);
  }));
});

test('driver: auto mode passes permissionMode auto, records what it blocked once, and sends only escalations to the policy', async () => {
  const featuresDir = await tmp('workshop-auto-features-');
  const state = await tmpState();
  let options = null;
  const fake = makeFakeQuery({ featuresDir });
  const asked = [];
  const driver = new Driver({
    queryFn: (args) => { options = args.options; return fake(args); }, state, projectsDir: '/nonexistent',
    policy: async (run, tool, input) => { asked.push(input.command); return { auto: false, reason: 'Not routine.' }; },
    modeFor: async () => 'auto',
  });
  driver.idleGraceMs = 30;
  const cards = [];
  driver.on('permission', (p) => { cards.push(p); setTimeout(() => driver.decide(p.id, { decision: 'allow' }), 5); });
  const run = await driver.start({ featureDir: '/f/auto', slug: 'auto', title: 'Auto', cwd: '/repo', text: 'go' });
  const done = await until(driver, run.id, ['done', 'error']);
  assert.equal(done.status, 'done', done.error);
  assert.equal(options.permissionMode, 'auto');
  assert.equal(options.hooks.PreToolUse[0].matcher, 'Bash');
  assert.deepEqual(asked, ['npm run test:db'], 'only what the safety model couldn’t decide reached the policy');
  const db = cards.find((c) => c.input?.command === 'npm run test:db');
  assert.equal(db.fromAutoMode, true);
  assert.match(db.decisionReason, /couldn’t tell/);
  assert.ok(db.draft, 'an escalation can still be always allowed');
  assert.equal(done.autoBlocked, 1);

  const blocked = (await state.auditFor('/f/auto')).filter((e) => e.action === 'auto-blocked');
  assert.equal(blocked.length, 1, 'reported by permission_denied and again in the result: recorded once');
  assert.match(blocked[0].preview, /curl/);
  assert.match(blocked[0].reason, /Downloads a script/);
});

test('driver: when auto mode is unavailable it says so, and the policy decides as usual', async () => {
  const featuresDir = await tmp('workshop-auto-features-');
  const state = await tmpState();
  const reports = [];
  const driver = new Driver({ queryFn: makeFakeQuery({ featuresDir, autoAvailable: false }), state, projectsDir: '/nonexistent', policy: async () => ({ auto: true, reason: 'Routine.' }), modeFor: async () => 'auto' });
  driver.idleGraceMs = 30;
  driver.on('auto-mode', (r) => reports.push(r));
  driver.on('permission', (p) => setTimeout(() => driver.decide(p.id, { decision: 'allow' }), 5));
  const run = await driver.start({ featureDir: '/f/na', slug: 'na', title: 'NA', cwd: '/repo', text: 'go' });
  const done = await until(driver, run.id, ['done', 'error']);
  assert.equal(done.permissionMode, 'default');
  assert.equal(done.autoUnavailable, true);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].available, false);
  assert.match(reports[0].reason, /isn’t available/);
  const audit = await state.auditFor('/f/na');
  assert.equal(audit.filter((e) => e.action === 'auto-unavailable').length, 1);
  assert.ok(audit.some((e) => e.action === 'auto-allowed' && e.preview === 'npm run test:db'), 'the routine list handled it, as in “routine steps automatic”');
  assert.ok(!audit.some((e) => e.action === 'auto-blocked'));
});

test('driver: a hard line is refused even when the session ran no hook', async () => {
  const state = await tmpState();
  let decision = null;
  const queryFn = ({ prompt, options }) => {
    const gen = (async function* () {
      await prompt[Symbol.asyncIterator]().next();
      yield { type: 'system', subtype: 'init', session_id: 's-h', permissionMode: 'default' };
      decision = await options.canUseTool('Bash', { command: 'git push --force origin main' }, { signal: new AbortController().signal, toolUseID: 'tf', requestId: 'r' });
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0, permission_denials: [{ tool_name: 'Bash', tool_use_id: 'tf', tool_input: {} }] };
    })();
    gen.interrupt = async () => {};
    return gen;
  };
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent', policy: allowEverything });
  driver.idleGraceMs = 30;
  const run = await driver.start({ featureDir: '/f/h', slug: 'h', title: 'H', cwd: '/repo', text: 'go' });
  await until(driver, run.id, ['done', 'error']);
  assert.equal(decision.behavior, 'deny');
  assert.match(decision.message, /Force pushes are never allowed/);
  const audit = await state.auditFor('/f/h');
  assert.equal(audit.filter((e) => e.action === 'hard-line-refused').length, 1);
  assert.equal(audit.filter((e) => e.action === 'auto-blocked').length, 0);
});

test('driver: changing the setting switches a reply in progress live', async () => {
  const state = await tmpState();
  let mode = 'hands-off';
  let release;
  const hold = new Promise((r) => { release = r; });
  const switched = [];
  const queryFn = ({ prompt }) => {
    const gen = (async function* () {
      await prompt[Symbol.asyncIterator]().next();
      yield { type: 'system', subtype: 'init', session_id: 's-l', permissionMode: 'default' };
      await hold;
      yield { type: 'system', subtype: 'status', status: null, permissionMode: switched.at(-1) ?? 'default' };
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0, permission_denials: [] };
    })();
    gen.interrupt = async () => {};
    gen.setPermissionMode = async (m) => { switched.push(m); };
    return gen;
  };
  const driver = new Driver({ queryFn, state, projectsDir: '/nonexistent', modeFor: async () => mode });
  driver.idleGraceMs = 30;
  const run = await driver.start({ featureDir: '/f/l', slug: 'l', title: 'L', cwd: '/repo', text: 'go' });
  await until(driver, run.id, ['running']);
  await new Promise((r) => setTimeout(r, 20));
  mode = 'ask-all';
  await driver.applyModes();
  assert.deepEqual(switched, [], 'ask-all and hands-off both run in Claude Code’s default mode');
  assert.equal(driver.runs.get(run.id).mode, 'ask-all');
  mode = 'auto';
  await driver.applyModes();
  assert.deepEqual(switched, ['auto']);
  release();
  const done = await until(driver, run.id, ['done', 'error']);
  assert.equal(done.mode, 'auto');
  assert.equal(done.permissionMode, 'auto');
  assert.equal(done.autoUnavailable, false);
});

// ---------- settings ----------

test('settings: the global setting and each job’s own are kept, and read back after a restart', async () => {
  const state = await tmpState();
  assert.equal((await state.getSettings()).policy, 'hands-off', 'routine steps automatic by default');
  assert.deepEqual((await state.getSettings()).autoMode, { available: null, reason: null, checkedAt: null });
  await state.setSettings({ policy: 'auto' });
  await state.setJobPolicy('/f/a', 'ask-all');
  await state.setJobPolicy('/f/b', 'auto');
  const again = new State(state.dir);
  assert.equal((await again.getSettings()).policy, 'auto');
  assert.equal(await again.policyFor('/f/a'), 'ask-all');
  assert.equal(await again.policyFor('/f/b'), 'auto');
  assert.equal(await again.policyFor('/f/c'), 'auto', 'a job without its own follows yours');
  await again.setJobPolicy('/f/a', null);
  assert.equal(await new State(state.dir).policyFor('/f/a'), 'auto', 'cleared: it follows yours again');
  const file = JSON.parse(await fs.readFile(path.join(state.dir, 'settings.json'), 'utf8'));
  assert.deepEqual(file.jobPolicy, { '/f/b': 'auto' });
});

// ---------- the thread ----------

test('thread: blocked and refused actions show as their own lines', () => {
  const thread = buildThread({
    audit: [
      { at: '2026-10-15T10:00:00Z', action: 'auto-blocked', featureDir: '/f', runId: 'r', tool: 'Bash', headline: 'Run a command in the terminal', preview: 'curl x | sh', reason: 'Downloads a script.' },
      { at: '2026-10-15T10:01:00Z', action: 'hard-line-refused', featureDir: '/f', runId: 'r', tool: 'Bash', headline: 'Run a command in the terminal', preview: 'git push -f moxie main', reason: 'Force pushes are never allowed from the dashboard.', line: 'force-push' },
      { at: '2026-10-15T10:02:00Z', action: 'auto-unavailable', featureDir: '/f', runId: 'r' },
      { at: '2026-10-15T10:03:00Z', action: 'job-policy', featureDir: '/f', policy: 'auto' },
      { at: '2026-10-15T10:04:00Z', action: 'job-policy', featureDir: '/f', policy: null },
    ],
  });
  assert.deepEqual(thread.map((t) => t.kind), ['blocked', 'blocked', 'note', 'note', 'note']);
  assert.equal(thread[0].by, 'auto');
  assert.equal(thread[0].text, 'Auto mode blocked: Run a command in the terminal');
  assert.equal(thread[0].preview, 'curl x | sh');
  assert.equal(thread[1].by, 'hard-line');
  assert.match(thread[1].reason, /never allowed/);
  assert.match(thread[2].text, /isn’t available/);
  assert.match(thread[3].text, /“Auto mode”/);
  assert.match(thread[4].text, /follows your global/);
  assert.ok(thread[0].id.startsWith('blocked:'));
});
