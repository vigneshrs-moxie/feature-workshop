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
  for (const gone of ['streaming', 'resultText', '<pre>code</pre>', 'rm -rf', 'old_string', '- a\\n+ b', '"audit"', 'lastReply', 'status.json']) assert.ok(!text.includes(gone), gone);
  // Final fixes C1: locate goes up only as its branch facts (see the guessed-branch test below).
  assert.deepEqual(r.locate, { branch: null, branchSource: null, branchGuessed: false });
  assert.equal(r.thread[0].kind, 'note');
  assert.equal(r.run.status, 'running');
  assert.deepEqual(r.permissionsPending[0].input, { file_path: 'a.js' });
});

// ---------- Final fixes C1: the website learns that a branch is only a guess ----------

test('a guessed branch goes up as a guess, with no path of the laptop’s', () => {
  // A guessed job's detail as runner/index.js jobDetail builds it: the card's repo carries the flag,
  // and locate is lib/locate.js locateJob's whole answer.
  const detail = {
    slug: 'add-export', title: 'Add export', thread: [],
    repo: { name: 'app', branch: 'feature/someone-elses', branchGuessed: true },
    branch: 'feature/someone-elses',
    locate: {
      path: '/Users/someone/Projects/app', source: 'status.json', branch: 'feature/someone-elses', branchSource: 'git branch in app',
      branchGuessed: true, branchExists: true, worktree: '/Users/someone/Projects/app-wt', checkoutBranch: 'main',
      tried: ['/Users/someone/Projects/app', '/Users/someone/Projects/other'],
    },
  };
  const r = jobRecord(detail);
  assert.deepEqual(r.locate, { branch: 'feature/someone-elses', branchSource: 'git branch in app', branchGuessed: true });
  assert.equal(r.repo.branchGuessed, true, 'the job card in the record carries the flag too');
  const text = JSON.stringify(r);
  for (const gone of ['/Users/someone', 'app-wt', '"tried"', '"worktree"', '"path"', 'checkoutBranch', 'branchExists']) assert.ok(!text.includes(gone), gone);
  assert.equal(makeEvent('record', { kind: 'job', key: 'add-export', value: r }).ok, true);
  // A job with no locate: null.
  assert.equal(jobRecord({ slug: 'y', thread: [] }).locate, null);
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

// ---------- Final fixes C2: a big job never drops off the website ----------

const bytes = (v) => Buffer.byteLength(JSON.stringify(v));
const atOf = (i) => `2026-11-1${i % 10}T09:${String(i % 60).padStart(2, '0')}:00.000Z`;
const wordsOf = (n, w) => `${w} `.repeat(Math.ceil(n / (w.length + 1))).slice(0, n);
const BIG_GATE = gateOf();
function gateOf() {
  return {
    briefNumber: 40, briefFile: 'briefs/040-review.md', headline: 'Review round 4 done', stage: 'review', nextStage: 'ship', stale: false,
    questions: Array.from({ length: 5 }, (_, i) => ({ id: `Q${i}`, text: wordsOf(300, 'question') })), decided: [{ id: 'D1', text: wordsOf(200, 'decided') }], raisedVersions: { review: '4' },
  };
}
/** A long job's record as jobRecord makes it: 120 crew entries (4 running), 150 findings, 40 briefs and 40 Auto lines; `rest` stands for the rest of its record. */
function bigJobRecord(rest = 0) {
  return jobRecord({
    slug: 'big', title: 'Big', stage: 'review', gate: BIG_GATE,
    heldReply: { kind: 'approve', gateBrief: 40, at: atOf(1) },
    answeredBriefs: Array.from({ length: 39 }, (_, i) => i + 1),
    permissionsPending: [{ id: 'p1', slug: 'big', kind: 'permission', toolName: 'Bash', input: { command: 'npm test' }, plain: { headline: 'Run a command', preview: 'npm test' } }],
    thread: Array.from({ length: 5 }, (_, i) => ({ id: `you:${i}`, kind: 'you', at: atOf(i), text: 'Looks good' })),
    briefs: Array.from({ length: 40 }, (_, i) => ({ number: i + 1, file: `briefs/${String(i + 1).padStart(3, '0')}-review.md`, stage: 'review', headline: wordsOf(120, 'brief'), at: atOf(i) })),
    activity: Array.from({ length: 120 }, (_, i) => ({
      who: 'feature-reviewer', state: i < 4 ? 'running' : 'done', doing: 'Review the branch', startedAt: atOf(i),
      recent: Array.from({ length: 6 }, (_, k) => ({ text: wordsOf(110, `line${k}`), at: atOf(i) })), lastCommand: { command: wordsOf(240, 'npm'), at: atOf(i), tail: null },
    })),
    page: {
      ticket: null, building: null, check: null,
      docs: {
        review: Array.from({ length: 40 }, (_, i) => ({ file: `review/round-${i}.md`, name: wordsOf(80, 'Review'), group: 'review', updatedAt: atOf(i) })),
        plan: Array.from({ length: 40 }, (_, i) => ({ file: `briefs/${String(i + 1).padStart(3, '0')}-review.md`, name: wordsOf(80, 'Brief'), group: 'briefs', updatedAt: atOf(i) })),
      },
      review: { at: atOf(1), rows: Array.from({ length: 150 }, (_, i) => ({ lens: 'tests', severity: 'minor', text: wordsOf(400, `finding${i}`), status: 'open' })) },
    },
    auto: { on: true, decided: Array.from({ length: 40 }, (_, i) => wordsOf(700, `decided${i}`)) },
    history: [{ at: atOf(0), text: 'h'.repeat(rest) }],
  });
}
// Each shed by hand, in the order fit makes them (fix round 1: the steps' documents last). The big job's
// findings are all open, so a cut keeps the first 30.
const withoutFeed = (r) => ({ ...r, activity: r.activity.map((a) => (a.state === 'running' ? a : (({ recent, lastCommand, ...x }) => x)(a))) });
const rowsCut = (r) => ({ ...r, page: { ...r.page, review: { ...r.page.review, rows: r.page.review.rows.slice(0, 30), cut: true, total: r.page.review.rows.length } } });
const decidedCut = (r) => ({ ...r, auto: { ...r.auto, decided: r.auto.decided.slice(-20) } });
const withoutDocs = (r) => ({ ...r, page: { ...r.page, docs: null } });
const allShed = (r) => withoutDocs(decidedCut(rowsCut(withoutFeed(r))));

test('a big job still fits: it sheds in order, only as far as it must, and never the gate or the three calls’ data', () => {
  // The rest of the record brings it within 2 KB of the limit once all four are shed, so all four are needed.
  const rest = RECORD_MAX - bytes(allShed(bigJobRecord(0))) - 2048;
  const record = bigJobRecord(rest);
  assert.ok(bytes(record) > RECORD_MAX);
  assert.ok(bytes(decidedCut(rowsCut(withoutFeed(record)))) > RECORD_MAX, 'the last shed is needed');
  const sent = fit('job', record);
  assert.notEqual(sent.tooBig, true);
  assert.ok(bytes(sent) <= RECORD_MAX);
  assert.deepEqual(sent, { ...allShed(record), latestBrief: null }, 'what was shed is what the order says, and nothing else');
  // What was shed, one by one.
  assert.ok(sent.activity.slice(0, 4).every((a) => a.recent.length === 6 && a.lastCommand.command), 'a running entry keeps its feed and command');
  assert.ok(sent.activity.slice(4).every((a) => !('recent' in a) && !('lastCommand' in a)));
  assert.equal(sent.page.review.rows.length, 30);
  assert.equal(sent.page.review.cut, true);
  assert.equal(sent.page.review.total, 150);
  assert.deepEqual(sent.auto.decided, record.auto.decided.slice(20), 'the newest 20 kept');
  assert.equal(sent.page.docs, null, 'the steps’ documents go last');
  // Never shed.
  assert.deepEqual(sent.gate, record.gate);
  assert.deepEqual(sent.heldReply, record.heldReply);
  assert.deepEqual(sent.answeredBriefs, record.answeredBriefs);
  assert.deepEqual(sent.permissionsPending, record.permissionsPending);
  assert.equal(sent.briefs.length, 40);
  assert.equal(makeEvent('record', { kind: 'job', key: 'big', value: sent }).ok, true);
});

test('a job a little too big sheds only the finished crew’s feed and keeps the rest', () => {
  const record = bigJobRecord(0);
  assert.ok(bytes(record) > RECORD_MAX && bytes(withoutFeed(record)) <= RECORD_MAX);
  const sent = fit('job', record);
  assert.deepEqual(sent, { ...withoutFeed(record), latestBrief: null });
  assert.equal(sent.page.review.rows.length, 150);
  assert.equal('cut' in sent.page.review, false);
  assert.equal(sent.auto.decided.length, 40);
  assert.ok(sent.page.docs.review.length === 40);
});

test('a small job’s record is byte for byte what it was', () => {
  const record = jobRecord({ slug: 'small', gate: BIG_GATE, thread: [], activity: [{ who: 'planner', state: 'done', recent: [{ text: 'a', at: 'T' }], lastCommand: { command: 'ls', at: 'T', tail: null } }], page: { docs: { plan: [] }, review: { at: null, rows: [] } }, auto: { on: true, decided: ['a'] } });
  assert.equal(JSON.stringify(fit('job', record)), JSON.stringify(record));
});

test('a cut review keeps its open findings and says how many there were', () => {
  // 150 findings: 40 fixed, then 20 open, then 90 not doing; the rest of the record makes the cut needed.
  const status = (i) => (i < 40 ? 'fixed' : i < 60 ? 'open' : 'not-doing');
  const rows = Array.from({ length: 150 }, (_, i) => ({ lens: 'tests', severity: 'minor', text: wordsOf(400, `finding${i}`), status: status(i) }));
  const docs = { review: [{ file: 'review.md', name: 'Review', group: 'review', updatedAt: atOf(1) }] };
  const record = jobRecord({ slug: 'cut', gate: BIG_GATE, thread: [], page: { docs, review: { at: atOf(1), rows } }, auto: { on: true, decided: ['a'] }, history: [{ at: atOf(0), text: 'h'.repeat(RECORD_MAX - 30_000) }] });
  assert.ok(bytes(record) > RECORD_MAX);
  const sent = fit('job', record);
  assert.ok(bytes(sent) <= RECORD_MAX);
  const kept = sent.page.review.rows;
  assert.equal(kept.length, 30);
  assert.deepEqual(kept.slice(0, 20).map((r) => r.text), rows.slice(40, 60).map((r) => r.text), 'every open finding, in file order');
  assert.deepEqual(kept.slice(20).map((r) => r.text), rows.slice(0, 10).map((r) => r.text), 'then the rest, in file order');
  assert.equal(sent.page.review.cut, true);
  assert.equal(sent.page.review.total, 150);
  assert.deepEqual(sent.page.docs, docs, 'it fit before the steps’ documents had to go');
  assert.deepEqual(sent.auto.decided, ['a']);
});

test('after page.docs is shed the step view has no docs list', async () => {
  const { stageView } = await import('../lib/stage-view.js');
  const record = bigJobRecord(RECORD_MAX - bytes(allShed(bigJobRecord(0))) - 2048);
  const sent = fromWire(fit('job', record));
  assert.equal(sent.page.docs, null);
  for (const stop of ['plan', 'review']) assert.equal('docs' in stageView(sent, stop), false, `${stop}: not known, not an empty list`);
  // A record that kept its documents: the step view lists them as before.
  const whole = fromWire(fit('job', bigJobRecord(0)));
  assert.deepEqual(stageView(whole, 'review').docs, whole.page.docs.review);
  assert.equal(stageView(whole, 'review').docs.length, 40);
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

// ---------- Fix round 3: the website's copy of a permission card is scrubbed before its cut ----------

test('a permission card goes up scrubbed first and cut second: a secret across the 4,000 cut is hidden', () => {
  const token = `ghp_${'Q7w8'.repeat(9)}`;
  const command = `${'x'.repeat(3989)} ${token} done`;
  const laptop = { id: 'p1', slug: 'x', kind: 'permission', toolName: 'Bash', input: { command }, plain: { headline: 'Run a command in the terminal', preview: `${command.slice(0, 4000)}…`, previewCut: 4000, risk: 'normal' } };
  const card = permissionCard(laptop);
  assert.equal(card.plain.preview.includes('ghp_'), false, card.plain.preview.slice(-40));
  assert.equal(card.plain.preview.includes('Q7w8'), false);
  assert.ok(card.plain.preview.length <= 4001);
  assert.equal(card.plain.previewCut, 4000);
  assert.equal(laptop.plain.preview.includes('ghp_Q7w8Q'), true, 'the laptop’s own card is untouched');
  const sent = makeEvent('record', { kind: 'board', key: 'board', value: { permissions: [card] } });
  assert.equal(JSON.stringify(sent.event.data).includes('Q7w8'), false);
  // A short command goes up whole (scrubbed), with no cut.
  const short = permissionCard({ ...laptop, input: { command: 'tool --password hunter2-long-value run' }, plain: { preview: 'tool --password hunter2-long-value run', previewCut: null } });
  assert.equal(short.plain.preview, 'tool --password [hidden] run');
  assert.equal(short.plain.previewCut, null);
});

test('the website’s Auto list keeps the start time, the ticket and each entry’s kind and step', async () => {
  const { autoLogRecord: autoListOf } = await import('../lib/auto-log.js');
  const lines = [
    { at: '2026-11-11T08:00:00.000Z', action: 'auto', what: 'on', by: 'tag' },
    { at: '2026-11-11T08:05:00.000Z', action: 'auto', what: 'gate', stage: 'plan', asked: 'Brief 1: go ahead?', chose: 'Approved', why: 'It matches the ticket.' },
    { at: '2026-11-11T08:09:00.000Z', action: 'auto', what: 'stop', stage: 'implement', rule: 'database', reason: 'A migration needs you.' },
  ];
  const sent = autoLogRecord(autoListOf(lines, { title: 'T', record: { on: true, by: 'tag', tag: 'auto-ok' }, ticket: 'ORBIT-479' }));
  assert.equal(sent.startedAt, '2026-11-11T08:00:00.000Z');
  assert.equal(sent.ticket, 'ORBIT-479');
  assert.deepEqual(sent.entries.map((e) => [e.kind, e.stop, e.chose]), [['stop', 'build', 'A migration needs you.'], ['approve', 'plan', 'Approved']]);
  assert.equal(makeEvent('record', { kind: 'auto-log', key: 'x', value: sent }).ok, true);
  // A list from an older laptop, with none of them, goes as it is.
  const old = { on: true, stopped: null, tag: null, summary: ['a', 'b', 'c'], entries: [{ at: 'x', stage: 'Plan', chose: 'c', asked: 'a', why: 'w' }] };
  assert.deepEqual(autoLogRecord(old), old);
});

// ---------- The Auto queue on the website (Auto queue, Task 18) ----------

const AUTO_QUEUE = {
  on: true, tag: 'auto-ok', max: 3, working: 1, unfinished: 2, ceiling: 10, paused: null, testing: 'add-export',
  tickets: [
    { key: 'ORBIT-12', title: 'Add export', group: 'working', slug: 'add-export', reason: null },
    { key: 'ORBIT-13', title: 'Split the report', group: 'too-big', slug: 'split-report', reason: 'The Foreman suggested a stack.' },
    { key: 'ORBIT-14', title: 'Fix login', group: 'next', slug: null, reason: null },
  ],
};
const AUTO_CARD = {
  slug: 'add-export', title: 'Add export',
  auto: { on: true, by: 'tag', ran: true, stopped: null, deciding: false, allowed: true, why: null, began: 'tag', group: 'working', waitingToTest: true, tooBig: null, risky: 2, finished: null },
};

test('the board carries autoQueue, and no database address', async () => {
  const { boardRecord } = await import('../runner/mirror.js');
  const failed = { key: 'ORBIT-15', title: 'Count the rows', group: 'failed', slug: null, reason: 'It did not start: postgres://127.0.0.1:5432/moxie_snapshot__auto refused the copy.' };
  const rec = boardRecord({ meta: null, jobs: [AUTO_CARD], autoQueue: { ...AUTO_QUEUE, tickets: [...AUTO_QUEUE.tickets, failed] } });
  assert.deepEqual(rec.autoQueue, { ...AUTO_QUEUE, tickets: [...AUTO_QUEUE.tickets, { ...failed, reason: 'It did not start: [database address hidden] refused the copy.' }] });
  assert.equal(rec.autoQueue.testing, 'add-export', 'the slug holding the test place goes up');
  assert.deepEqual(rec.jobs[0].auto, AUTO_CARD.auto, 'the card’s Auto fields ride in jobs as they are');
  assert.doesNotMatch(JSON.stringify(rec), /postgres(?:ql)?:\/\/|moxie_snapshot/);
  assert.equal(makeEvent('record', { kind: 'board', key: '', value: rec }).ok, true);
  // A snapshot with none (a runner that has no Auto queue) sends null: not known on the site.
  assert.equal(boardRecord({ jobs: [] }).autoQueue, null);
});

test('the Auto queue goes up scrubbed: a ticket’s title and reason lose a home-folder path, a database address and a token', async () => {
  const { boardRecord } = await import('../runner/mirror.js');
  const { homedir } = await import('node:os');
  const home = homedir();
  const reason = `git worktree add failed in ${home}/Projects/orbit-wt/orbit-16: could not reach postgresql://olive@localhost/moxie_snapshot. Token ghp_${'a'.repeat(36)}.`;
  const title = 'Read /Users/olive/notes/plan.md and /home/sam/x before jdbc:postgresql://db.local:5432/orbit';
  const rec = boardRecord({ jobs: [], autoQueue: { ...AUTO_QUEUE, tickets: [{ key: 'ORBIT-16', title, group: 'failed', slug: null, reason }] } });
  const t = rec.autoQueue.tickets[0];
  assert.equal(t.reason, 'git worktree add failed in [path hidden]: could not reach [database address hidden]. Token [GitHub token hidden].');
  assert.equal(t.title, 'Read [path hidden] and [path hidden] before [database address hidden]');
  const json = JSON.stringify(rec);
  assert.ok(!json.includes(home), 'no home folder');
  assert.doesNotMatch(json, /\/Users\/|\/home\/|postgres(?:ql)?:\/\/|moxie_snapshot|ghp_/);
  // The rest of the queue is as it was, and a reason with nothing to hide is unchanged.
  const plain = boardRecord({ jobs: [], autoQueue: AUTO_QUEUE }).autoQueue;
  assert.deepEqual(plain, AUTO_QUEUE);
});

test('the board says which protocol the laptop speaks (7: the site may send Auto start’s max)', async () => {
  const { boardRecord } = await import('../runner/mirror.js');
  const { PROTOCOL_VERSION } = await import('../lib/protocol.js');
  assert.equal(PROTOCOL_VERSION, 7);
  assert.equal(boardRecord({ jobs: [] }).protocol, 7);
});

test('a recording\'s notes never go to the website', async () => {
  const { evidenceRecord, docRecord } = await import('../runner/mirror.js');
  const { jsonHtml } = await import('../lib/docs.js');
  const note = 'Auto’s app asked for the database app and Starbase refused it: Auto only uses its own copy. A setting in app/.env.local (LEGACY_JDBC) may be what names it.';
  const criteria = [{ id: 'AC-1', title: 'One', status: 'passed', reason: null, spec: 'evidence/specs/AC-1.spec.mjs', screenshots: [], video: null }];
  const record = { version: 1, commit: 'abc1234def5', at: '2026-11-12T10:00:00Z', level: 2, criteria, notes: [note] };
  // The evidence list (evidence/<slug>): the record without its notes, the rest as it was.
  const ev = evidenceRecord({ evidence: record, commit: 'abc1234def5', wanted: true, why: 'L2', recording: false, problem: null, progress: null, watch: false, folder: '/x', folderUrl: 'file:///x/' });
  assert.equal('notes' in ev.evidence, false);
  assert.deepEqual(ev.evidence, { version: 1, commit: 'abc1234def5', at: '2026-11-12T10:00:00Z', level: 2, criteria });
  assert.equal(evidenceRecord({ evidence: null, commit: null }).evidence, null, 'no record: still none');
  // The Docs tab's copy of evidence.json (doc/<slug>\n<file>): neither its text nor its page carries them.
  const text = JSON.stringify(record, null, 2);
  const doc = docRecord({ file: 'evidence/evidence.json', name: 'Evidence', type: 'json', html: jsonHtml(text), text, updatedAt: '2026-11-12T10:00:00Z', size: text.length, vscode: null, summary: null });
  const sent = JSON.stringify(doc);
  for (const gone of ['LEGACY_JDBC', '.env.local', 'refused it', '"notes"', '&quot;notes&quot;']) assert.ok(!sent.includes(gone), gone);
  assert.deepEqual(JSON.parse(doc.text), { version: 1, commit: 'abc1234def5', at: '2026-11-12T10:00:00Z', level: 2, criteria });
  assert.equal(doc.html, jsonHtml(doc.text));
  // Any other document goes up as it was.
  const other = { file: 'notes.md', name: 'Notes', type: 'md', html: '<p>notes</p>', text: 'notes', updatedAt: 'x', size: 5, vscode: null, summary: null };
  assert.deepEqual(docRecord(other), other);
});

// Final review, finding 7: the card's own copy of why Auto stopped and why the job is too big for Auto
// (the site's Auto tab draws it) is hidden as the queue's copy is.
test('a card’s Auto reasons go up scrubbed: why Auto stopped and why it is too big lose a home-folder path and a database address', async () => {
  const { boardRecord } = await import('../runner/mirror.js');
  const { homedir } = await import('node:os');
  const home = homedir();
  const stop = `The migration failed in ${home}/Projects/orbit-wt/orbit-16: could not reach postgres://olive@localhost/moxie_snapshot.`;
  const big = 'It touches /Users/olive/notes/plan.md and jdbc:postgresql://db.local:5432/orbit.';
  const stopped = { slug: 'count-rows', title: 'Count the rows', auto: { ...AUTO_CARD.auto, group: 'needs-you', stopped: { reason: stop, rule: 'migration', at: '2026-11-12T09:00:00Z' } } };
  const tooBig = { slug: 'split-report', title: 'Split the report', auto: { ...AUTO_CARD.auto, on: false, group: 'needs-you', tooBig: { at: '2026-11-12T09:00:00Z', reason: big } } };
  const old = { slug: 'old-laptop', title: 'Old laptop job', auto: { on: true, stopped: `It stopped in ${home}/Projects/x.` } }; // a record that kept the sentence alone
  const rec = boardRecord({ jobs: [stopped, tooBig, old, AUTO_CARD] });
  assert.deepEqual(rec.jobs[0], { ...stopped, auto: { ...stopped.auto, stopped: { reason: 'The migration failed in [path hidden]: could not reach [database address hidden].', rule: 'migration', at: '2026-11-12T09:00:00Z' } } });
  assert.deepEqual(rec.jobs[1], { ...tooBig, auto: { ...tooBig.auto, tooBig: { at: '2026-11-12T09:00:00Z', reason: 'It touches [path hidden] and [database address hidden].' } } });
  assert.deepEqual(rec.jobs[2], { ...old, auto: { on: true, stopped: 'It stopped in [path hidden].' } });
  const json = JSON.stringify(rec);
  assert.ok(!json.includes(home), 'no home folder');
  assert.doesNotMatch(json, /\/Users\/|postgres(?:ql)?:\/\/|moxie_snapshot|db\.local/);
  // A reason with nothing to hide is unchanged, and so is a card with none, or with no Auto record.
  const plain = { slug: 'customer-notes', auto: { ...AUTO_CARD.auto, stopped: { reason: 'the Foreman says it is blocked', rule: null, at: '2026-11-12T09:00:00Z' }, tooBig: { at: '2026-11-12T09:00:00Z', reason: 'The Foreman suggested a stack.' } } };
  const noReason = { slug: 'no-reason', auto: { on: true, stopped: { rule: null, at: '2026-11-12T09:00:00Z' }, tooBig: { at: '2026-11-12T09:00:00Z' } } };
  const his = { slug: 'mine-by-hand', title: 'Mine by hand' };
  assert.deepEqual(boardRecord({ jobs: [plain, noReason, his, AUTO_CARD] }).jobs, [plain, noReason, his, AUTO_CARD]);
  assert.equal(makeEvent('record', { kind: 'board', key: '', value: rec }).ok, true);
});

// The card's lane sentence repeats why Auto stopped ("Auto stopped: <reason>", lib/snapshot.js laneFor). It is hidden where it
// goes up, in the board's cards and in the site's job rows (runner/site-link.js jobRow); the laptop's own pages keep it as it is.
test('a lane sentence goes up scrubbed: in the board’s card and in the job row it loses a home-folder path and a database address', async () => {
  const { boardRecord } = await import('../runner/mirror.js');
  const { jobRow } = await import('../runner/site-link.js');
  const { homedir } = await import('node:os');
  const home = homedir();
  const sentence = `Auto stopped: The migration failed in ${home}/Projects/orbit-wt/orbit-16: could not reach postgres://olive@localhost/moxie_snapshot.`;
  const hidden = 'Auto stopped: The migration failed in [path hidden]: could not reach [database address hidden].';
  assert.ok(sentence.length > 120 && hidden.length < 120, 'longer than a job row keeps before it is hidden, shorter after');
  const card = { slug: 'count-rows', title: 'Count the rows', stage: 'test', lane: 'needs-you', laneReason: sentence, updatedAt: '2026-11-12T09:00:00Z' };
  const rec = boardRecord({ jobs: [card, { ...card, slug: 'auto-rows', auto: AUTO_CARD.auto }] });
  assert.deepEqual(rec.jobs, [{ ...card, laneReason: hidden }, { ...card, slug: 'auto-rows', auto: AUTO_CARD.auto, laneReason: hidden }], 'a card with an Auto record and one without');
  const row = jobRow(card);
  assert.deepEqual(row, { slug: 'count-rows', title: 'Count the rows', ticket: null, stage: 'test', state: 'needs-you', stateWords: hidden, now: hidden, updatedAt: '2026-11-12T09:00:00Z' });
  // While a crew member is at work the row's `now` is their line, as before; the lane sentence beside it is still hidden.
  const busy = jobRow({ ...card, nowDoing: [{ name: 'Builder', doing: 'Editing files' }] });
  assert.equal(busy.now, 'Builder: Editing files');
  assert.equal(busy.stateWords, hidden);
  for (const json of [JSON.stringify(rec), JSON.stringify(row), JSON.stringify(busy)]) {
    assert.ok(!json.includes(home), 'no home folder');
    assert.doesNotMatch(json, /\/Users\/|postgres(?:ql)?:\/\/|moxie_snapshot/);
  }
  assert.equal(card.laneReason, sentence, 'the laptop’s own card keeps the sentence as it is');
  // A plain sentence is unchanged, and so is a card with none.
  const plain = { ...card, slug: 'customer-notes', laneReason: 'Auto stopped: the Foreman says it is blocked' };
  const none = { slug: 'old-laptop', title: 'Old laptop job' };
  assert.deepEqual(boardRecord({ jobs: [plain, none] }).jobs, [plain, none]);
  assert.deepEqual(jobRow(plain), { slug: 'customer-notes', title: 'Count the rows', ticket: null, stage: 'test', state: 'needs-you', stateWords: plain.laneReason, now: plain.laneReason, updatedAt: '2026-11-12T09:00:00Z' });
  assert.deepEqual(jobRow({ ...none, headline: 'Spec ready' }), { slug: 'old-laptop', title: 'Old laptop job', ticket: null, stage: null, state: null, stateWords: null, now: 'Spec ready', updatedAt: null });
});

test('a card Auto is answering goes up marked so, and no other card carries the mark', () => {
  const p = { id: 'p', slug: 'x', kind: 'permission', toolName: 'Bash', input: { command: 'ls' }, plain: { headline: 'Run a command' } };
  assert.equal(permissionCard({ ...p, autoHas: true }).autoHas, true);
  assert.equal('autoHas' in permissionCard(p), false);
});
