// Packet 2B, the laptop's half of the full mirror: what each part looks like on the wire
// (runner/mirror.js), what a decision is made on (lib/made-on.js), and the sealed live answer
// (lib/sealed.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fit, fromWire, jobRecord, permissionCard, RECORD_MAX, wireSafe } from '../runner/mirror.js';
import { gateMark, madeOnFor, stillMadeOn } from '../lib/made-on.js';
import { answerKeys, open, seal } from '../lib/sealed.js';
import { makeEvent } from '../lib/protocol.js';

test('wireSafe: no never-carried key at any depth; a short label under source travels and comes back', () => {
  const v = wireSafe({ cost: { source: 'estimate' }, deep: [{ diff: '+x', env: { A: 1 }, token: 't', patch: 'p', source: 'line one\nline two' }] });
  assert.deepEqual(v, { cost: { sourceTag: 'estimate' }, deep: [{}] });
  assert.equal(makeEvent('record', { kind: 'job', key: 'x', value: v }).ok, true);
  assert.deepEqual(fromWire(v), { cost: { source: 'estimate' }, deep: [{}] });
});

test('a job page goes up without the Foreman’s replies, the audit, a reply’s words or a file’s content', () => {
  const r = jobRecord({
    slug: 'x', audit: [{ text: 'a' }], lastReply: { html: 'b' }, locate: { source: 'status.json' },
    run: { id: 'r', status: 'running', text: 'streaming', lastText: 'more', resultText: 'done' },
    thread: [{ id: 'reply:1', kind: 'reply', html: '<pre>code</pre>' }, { id: 'blocked:1', kind: 'blocked', by: 'hard-line', text: 'Refused', preview: 'rm -rf /' }],
    permissionsPending: [{ id: 'p', kind: 'permission', toolName: 'Edit', input: { file_path: 'a.js', old_string: 'a', new_string: 'b' }, plain: { headline: 'Edit a.js', preview: '- a\n+ b' } }],
  });
  const text = JSON.stringify(r);
  for (const gone of ['streaming', 'resultText', '<pre>code</pre>', 'rm -rf', 'old_string', '- a\\n+ b', '"audit"', 'lastReply', 'locate']) assert.ok(!text.includes(gone), gone);
  assert.equal(r.thread[0].kind, 'note');
  assert.equal(r.run.status, 'running');
  assert.deepEqual(r.permissionsPending[0].input, { file_path: 'a.js' });
});

test('a permission card: the command for a shell step, the questions for a question, nothing of a file', () => {
  assert.equal(permissionCard({ id: 'a', toolName: 'Bash', input: { command: 'npm test' }, plain: { headline: 'Run', preview: 'npm test' } }).plain.preview, 'npm test');
  assert.deepEqual(permissionCard({ id: 'b', kind: 'question', toolName: 'AskUserQuestion', input: { questions: [{ question: 'Which?' }] } }).input, { questions: [{ question: 'Which?' }] });
  const w = permissionCard({ id: 'c', toolName: 'Write', input: { file_path: 'a.js', content: 'x' }, plain: { headline: 'Write a.js', preview: 'x', previewHtml: '<p>x</p>' }, draft: { rule: 'Write(a.js)' } });
  assert.equal(w.plain.preview, null);
  assert.equal(w.draft, null);
  assert.ok(!JSON.stringify(w).includes('previewHtml'));
});

test('fit: a part too big is cut, or says it is too big', () => {
  const doc = fit('doc', { file: 'a.md', html: 'x'.repeat(RECORD_MAX), text: 'y'.repeat(1000) });
  assert.equal(doc.html, null);
  assert.equal(doc.cut, true);
  const job = fit('job', { slug: 'x', thread: Array.from({ length: 400 }, (_, i) => ({ id: `n${i}`, kind: 'note', text: 'z'.repeat(1000) })) });
  assert.ok(Buffer.byteLength(JSON.stringify(job)) <= RECORD_MAX);
  assert.equal(job.threadMore, true);
  assert.equal(fit('board', { blob: 'q'.repeat(RECORD_MAX + 10) }).tooBig, true);
});

test('made on: a gate’s mark catches another brief, another stage or new versions; a permission must still wait', () => {
  const g = { briefNumber: 2, briefFile: 'briefs/002-plan.md', stage: 'plan', raisedVersions: { plan: '2' } };
  const job = { slug: 'x', stage: 'plan', gate: g };
  const m = madeOnFor({ type: 'approve', slug: 'x', briefNumber: 2 }, { job });
  assert.deepEqual(m, { kind: 'gate', slug: 'x', brief: 2, mark: gateMark(g) });
  assert.equal(stillMadeOn(m, { job }).ok, true);
  assert.match(stillMadeOn(m, { job: { ...job, gate: { ...g, briefNumber: 3 } } }).why, /moved on to brief 3/);
  assert.match(stillMadeOn(m, { job: { ...job, gate: { ...g, raisedVersions: { plan: '3' } } } }).why, /brief changed/);
  assert.equal(stillMadeOn(m, { job: { ...job, gate: null } }).ok, false);
  // Kept in Postgres (jsonb reorders keys), the mark is the same.
  const reordered = { ...g, raisedVersions: { spec: '1', artifacts: { b: '1', a: '2' } } };
  assert.equal(gateMark(reordered), gateMark({ ...g, raisedVersions: { artifacts: { a: '2', b: '1' }, spec: '1' } }));
  assert.throws(() => madeOnFor({ type: 'approve', slug: 'x' }, { job: { ...job, gate: null } }), /isn’t waiting/);
  assert.deepEqual(madeOnFor({ type: 'reply', slug: 'x', via: 'box', text: 'hi' }, { job }), { kind: 'job', slug: 'x', stage: 'plan' });
  const p = madeOnFor({ type: 'allow', requestId: 'p1' }, { permissions: [{ id: 'p1', slug: 'x' }] });
  assert.equal(stillMadeOn(p, { permissions: [{ id: 'p1' }] }).ok, true);
  assert.match(stillMadeOn(p, { permissions: [] }).why, /already answered/);
  assert.throws(() => madeOnFor({ type: 'deny', requestId: 'p2' }, { permissions: [] }), /already answered/);
});

test('a sealed answer opens only with the asking request’s key', () => {
  const k = answerKeys();
  const sealed = seal(k.publicKey, { diff: '+ a line' });
  assert.ok(!JSON.stringify(sealed).includes('a line'));
  assert.deepEqual(open(k.privateKey, sealed), { diff: '+ a line' });
  assert.throws(() => open(answerKeys().privateKey, sealed));
});
