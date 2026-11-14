// The protocol between the runner and the site (lib/protocol.js): two closed command lists, the
// check every command goes through, and the events a runner sends up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES, LOCAL_COMMANDS, NEVER_CARRIED, PROTOCOL_VERSION, REMOTE_COMMANDS, makeEvent, parseCommand } from '../lib/protocol.js';

// One good command of every type, with every field it takes filled in.
const GOOD = {
  start: { description: 'Add a tidy button', repoPath: '/tmp/repo', options: { level: 1 }, model: 'claude-opus-5-5', kind: 'feature', ticket: { key: 'ORBIT-479' }, fromSession: null, despiteLimit: false, name: 'status-filter' },
  reply: { slug: 'sample-job', via: 'box', text: 'Carry on, please.', kind: 'message', gateBrief: 2, model: null, despiteLimit: false, confirmNoTerminal: true },
  approve: { slug: 'sample-job', briefNumber: 3, note: 'Looks right.', answers: { q1: { choice: 'A' } }, verdicts: {}, chips: [], text: 'Approved.', startAfterReset: false },
  'send-back': { slug: 'sample-job', briefNumber: 3, note: 'Change the title.', chips: [{ kind: 'skip', stage: 'wireframes' }] },
  stop: { slug: 'sample-job', briefNumber: null, note: '' },
  allow: { requestId: '0b8f6c1e-2d1a-4f5e-9b3a-7c2d1e0f9a8b', note: 'ok', answers: { 'Which one?': 'A' }, scope: 'run' },
  deny: { requestId: 'req-1', note: 'Not that file.' },
  pause: { runId: 'run-1' },
  'take-over': { slug: 'sample-job' },
  'fetch-diff': { slug: 'sample-job', commit: 'abc1234' },
  'stack-merge': { slug: 'sample-stack', section: 'part-1' },
  auto: { slug: 'sample-job', on: true },
  'auto-start': { on: true, tag: 'auto' },
  steer: { runId: 'run-1', text: 'Leave the README alone.' },
  resume: { slug: 'sample-job', via: 'cli' },
  close: { slug: 'sample-job', as: 'dropped', note: 'Not needed now.', removeWorktree: true },
  reopen: { slug: 'sample-job' },
  options: { slug: 'sample-job', options: { level: 2 }, level: 2, updated_at: null },
  policy: { slug: 'sample-job', policy: 'ask-all' },
  notes: { slug: 'sample-job', text: '# Notes\n' },
  'try-it': { slug: 'sample-job', action: 'run', preset: 'test', command: 'npm test', where: 'root', what: 'terminal', name: 'iTerm', db: 'copy' },
  settings: { notify: { needs: true }, workflow: { finishLine: 'main' }, play: { mode: 'off' }, recheckAuto: true, policy: 'hands-off', autoResume: true },
  rules: { action: 'add', rule: { tool: 'Bash', kind: 'prefix', value: 'npm test' }, permissionId: 'req-1', id: null },
  nudge: { slug: 'sample-job', nudge: 'pr1-merge', answer: 'yes', model: null, despiteLimit: false, confirmNoTerminal: false },
  repo: { slug: 'sample-job', repoPath: '/tmp/repo', branch: 'feat/x' },
  restart: { slug: 'sample-job', model: 'claude-fable-5-2' },
  prototype: { slug: 'sample-job', action: 'publish' },
  'usage-resume': {},
  name: { ticket: { key: 'ORBIT-479', title: 'Feedback API' }, description: 'ORBIT-479: Feedback API', kind: 'bug', repoPath: '/tmp/repo', avoid: ['status-filter'] },
  'queue-message': { slug: 'sample-job', text: 'Also the header.', replace: true, model: null, despiteLimit: false, confirmNoTerminal: false },
  'cancel-waiting': { slug: 'sample-job' },
  'send-waiting': { slug: 'sample-job' },
  'stop-then-send': { runId: 'run-1' },
};

