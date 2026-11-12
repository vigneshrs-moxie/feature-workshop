// Packet 2B, the laptop's half of the full mirror: what each part looks like on the wire
// (runner/mirror.js), what a decision is made on (lib/made-on.js), and the sealed live answer
// (lib/sealed.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoLogRecord, fit, fromWire, jobRecord, permissionCard, RECORD_MAX, wireSafe } from '../runner/mirror.js';
import { AUTO_LOG_LIMITS } from '../lib/auto-log.js';
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

test('a job’s published link and revision go up with its page, and pass the never-carried check', () => {
  const r = jobRecord({ slug: 'x', prototype: { url: 'https://prototypes.example.test/f/x', revision: 4, publishedAt: null } });
  assert.deepEqual(r.prototype, { url: 'https://prototypes.example.test/f/x', revision: 4, publishedAt: null });
  assert.equal(makeEvent('record', { kind: 'job', key: 'x', value: r }).ok, true);
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

test('a long Auto list is cut on the laptop to the site’s limits, so it is never too big to send', () => {
  const long = 'w'.repeat(5000);
  const entries = Array.from({ length: 500 }, (_, i) => ({ at: `2026-11-11T08:${String(i % 60).padStart(2, '0')}:00.000Z`, stage: 'Plan', chose: `Go ${i} ${long}`, asked: long, why: long, risk: long, answers: Array.from({ length: 30 }, () => ({ question: long, choice: long, reason: long })) }));
  const rec = autoLogRecord({ on: true, stopped: null, tag: null, summary: [long, long, long], entries });
  const sent = fit('auto-log', rec);
  assert.notEqual(sent.tooBig, true);
  assert.ok(Buffer.byteLength(JSON.stringify(sent)) < RECORD_MAX);
  const L = AUTO_LOG_LIMITS;
  assert.ok(sent.entries.length > 0 && sent.entries.length <= L.entries);
  assert.ok(sent.entries[0].chose.startsWith('Go 0 '), 'the newest entries are the ones kept');
  assert.ok(sent.entries.every((e) => e.chose.length <= L.text && e.asked.length <= L.text && e.why.length <= L.text && e.risk.length <= L.text && e.answers.length <= L.answers && e.answers.every((a) => a.question.length <= L.text && a.choice.length <= L.text && a.reason.length <= L.text)));
  assert.ok(sent.summary.every((x) => x.length <= L.line));
  // A short list goes as it is.
  const small = { on: true, stopped: null, tag: null, summary: ['a', 'b', 'c'], entries: [{ at: 'x', stage: 'Plan', chose: 'c', asked: 'a', why: 'w' }] };
  assert.deepEqual(autoLogRecord(small), small);
});

test('the job record carries page', () => {
  const page = {
    ticket: { key: 'ORBIT-479', title: 'Feedback API', url: 'https://orbit.example.com/t/479', filedBy: 'Pat Reporter', filedAt: '2026-10-01T09:00:00.000Z', description: 'Read tickets and never write.' },
    building: { from: 'spec', version: '0.3', outcome: ['Managers add notes.'], risks: ['Techs could see them.'] },
    check: { version: '2', worksWhen: ['A manager can add a note.'], mustNot: ['Show notes to techs.'] },
  };
  const r = jobRecord({ slug: 'x', page });
  assert.deepEqual(r.page, page);
  assert.equal(makeEvent('record', { kind: 'job', key: 'x', value: r }).ok, true);
  assert.deepEqual(jobRecord({ slug: 'y', page: { ticket: null, building: null, check: null } }).page, { ticket: null, building: null, check: null });
});

test('a command’s output never goes up', () => {
  const entry = { who: 'feature-tester', state: 'running', doing: 'Run the tests', recent: [{ text: 'Run the tests', at: 'T1' }], lastCommand: { command: 'npm test', at: 'T1', tail: 'secret' } };
  const r = jobRecord({ slug: 'x', thread: [], activity: [entry, { who: 'conductor', lastCommand: null }], costDetail: { totalUsd: 1, activity: [entry] } });
  assert.equal(JSON.stringify(r).includes('secret'), false);
  assert.deepEqual(r.activity[0].lastCommand, { command: 'npm test', at: 'T1', tail: null }, 'the command itself and when it ran go up');
  assert.deepEqual(r.activity[0].recent, entry.recent, 'the feed goes up');
  assert.equal(r.activity[1].lastCommand, null);
  assert.equal('lastCommand' in r.costDetail.activity[0], false, 'the cost part carries no command (fix round 1)');
  assert.equal(entry.lastCommand.tail, 'secret', 'the laptop’s own copy is untouched');
  assert.equal(makeEvent('record', { kind: 'job', key: 'x', value: r }).ok, true);
});

// ---------- Fix round 1: a command line's secrets never go up, and the feed goes up once ----------

// What the mirror sends for one crew member whose last command (and its feed line) is `command`.
const sentFor = (command) => {
  const entry = { who: 'feature-tester', state: 'running', doing: 'Run the checks', recent: [{ text: `Running ${command}`, at: 'T1' }], lastCommand: { command, at: 'T1', tail: null } };
  const record = jobRecord({ slug: 'x', thread: [], activity: [entry], costDetail: { totalUsd: 1, activity: [entry] } });
  const made = makeEvent('record', { kind: 'job', key: 'x', value: record });
  assert.equal(made.ok, true);
  return { record, wire: JSON.stringify(made.event.data), mirror: JSON.stringify(record) };
};

const SECRET_COMMANDS = [
  ['an Authorization header (Bearer)', 'curl -H "Authorization: Bearer abc123def456ghi789" https://api.example.com/x', 'abc123def456ghi789'],
  ['an Authorization header (Basic)', "curl -H 'Authorization: Basic dXNlcjpwYXNzd29yZA==' https://api.example.com", 'dXNlcjpwYXNzd29yZA'],
  ['an Authorization header (token)', 'curl -H "Authorization: token q1w2e3r4t5y6u7i8" https://api.example.com', 'q1w2e3r4t5y6u7i8'],
  ['curl -u user:pass', 'curl -u admin:hunter2pass https://api.example.com', 'hunter2pass'],
  ['curl --user user:pass', 'curl --user admin:hunter2pass https://api.example.com', 'hunter2pass'],
  ['a name and password in an https address', 'git clone https://me:s3cretpass@github.com/me/app.git', 's3cretpass'],
  ['a name and password in a postgres address', 'psql postgres://app:dbpass99@db.internal:5432/app', 'dbpass99'],
  ['--password with a space', 'mysql --password Sup3rSecret -h db app', 'Sup3rSecret'],
  ['--password=', 'mysqldump --password=Sup3rSecret app', 'Sup3rSecret'],
  ['-pSECRET (mysql)', 'mysql -u root -pSup3rSecret app', 'Sup3rSecret'],
  ['--token', 'deploy --token tk_9f8e7d6c5b4a app', 'tk_9f8e7d6c5b4a'],
  ['--api-key', 'tool --api-key=key-1234567890abcd run', 'key-1234567890abcd'],
  ['--secret', 'tool --secret "moon base 42" run', 'moon base 42'],
  ['an AWS access key', 'aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
  ['an AWS session key', 'export AWS_ID=ASIAIOSFODNN7EXAMPLE', 'ASIAIOSFODNN7EXAMPLE'],
  ['aws_secret_access_key=', 'aws_secret_access_key=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY aws s3 ls', 'wJalrXUtnFEMIK7MDENG'],
  ['a Slack token', 'curl -d token=xoxb-123456789012-abcdefABCDEF https://slack.com/api/chat.postMessage', 'xoxb-123456789012'],
  ['a Stripe live key', 'stripe charges list --api-base x sk_' + 'live_4eC39HqLyjWDarjtT1zdp7dc', 'sk_' + 'live_4eC39HqLyjWDarjtT1zdp7dc'],
  ['a Stripe restricted key', 'echo rk_' + 'live_4eC39HqLyjWDarjtT1zdp7dc', 'rk_' + 'live_4eC39HqLyjWDarjtT1zdp7dc'],
  ['a Stripe test key', 'echo sk_' + 'test_4eC39HqLyjWDarjtT1zdp7dc', 'sk_' + 'test_4eC39HqLyjWDarjtT1zdp7dc'],
  ...['ghp', 'gho', 'ghu', 'ghs', 'ghr'].map((p) => [`a GitHub token (${p}_)`, `gh auth login --with-token ${p}_${'A1b2'.repeat(9)}`, `${p}_A1b2`]),
  ['a GitHub fine-grained token', `echo github_pat_${'11ABCDEFG0'.repeat(4)}`, 'github_pat_11ABCDEFG0'],
  ['an Anthropic key', `curl -H "x-api-key: sk-ant-api03-${'a1B2'.repeat(10)}" https://api.anthropic.com`, 'sk-ant-api03'],
  ['an OpenAI key', `echo sk-proj-${'Z9y8X7w6'.repeat(5)}`, 'Z9y8X7w6Z9y8'],
  ['a JWT', 'curl -H "x-session: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U" https://x', 'dozjgNryP4J3jVmNHl0w5N'],
  ['a private key', "printf '-----BEGIN OPENSSH PRIVATE KEY-----\\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\\n-----END OPENSSH PRIVATE KEY-----' > id", 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmU'],
];
for (const [what, command, secret] of SECRET_COMMANDS) {
  test(`a command line’s secret never goes up: ${what}`, () => {
    const { record, wire, mirror } = sentFor(command);
    assert.equal(mirror.includes(secret), false, `the mirror’s record: ${record.activity[0].lastCommand.command}`);
    assert.equal(wire.includes(secret), false, 'what the event carries');
    assert.match(record.activity[0].lastCommand.command, /hidden\]/);
  });
}

test('ordinary commands go up as they are', () => {
  for (const command of ['git commit -m "fix -p flag"', 'npm test -- -p 3', 'psql -p 5432', 'ssh -p 22 host', 'mkdir -p a/b', 'git push -u origin feature/job-page', 'curl http://localhost:4477/api/x', 'git clone git@github.com:me/app.git', 'node --test dashboard/test/parsers.test.js']) {
    const { record } = sentFor(command);
    assert.equal(record.activity[0].lastCommand.command, command);
    assert.equal(record.activity[0].recent[0].text, `Running ${command}`);
  }
});

test('the feed and the command go up once: the cost part has none of them', () => {
  const { record, mirror } = sentFor('npm test');
  assert.equal(mirror.split('Running npm test').length - 1, 1, 'the feed line once');
  assert.deepEqual(record.activity[0].recent, [{ text: 'Running npm test', at: 'T1' }]);
  const cost = record.costDetail.activity[0];
  assert.equal('recent' in cost, false);
  assert.equal('lastCommand' in cost, false);
  assert.equal(cost.doing, 'Run the checks', 'the rest of the entry still goes up');
});
