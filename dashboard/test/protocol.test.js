// The protocol between the runner and the site (lib/protocol.js): two closed command lists, the
// check every command goes through, and the events a runner sends up.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPES, LOCAL_COMMANDS, NEVER_CARRIED, PROTOCOL_VERSION, REMOTE_COMMANDS, makeEvent, parseCommand } from '../lib/protocol.js';

// One good command of every type, with every field it takes filled in.
const GOOD = {
  start: { description: 'Add a tidy button', repoPath: '/tmp/repo', options: { level: 1 }, model: 'claude-opus-5-5', kind: 'feature', ticket: { key: 'ORBIT-479' }, fromSession: null, despiteLimit: false },
  reply: { slug: 'sample-job', via: 'box', text: 'Carry on, please.', kind: 'message', gateBrief: 2, model: null, despiteLimit: false, confirmNoTerminal: true },
  approve: { slug: 'sample-job', briefNumber: 3, note: 'Looks right.', answers: { q1: { choice: 'A' } }, verdicts: {}, chips: [], text: 'Approved.', startAfterReset: false },
  'send-back': { slug: 'sample-job', briefNumber: 3, note: 'Change the title.', chips: [{ kind: 'skip', stage: 'wireframes' }] },
  stop: { slug: 'sample-job', briefNumber: null, note: '' },
  allow: { requestId: '0b8f6c1e-2d1a-4f5e-9b3a-7c2d1e0f9a8b', note: 'ok', answers: { 'Which one?': 'A' }, scope: 'run' },
  deny: { requestId: 'req-1', note: 'Not that file.' },
  pause: { runId: 'run-1' },
  'take-over': { slug: 'sample-job' },
  'fetch-diff': { slug: 'sample-job', commit: 'abc1234' },
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
  'usage-resume': {},
};

test('the two lists are exactly the plan’s, closed and frozen', () => {
  assert.deepEqual(Object.keys(REMOTE_COMMANDS).sort(), ['allow', 'approve', 'deny', 'fetch-diff', 'pause', 'reply', 'send-back', 'start', 'stop', 'take-over']);
  assert.deepEqual(Object.keys(LOCAL_COMMANDS).sort(), ['close', 'notes', 'nudge', 'options', 'policy', 'reopen', 'repo', 'resume', 'rules', 'settings', 'steer', 'try-it', 'usage-resume']);
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
    if (Object.hasOwn(REMOTE_COMMANDS, type)) assert.equal(parseCommand({ type, ...fields }, { from: 'site' }).ok, true, `${type} from the site`);
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
  assert.equal(PROTOCOL_VERSION, 2);
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