test('the two lists are exactly the plan’s, closed and frozen', () => {
  assert.deepEqual(Object.keys(REMOTE_COMMANDS).sort(), ['allow', 'approve', 'auto', 'auto-start', 'deny', 'fetch-diff', 'pause', 'reply', 'send-back', 'stack-merge', 'start', 'stop', 'take-over']);
  assert.deepEqual(Object.keys(LOCAL_COMMANDS).sort(), ['close', 'name', 'notes', 'nudge', 'options', 'policy', 'prototype', 'reopen', 'repo', 'restart', 'resume', 'rules', 'settings', 'steer', 'try-it', 'usage-resume', 'queue-message', 'cancel-waiting', 'send-waiting', 'stop-then-send'].sort());
  assert.ok(Object.isFrozen(REMOTE_COMMANDS) && Object.isFrozen(LOCAL_COMMANDS));
  assert.ok(Object.values(REMOTE_COMMANDS).every(Object.isFrozen));
  assert.throws(() => { REMOTE_COMMANDS.shell = {}; });
  assert.equal(REMOTE_COMMANDS.shell, undefined);
  assert.ok(Number.isInteger(PROTOCOL_VERSION) && PROTOCOL_VERSION >= 1);
  assert.deepEqual(Object.keys(GOOD).sort(), [...Object.keys(REMOTE_COMMANDS), ...Object.keys(LOCAL_COMMANDS)].sort(), 'every command is tested below');
});

test('every command on each list is accepted with good fields', () => {
  for (const [type, fields] of Object.entries(GOOD)) {
    const r = parseCommand({ type, ...fields }, { from: 'local' });
    assert.equal(r.ok, true, `${type}: ${r.error}`);
    assert.deepEqual(r.command, { type, ...fields });
    assert.ok(Object.isFrozen(r.command));
    if (Object.hasOwn(REMOTE_COMMANDS, type) && type !== 'start') assert.equal(parseCommand({ type, ...fields }, { from: 'site' }).ok, true, `${type} from the site`);
  }
  // Optional fields may be left out; a 20,000-character reply is fine.
  assert.equal(parseCommand({ type: 'reply', slug: 'x', text: 'y'.repeat(20000) }).ok, true);
  assert.equal(parseCommand({ type: 'usage-resume' }, { from: 'local' }).ok, true);
});

test('an unknown type, a local command from the site, an extra field and a wrong type are refused, in plain words', () => {
  const refused = (raw, from, pattern) => {
    const r = parseCommand(raw, { from });
    assert.equal(r.ok, false, JSON.stringify(raw));
    assert.equal(typeof r.error, 'string');
    if (pattern) assert.match(r.error, pattern);
    assert.equal(r.command, undefined);
  };
  // Unknown types, and things that aren't commands.
  refused({ type: 'shell', command: 'rm -rf /' }, 'local', /no command called “shell”/);
  refused({ type: 'push' }, 'site', /no command called/);
  refused({ type: 'toString' }, 'local', /no command called/);
  refused({ type: '__proto__' }, 'local', /no command called/);
  refused({}, 'site', /what it is/);
  refused(null, 'site', /named fields/);
  refused(['start'], 'site', /named fields/);
  refused('start', 'site', /named fields/);
  // Every local command is refused from the site (and the site is assumed when nothing is said).
  for (const type of Object.keys(LOCAL_COMMANDS)) refused({ type, ...GOOD[type] }, 'site', /only be done on this computer/);
  refused({ type: 'close', slug: 'sample-job' }, undefined, /only be done on this computer/);
  // A field the command doesn't take.
  refused({ type: 'pause', runId: 'run-1', cwd: '/' }, 'site', /doesn’t take “cwd”/);
  refused({ type: 'reply', slug: 'x', text: 'y', path: '/etc/passwd' }, 'site', /doesn’t take “path”/);
  refused({ type: 'approve', slug: 'x', command: 'git push --force' }, 'site', /doesn’t take “command”/);
  refused({ type: 'usage-resume', now: true }, 'local', /doesn’t take/);
  // A wrong type, a value too long, a required field missing.
  refused({ type: 'reply', slug: 'x', text: 42 }, 'site', /“text” of “reply” must be text/);
  refused({ type: 'reply', slug: 'x', text: 'y'.repeat(20001) }, 'site', /20,000/);
  refused({ type: 'approve', slug: 'x', briefNumber: '3' }, 'site', /brief number/);
  refused({ type: 'approve', slug: 'x', briefNumber: 0 }, 'site', /brief number/);
  refused({ type: 'approve', slug: 'x', note: 'n'.repeat(4001) }, 'site', /4,000/);
  refused({ type: 'allow', requestId: '../../etc' }, 'site', /an id/);
  refused({ type: 'allow', requestId: 'req-1', scope: 'forever' }, 'site', /“once” or “run”/);
  refused({ type: 'deny' }, 'site', /needs “requestId”/);
  refused({ type: 'take-over', slug: '../other-job' }, 'site', /job name/);
  refused({ type: 'take-over', slug: '' }, 'site', /job name/);
  refused({ type: 'fetch-diff', slug: 'x', commit: 'HEAD; rm -rf /' }, 'site', /commit id/);
  refused({ type: 'start', description: 'x', kind: 'chore' }, 'site', /“feature” or “bug”/);
  refused({ type: 'start', description: 'x', despiteLimit: 'yes' }, 'site', /true or false/);
  refused({ type: 'start' }, 'site', /needs “description”/);
  refused({ type: 'steer', runId: 'run-1', text: ['hi'] }, 'local', /must be text/);
  refused({ type: 'close', slug: 'x', as: 'deleted' }, 'local', /“done” or “dropped”/);
  refused({ type: 'rules', action: 'replace' }, 'local', /“add” or “remove”/);
});

test('the Auto switch (Auto mode): a job and on or off, both needed; the protocol moved to 4', () => {
  assert.equal(PROTOCOL_VERSION, 7);
  assert.equal(parseCommand({ type: 'auto', slug: 'sample-job', on: false }, { from: 'site' }).ok, true);
  assert.match(parseCommand({ type: 'auto', slug: 'sample-job' }, { from: 'site' }).error, /needs “on”/);
  assert.match(parseCommand({ type: 'auto', on: true }, { from: 'site' }).error, /needs “slug”/);
  assert.match(parseCommand({ type: 'auto', slug: 'sample-job', on: 'yes' }, { from: 'site' }).error, /true or false/);
  assert.match(parseCommand({ type: 'auto', slug: 'sample-job', on: true, by: 'tag' }, { from: 'site' }).error, /doesn’t take “by”/);
});

test('makeEvent: known types only; never a diff, patch, environment, token or source; an orbfb_ token hidden', () => {
  for (const type of ['status', 'brief', 'document', 'gate', 'permission', 'evidence', 'cost', 'branch', 'pr', 'lock', 'heartbeat', 'run', 'steer']) assert.ok(EVENT_TYPES.includes(type), type);
  assert.ok(Object.isFrozen(EVENT_TYPES));

  const ok = makeEvent('run', { id: 'run-1', status: 'running' }, { job: 'sample-job' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.event, { v: PROTOCOL_VERSION, type: 'run', job: 'sample-job', data: { id: 'run-1', status: 'running' } });

  const unknown = makeEvent('shell-output', { text: 'hi' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /no event called/);

  for (const key of NEVER_CARRIED) {
    const top = makeEvent('status', { [key]: 'x' });
    assert.equal(top.ok, false, key);
    assert.match(top.error, new RegExp(`never carries “${key}”`));
    const deep = makeEvent('gate', { card: { files: [{ name: 'a.js', [key]: 'x' }] } });
    assert.equal(deep.ok, false, `${key} deep inside`);
  }
  assert.deepEqual(NEVER_CARRIED, ['diff', 'patch', 'env', 'token', 'source']);

  const token = `orbfb_${'a'.repeat(43)}`;
  const hidden = makeEvent('thread', { why: 'send', text: `here it is: ${token}`, list: [`Bearer ${token}`] }, { job: 'sample-job' });
  assert.equal(hidden.ok, true);
  assert.ok(!JSON.stringify(hidden.event).includes('orbfb_'), JSON.stringify(hidden.event));
  assert.match(hidden.event.data.text, /\[Orbit token hidden\]/);
});

test('the hosted site’s events (packet 2A): hello and job-list, checked like every other', () => {
  assert.equal(PROTOCOL_VERSION, 7);
  for (const type of ['hello', 'job-list']) assert.ok(EVENT_TYPES.includes(type), type);
  const hello = makeEvent('hello', { name: 'Test Laptop', os: 'macOS', version: '0.1.0', protocol: PROTOCOL_VERSION });
  assert.equal(hello.ok, true);
  const list = makeEvent('job-list', { jobs: [{ slug: 'sample-job', title: 'Sample', ticket: 'ORBIT-479', stage: 'plan', state: 'needs-you', now: 'Waiting for your go-ahead', updatedAt: null }] });
  assert.equal(list.ok, true);
  assert.equal(makeEvent('job-list', { jobs: [{ slug: 'x', diff: '+ a line' }] }).ok, false, 'a job row never carries a diff');
  assert.equal(makeEvent('hello', { env: { HOME: '/x' } }).ok, false);
});

// The site stores an event only when it passes the same check again there (hosted/site/events.js):
// what makeEvent would make from it must be exactly what arrived.
test('every event the site stores passes the “never carries” check again on the site side, and is refused if not', async () => {
  const { checkStoredEvent } = await import('../../hosted/site/events.js');
  const made = makeEvent('status', { slug: 'sample-job', stage: 'build' }, { job: 'sample-job' }).event;
  assert.deepEqual(checkStoredEvent({ eid: 'e-1', ...made }), { ok: true, event: { eid: 'e-1', type: 'status', job: 'sample-job', data: made.data } });
  for (const key of NEVER_CARRIED) {
    const r = checkStoredEvent({ eid: 'e-2', v: PROTOCOL_VERSION, type: 'status', job: null, data: { deep: [{ [key]: 'x' }] } });
    assert.equal(r.ok, false, key);
    assert.match(r.error, new RegExp(`never carries “${key}”`));
  }
  const token = `orbfb_${'a'.repeat(43)}`;
  const leak = checkStoredEvent({ eid: 'e-3', v: PROTOCOL_VERSION, type: 'job-list', job: null, data: { jobs: [{ title: `paste ${token}` }] } });
  assert.equal(leak.ok, false, 'a token the runner failed to scrub is refused, not scrubbed and kept');
  assert.equal(checkStoredEvent({ eid: 'e-4', v: PROTOCOL_VERSION, type: 'shell-output', job: null, data: {} }).ok, false);
  assert.equal(checkStoredEvent({ eid: 'not ok!', v: PROTOCOL_VERSION, type: 'status', job: null, data: {} }).ok, false);
  assert.equal(checkStoredEvent({ eid: 'e-5', v: PROTOCOL_VERSION, type: 'status', job: '../etc', data: {} }).ok, false);
  assert.equal(checkStoredEvent({ eid: 'e-6', v: PROTOCOL_VERSION, type: 'status', job: null, data: [] }).ok, false);
});

// ---------- A start from the site carries the choices of the New job form ----------

const site = (fields) => parseCommand({ type: 'start', description: 'ORBIT-12: Tidy the export button', ...fields }, { from: 'site' });

test('a start carries its choices', () => {
  const r = site({ kind: 'bug', repo: 'orbit', model: 'claude-fable-5-2', options: { level: 1, stack: true, all_fable: true }, ticket: { key: 'ORBIT-12' } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.command, { type: 'start', description: 'ORBIT-12: Tidy the export button', kind: 'bug', repo: 'orbit', model: 'claude-fable-5-2', options: { level: 1, stack: true, all_fable: true }, ticket: { key: 'ORBIT-12' } });
  assert.equal(site({ options: { level: 0 } }).command.options.level, 0);
});

test('a start with an unknown model, level 4, or a repo path is refused', () => {
  assert.equal(site({ model: 'claude-made-up' }).ok, false);
  assert.equal(site({ options: { level: 4 } }).ok, false);
  assert.equal(site({ options: { level: '2' } }).ok, false);
  assert.equal(site({ options: { stack: false } }).ok, false);
  assert.equal(site({ options: 'level 1' }).ok, false);
  assert.equal(site({ repo: '/Users/someone/Projects/orbit' }).ok, false);
  assert.equal(site({ repo: '..\\orbit' }).ok, false);
  assert.equal(site({ repo: '' }).ok, false);
  assert.equal(site({ repoPath: '/Users/someone/Projects/orbit' }).ok, false, 'a site never names a folder');
  assert.equal(site({ kind: 'chore' }).ok, false);
});

test('a start from the site drops options it has no name for, and `auto`, and a past conversation', () => {
  const r = site({ options: { level: 2, auto: true, evidence: 'always', models: { foreman: 'x' }, __proto__: { polluted: true } }, fromSession: { id: 'x', mode: 'continue' } });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.command.options, { level: 2 });
  assert.equal(Object.hasOwn(r.command, 'fromSession'), false);
  assert.ok(Object.isFrozen(r.command.options));
  assert.deepEqual(site({ options: { auto: true } }).command.options, {});
});

test('this computer’s own start still takes a folder and any options', () => {
  const r = parseCommand({ type: 'start', description: 'Add a tidy button', repoPath: '/tmp/repo', options: { auto: true, wireframes: 'skip' } }, { from: 'local' });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.command.options, { auto: true, wireframes: 'skip' });
});

test('a start from the site cannot go past the Claude limit warning, and its ticket has a size cap; the laptop’s own page can and is not capped', () => {
  const fromSite = site({ despiteLimit: true });
  assert.equal(fromSite.ok, true, fromSite.error);
  assert.equal('despiteLimit' in fromSite.command, false);
  const big = { key: 'ORBIT-12', title: 'x'.repeat(4000) };
  const refused = site({ ticket: big });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /ticket/);
  assert.equal(site({ ticket: { key: 'ORBIT-12', title: 'x'.repeat(300), url: `https://orbit.example/${'u'.repeat(1000)}` } }).ok, true);
  const own = (fields) => parseCommand({ type: 'start', description: 'ORBIT-12: Tidy the export button', ...fields }, { from: 'local' });
  assert.equal(own({ despiteLimit: true }).command.despiteLimit, true);
  assert.equal(own({ ticket: big }).ok, true);
});

test('the Auto start setting from the site: on a boolean, tag text of at most 60 after trim, nothing else', () => {
  const ok = (c) => parseCommand({ type: 'auto-start', ...c }, { from: 'site' });
  assert.equal(ok({ on: true, tag: 'auto' }).ok, true);
  assert.equal(ok({ on: false, tag: '' }).ok, true);
  assert.equal(ok({ on: true, tag: ` ${'x'.repeat(60)} ` }).ok, true);
  assert.equal(ok({ on: true, tag: 'x'.repeat(61) }).ok, false);
  assert.equal(ok({ on: 'yes', tag: 'auto' }).ok, false);
  assert.equal(ok({ on: true, tag: 7 }).ok, false);
  assert.match(ok({ on: true }).error, /needs “tag”/);
  assert.match(ok({ tag: 'a' }).error, /needs “on”/);
  assert.equal(ok({ on: true, tag: 'a', slug: 'x' }).ok, false, 'no other field');
  assert.equal(parseCommand({ type: 'auto-start', on: true, tag: 'a' }, { from: 'local' }).ok, true);
  assert.equal(Object.hasOwn(LOCAL_COMMANDS, 'auto-start'), false);
});

test('the auto-start command takes an optional max of 1 to 10', () => {
  const ok = (c) => parseCommand({ type: 'auto-start', on: true, tag: 'auto', ...c }, { from: 'site' });
  assert.equal(ok({}).ok, true, 'max may be left out');
  for (const max of [1, 5, 10]) {
    const r = ok({ max });
    assert.equal(r.ok, true, String(max));
    assert.equal(r.command.max, max);
  }
  for (const max of [0, 11, 2.5, '3', null, -1, true]) assert.equal(ok({ max }).ok, false, String(max));
});

test('a start may carry a name of at most 60 characters; the name command is this computer\'s only and needs a ticket', () => {
  assert.equal(parseCommand({ type: 'start', description: 'Add a tidy button', name: 'x'.repeat(60) }, { from: 'local' }).ok, true);
  assert.match(parseCommand({ type: 'start', description: 'Add a tidy button', name: 'x'.repeat(61) }, { from: 'local' }).error, /“name” of “start” must be text of at most 60 characters/);
  assert.match(parseCommand({ type: 'start', description: 'Add a tidy button', name: 7 }, { from: 'local' }).error, /“name” of “start” must be text/);
  assert.match(parseCommand({ type: 'name', repoPath: '/tmp/repo' }, { from: 'local' }).error, /“name” needs “ticket”/);
  assert.match(parseCommand({ type: 'name', ticket: { key: 'ORBIT-1' }, avoid: 'a-b' }, { from: 'local' }).error, /“avoid” of “name” must be a list/);
  assert.match(parseCommand({ type: 'name', ticket: { key: 'ORBIT-1' } }, { from: 'site' }).error, /only be done on this computer/);
});
