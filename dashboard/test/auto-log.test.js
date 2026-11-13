// The Auto log (lib/auto-log.js): every decision Auto made on a job, with its reason and its cost.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AUTO_LOG_FILE, DECISIONS_HEADING, autoCost, autoLog, autoLogMarkdown, autoLogRecord, autoTime, capAutoLog, prDecisions, writeAutoLog } from '../lib/auto-log.js';
import { AUTO_MARK } from '../lib/auto.js';

// Local times, so the tests do not depend on the machine's time zone.
const at = (d, h, m) => new Date(2026, 10, d, h, m).toISOString();

const LINES = [
  { at: at(11, 8, 0), action: 'auto', what: 'on', by: 'you' },
  { at: at(11, 8, 5), action: 'auto', what: 'gate', stage: 'plan', briefNumber: 3, asked: 'Brief 3: go ahead?', chose: 'Approved the plan', why: 'It matches the spec.', risk: 'Low: no migration.', costUsd: 0.015 },
  { at: at(11, 8, 9), action: 'auto', what: 'question', stage: 'implement', asked: '2 questions', chose: 'Keep the column', why: 'Safer.', answers: [{ question: 'Keep the old column?', choice: 'Yes', reason: 'Nothing reads it.' }], costUsd: 0.025 },
  { at: at(11, 8, 10), action: 'send', kind: 'message', text: 'hello' },
];

test('the log has the three summary lines then entries newest first', () => {
  const v = autoLog(LINES, { title: 'Roster', now: at(11, 9, 0) });
  assert.deepEqual(v.summary, [
    'Auto made 2 decisions on this job. The Approver cost $0.04.',
    'Auto is on.',
    `Last decision: ${autoTime(at(11, 8, 9))}, Build: Keep the column.`,
  ]);
  assert.equal(autoTime(at(11, 8, 9)), '11 Nov 08:09');
  assert.deepEqual(v.entries.map((e) => [e.at, e.stage, e.chose]), [[at(11, 8, 9), 'Build', 'Keep the column'], [at(11, 8, 5), 'Plan', 'Approved the plan']]);
  assert.deepEqual(v.entries[0].answers, [{ question: 'Keep the old column?', choice: 'Yes', reason: 'Nothing reads it.' }]);
  assert.equal(v.entries[1].risk, 'Low: no migration.');
  assert.equal('answers' in v.entries[1], false);
  const md = autoLogMarkdown(v);
  assert.ok(md.indexOf('## 11 Nov 08:09 · Build · Keep the column') < md.indexOf('## 11 Nov 08:05 · Plan · Approved the plan'));
  assert.ok(md.includes('Asked: Brief 3: go ahead?'));
  assert.ok(md.includes('Keep the old column? → Yes. Why: Nothing reads it.'));
  assert.ok(md.includes('Why: It matches the spec.'));
  assert.ok(md.includes('Risk: Low: no migration.'));
  assert.ok(md.startsWith('# Auto log: Roster'));
});

test('singular, none, and the other line-2 and line-3 wordings', () => {
  assert.deepEqual(autoLog([{ ...LINES[1], costUsd: 0.016 }], {}).summary.slice(0, 2), ['Auto made 1 decision on this job. The Approver cost $0.02.', 'Auto is off.']);
  assert.deepEqual(autoLog([LINES[0]], {}).summary, ['Auto made 0 decisions on this job. The Approver cost $0.00.', 'Auto is on.', 'No decisions yet.']);
  const stop = { at: at(11, 8, 20), action: 'auto', what: 'stop', rule: 'database', reason: 'A migration needs you.' };
  assert.equal(autoLog([...LINES, stop], {}).summary[1], 'Auto stopped: A migration needs you.');
  // The person carrying on after a stop puts Auto back on; Auto's own replies do not.
  assert.equal(autoLog([...LINES, stop, { at: at(11, 8, 30), action: 'send', kind: 'approve', by: 'auto' }], {}).summary[1], 'Auto stopped: A migration needs you.');
  assert.equal(autoLog([...LINES, stop, { at: at(11, 8, 30), action: 'send', kind: 'approve' }], {}).summary[1], 'Auto is on.');
  assert.equal(autoLog([...LINES, stop, { at: at(11, 8, 30), action: 'permission', decision: 'allow' }], {}).summary[1], 'Auto is on.');
  assert.equal(autoLog([...LINES, { at: at(11, 9, 0), action: 'auto', what: 'finished' }], {}).summary[1], 'Auto finished: PR #1 is open.');
  assert.equal(autoLog([...LINES, { at: at(11, 9, 0), action: 'auto', what: 'off', by: 'you' }], {}).summary[1], 'Auto is off.');
});

test('the job record decides line 2 when it is passed', () => {
  assert.equal(autoLog(LINES, { record: { on: true, stopped: 'The tests would not pass.' } }).summary[1], 'Auto stopped: The tests would not pass.');
  assert.equal(autoLog(LINES, { record: { on: true, stopped: { reason: 'Three failures.', rule: 'loop' } } }).summary[1], 'Auto stopped: Three failures.');
  assert.equal(autoLog(LINES, { record: { on: true, stopped: null } }).summary[1], 'Auto is on.');
  assert.equal(autoLog(LINES, { record: { on: false } }).summary[1], 'Auto is off.');
  const done = [...LINES, { at: at(11, 9, 0), action: 'auto', what: 'finished' }];
  assert.equal(autoLog(done, { record: { on: false } }).summary[1], 'Auto finished: PR #1 is open.');
  assert.equal(autoLog(done, { record: { on: true } }).summary[1], 'Auto is on.');
});

test('autoCost adds the Approver cost of Auto lines only', () => {
  assert.equal(autoCost(LINES), 0.04);
  assert.equal(autoCost([]), 0);
  assert.equal(autoCost([{ action: 'send', costUsd: 5 }, { action: 'auto', what: 'gate', costUsd: 'x' }, null]), 0);
  assert.equal(autoLog([{ action: 'auto', what: 'gate', stage: 'plan', chose: 'x', costUsd: 0.004 }], {}).summary[0], 'Auto made 1 decision on this job. The Approver cost $0.00.');
});

test('words from the Approver or a ticket cannot start a heading or a list item', () => {
  const evil = '\n# Heading\n- item\n## Another ' + 'x'.repeat(400);
  const md = autoLogMarkdown(autoLog([{ at: at(11, 8, 5), action: 'auto', what: 'gate', stage: 'plan', asked: evil, chose: evil, why: evil, risk: evil, answers: [{ question: evil, choice: evil, reason: evil }] }], { title: evil }));
  const lines = md.split('\n');
  assert.deepEqual(lines.filter((l) => /^#{1,6}\s/.test(l)).length, 2);
  assert.equal(lines.filter((l) => /^[-*]\s/.test(l)).length, 1);
  for (const l of lines) assert.ok(l.length < 1000, 'each line is capped (300 per part)');
  assert.ok(md.includes('# Heading - item ## Another'));
});

test('a job with no Auto lines has no auto-log.md', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-log-'));
  try {
    assert.equal(await writeAutoLog(dir, [{ action: 'send', kind: 'approve' }], { title: 'T' }), null);
    assert.equal(await writeAutoLog(dir, [], {}), null);
    assert.deepEqual(await fs.readdir(dir), []);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('auto-log.md is written again after each decision', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-log-'));
  try {
    const file = path.join(dir, AUTO_LOG_FILE);
    assert.equal(AUTO_LOG_FILE, 'auto-log.md');
    assert.equal(await writeAutoLog(dir, LINES.slice(0, 2), { title: 'T' }), file);
    const first = await fs.readFile(file, 'utf8');
    assert.ok(first.includes('Auto made 1 decision'));
    await writeAutoLog(dir, LINES, { title: 'T' });
    const second = await fs.readFile(file, 'utf8');
    assert.ok(second.includes('Auto made 2 decisions') && second.includes('Keep the column'));
    assert.deepEqual(await fs.readdir(dir), ['auto-log.md']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('the mark is the exact sentence', () => {
  assert.equal(AUTO_MARK, "(Sent by Starbase's Auto for the person. options.json says auto: true.)");
});

test('the record the site gets is { on, stopped, tag, summary, entries, startedAt, ticket }, and none for a job Auto has not run on', () => {
  assert.equal(autoLogRecord([{ action: 'send', kind: 'approve' }], { title: 'T' }), null);
  assert.equal(autoLogRecord([], {}), null);
  const rec = autoLogRecord(LINES, { title: 'T', record: { on: true, stopped: null, tag: 'auto-ok', by: 'tag', ran: true } });
  assert.deepEqual(Object.keys(rec), ['on', 'stopped', 'tag', 'summary', 'entries', 'startedAt', 'ticket']);
  assert.equal(rec.on, true);
  assert.equal(rec.stopped, null);
  assert.equal(rec.tag, 'auto-ok');
  assert.equal(rec.summary.length, 3);
  assert.equal(rec.entries.length, 2);
  // Stopped: the reason, whether the record keeps a sentence or { reason }.
  assert.equal(autoLogRecord(LINES, { record: { on: true, stopped: 'It needs you' } }).stopped, 'It needs you');
  assert.equal(autoLogRecord(LINES, { record: { on: true, stopped: { reason: 'Risky' } } }).stopped, 'Risky');
  assert.equal(autoLogRecord(LINES, { record: null }).on, false);
});

test('a decision with no readable time leaves the time out, with no stray comma or dot', () => {
  const lines = [{ action: 'auto', what: 'gate', stage: 'plan', chose: 'Approved the plan', why: 'ok' }];
  const v = autoLog(lines, {});
  assert.equal(v.summary[2], 'Last decision: Plan: Approved the plan.');
  const md = autoLogMarkdown(v);
  assert.ok(md.includes('\n## Plan · Approved the plan\n'), md);
  const bad = autoLog([{ at: 'nonsense', action: 'auto', what: 'gate', stage: 'plan', chose: 'X' }], {});
  assert.equal(bad.summary[2], 'Last decision: Plan: X.');
});

test('newest first compares times as dates, and ties or unreadable times keep the order of the file', () => {
  const mk = (iso, chose) => ({ at: iso, action: 'auto', what: 'gate', stage: 'plan', chose });
  const v = autoLog([mk('2026-11-11T09:00:00+02:00', 'earlier'), mk('2026-11-11T08:00:00Z', 'later')], {});
  assert.deepEqual(v.entries.map((e) => e.chose), ['later', 'earlier']);
  const w = autoLog([mk('junk', 'a'), mk('junk', 'b')], {});
  assert.deepEqual(w.entries.map((e) => e.chose), ['b', 'a']);
});

test('agent text cannot start inline markup in the Markdown', () => {
  const view = { title: '<b>T</b>', summary: ['Last decision: [x](y) `z`'], entries: [{ at: '', stage: 'Plan', chose: '<img src=x> `c`', asked: '[a](b)', why: '`w` <i>', risk: '<r>', answers: [{ question: '[q]', choice: '`c`', reason: '<s>' }] }] };
  const md = autoLogMarkdown(view);
  assert.equal(/[<`[]/.test(md.replace(/\\[<`[]/g, '')), false, md);
  assert.ok(md.includes('\\<img src=x>'), md);
});

test('a job a tag started says when and on which ticket; one you started has no start time', () => {
  const tagged = [{ at: at(11, 7, 50), action: 'auto', what: 'on', by: 'tag' }, ...LINES.slice(1)];
  const rec = autoLogRecord(tagged, { title: 'T', record: { on: true, by: 'tag', tag: 'auto-ok' }, ticket: 'ORBIT-479' });
  assert.equal(rec.startedAt, at(11, 7, 50));
  assert.equal(rec.ticket, 'ORBIT-479');
  // Started by you (LINES' first line is by you): no start time; no ticket given: none.
  const mine = autoLogRecord(LINES, { record: { on: true } });
  assert.equal(mine.startedAt, null);
  assert.equal(mine.ticket, null);
  // An old Auto log, its lines with no stage and no by, still reads.
  const old = autoLogRecord([{ action: 'auto', what: 'on' }, { action: 'auto', what: 'gate', chose: 'Approved' }], {});
  assert.equal(old.startedAt, null);
  assert.deepEqual(old.entries.map((e) => [e.kind, e.stop, e.chose]), [['approve', null, 'Approved']]);
  assert.equal(old.summary[0], 'Auto made 1 decision on this job. The Approver cost $0.00.');
  // Cut to the site's limits, the new facts are kept.
  assert.deepEqual(capAutoLog(rec), rec);
});

test('each entry says its kind and its step, and a stop is an entry that the count leaves out', () => {
  const allow = { at: at(11, 8, 15), action: 'auto', what: 'permission', stage: 'implement', asked: 'Run npm test', chose: 'Allowed', why: 'Tests only.', costUsd: 0.01 };
  const stop = { at: at(11, 8, 20), action: 'auto', what: 'stop', stage: 'test', rule: 'database', reason: 'A migration needs you.', why: 'A migration needs you.' };
  const rec = autoLogRecord([...LINES, allow, stop], { record: { on: true, stopped: { reason: 'A migration needs you.' } } });
  assert.deepEqual(rec.entries.map((e) => [e.kind, e.stop, e.stage, e.chose]), [
    ['stop', 'test', 'Test', 'A migration needs you.'],
    ['allow', 'build', 'Build', 'Allowed'],
    ['answer', 'build', 'Build', 'Keep the column'],
    ['approve', 'plan', 'Plan', 'Approved the plan'],
  ]);
  // The count and the last decision are the decisions only: the stop is not one.
  assert.equal(rec.summary[0], 'Auto made 3 decisions on this job. The Approver cost $0.05.');
  assert.equal(rec.summary[2], `Last decision: ${autoTime(at(11, 8, 15))}, Build: Allowed.`);
  // A stage that is not one of the steps has no step.
  assert.equal(autoLogRecord([{ action: 'auto', what: 'gate', stage: 'somewhere', chose: 'x' }], {}).entries[0].stop, null);
  // The same entries cut to the site's limits keep their kind and step.
  assert.deepEqual(capAutoLog(rec).entries.map((e) => [e.kind, e.stop]), rec.entries.map((e) => [e.kind, e.stop]));
});

test('a refusal is an entry of kind refuse, its chose Refused: and the headline', () => {
  const refuse = { at: at(11, 8, 15), action: 'auto', what: 'refuse', stage: 'implement', rule: 'database', asked: 'Run npm run db:migrate', chose: 'Refused: Run npm run db:migrate', why: 'Starbase applies this job\'s migrations to Auto\'s own copy of the database when the job\'s turn to test comes.' };
  const rec = autoLogRecord([...LINES, refuse], {});
  assert.deepEqual(rec.entries.map((e) => [e.kind, e.stop, e.chose]), [
    ['refuse', 'build', 'Refused: Run npm run db:migrate'],
    ['answer', 'build', 'Keep the column'],
    ['approve', 'plan', 'Approved the plan'],
  ]);
  assert.deepEqual([rec.entries[0].asked, rec.entries[0].why], ['Run npm run db:migrate', 'Starbase applies this job\'s migrations to Auto\'s own copy of the database when the job\'s turn to test comes.']);
  // A refusal is a decision: it is counted, and it can be the last one.
  assert.equal(rec.summary[0], 'Auto made 3 decisions on this job. The Approver cost $0.04.');
  assert.equal(rec.summary[2], `Last decision: ${autoTime(at(11, 8, 15))}, Build: Refused: Run npm run db:migrate.`);
  // The laptop's list (no stops) has it too, and so does auto-log.md.
  assert.equal(autoLog([...LINES, refuse]).entries[0].kind, 'refuse');
  assert.match(autoLogMarkdown(autoLog([...LINES, refuse])), /Refused: Run npm run db:migrate/);
});

test('a risky call\'s entry carries risky and what the Approver first said', () => {
  const risky = { at: at(11, 8, 20), action: 'auto', what: 'gate', stage: 'plan', briefNumber: 4, asked: 'Brief 4: go ahead?', chose: 'Approved', why: 'I kept the old column instead, which can be undone.', risk: 'low', risky: true, first: 'Stop: The plan drops the old column.', costUsd: 0.02 };
  const perm = { at: at(11, 8, 25), action: 'auto', what: 'permission', stage: 'implement', asked: 'Fetch a page', chose: 'Said no', why: 'Not plainly safe.', risk: 'medium', risky: true, first: 'Allow, high risk: It reaches an outside site.' };
  const rec = autoLogRecord([...LINES, risky, perm], {});
  assert.deepEqual([rec.entries[0].risky, rec.entries[0].first], [true, 'Allow, high risk: It reaches an outside site.']);
  assert.deepEqual([rec.entries[1].risky, rec.entries[1].first, rec.entries[1].kind], [true, 'Stop: The plan drops the old column.', 'approve']);
  // An ordinary decision carries neither.
  for (const e of rec.entries.slice(2)) { assert.equal('risky' in e, false); assert.equal('first' in e, false); }
  assert.equal(autoLog([...LINES, risky]).entries[0].first, 'Stop: The plan drops the old column.');
  // The site's cut keeps them.
  assert.deepEqual([capAutoLog(rec).entries[1].risky, capAutoLog(rec).entries[1].first], [true, 'Stop: The plan drops the old column.']);
});

// ---------- Decisions Auto made: the risky calls, for the end of PR #1's description (Auto queue Task 14) ----------

const riskyCall = (o = {}) => ({ at: at(12, 9, 0), action: 'auto', what: 'gate', stage: 'review', briefNumber: 2, asked: 'Review brief 2', chose: 'Approved', why: 'I kept the old column.', risk: 'low', risky: true, first: 'Stop: The review found a gap.', ...o });
const MENTION = /(^|[^A-Za-z0-9_])@(?=[A-Za-z0-9])/;

test('prDecisions lists the risky calls in the audit\'s order under the heading', () => {
  const lines = [
    ...LINES,
    riskyCall({ at: at(12, 9, 10), stage: 'plan', asked: 'Plan v2 ready', first: 'Stop: The plan drops a column.', why: 'I kept the column.' }),
    { ...LINES[1], at: at(12, 9, 5) }, // an ordinary go: not listed
    // Earlier in time but later in the file: the file's order stands (oldest written first).
    riskyCall({ at: at(12, 8, 0), what: 'permission', stage: 'implement', asked: 'Fetch a page', first: 'Allow, high risk: It reaches an outside site.', why: 'Said no: it is not needed.' }),
    riskyCall({ at: at(12, 9, 20), what: 'question', stage: 'triage', asked: 'Which table?', first: 'Stop: Two tables fit.', why: 'The one the ticket names.' }),
  ];
  assert.equal(DECISIONS_HEADING, 'Decisions Auto made');
  assert.deepEqual(prDecisions(lines), [
    'Decisions Auto made',
    '- Plan: Plan v2 ready. In doubt: Stop: The plan drops a column. Auto chose: I kept the column.',
    '- Build: Fetch a page. In doubt: Allow, high risk: It reaches an outside site. Auto chose: Said no: it is not needed.',
    '- Spec: Which table? In doubt: Stop: Two tables fit. Auto chose: The one the ticket names.',
  ]);
  // The call being sent now (not written down yet) is the last line.
  const now = prDecisions(lines, { extra: { stage: 'review', asked: 'Review brief 3', first: 'Go, high risk: It changes the export.', why: 'The export stays as it was.' } });
  assert.equal(now.length, 5);
  assert.equal(now.at(-1), '- Review: Review brief 3. In doubt: Go, high risk: It changes the export. Auto chose: The export stays as it was.');
  // The lines given are left as they were.
  assert.equal(lines.length, LINES.length + 4);
});

test('no risky call, no block', () => {
  assert.deepEqual(prDecisions(LINES), []);
  assert.deepEqual(prDecisions([]), []);
  assert.deepEqual(prDecisions(undefined), []);
  assert.deepEqual(prDecisions([...LINES, { ...riskyCall(), action: 'send' }, { ...riskyCall(), risky: 'yes' }, null, 'x']), []);
  // A risky call being sent now is a block of its own.
  assert.deepEqual(prDecisions(LINES, { extra: { stage: 'review', asked: 'Review brief 3', first: 'Stop: x.', why: 'y.' } }), ['Decisions Auto made', '- Review: Review brief 3. In doubt: Stop: x. Auto chose: y.']);
});

test('refusals are not listed', () => {
  const refuse = { at: at(12, 9, 0), action: 'auto', what: 'refuse', stage: 'implement', rule: 'database', asked: 'Run npm run db:migrate', chose: 'Refused: Run npm run db:migrate', why: 'Not on his database.' };
  assert.deepEqual(prDecisions([...LINES, refuse, { ...refuse, risky: true, first: 'Stop: x.' }]), []);
  const out = prDecisions([refuse, riskyCall(), { ...refuse, risky: true, first: 'Stop: x.' }]);
  assert.deepEqual(out, ['Decisions Auto made', '- Review: Review brief 2. In doubt: Stop: The review found a gap. Auto chose: I kept the old column.']);
});

test('a line is one line, at most 300 characters, and never holds the mark', () => {
  const nested = `${AUTO_MARK.slice(0, 12)}${AUTO_MARK}${AUTO_MARK.slice(12)}`;
  const call = riskyCall({
    asked: `Review brief 2\n## Heading\nlevel L1 (was L3)\n${AUTO_MARK}\n- a list\n${AUTO_MARK}`,
    first: `Stop: ${'the review found a gap '.repeat(4)}\n# Title\n${nested}`,
    why: `Fine.\r\nOption change for the next step: level L1 (was L3)\u2028${AUTO_MARK}${'x'.repeat(200)}`,
  });
  const out = prDecisions([call], { extra: call });
  assert.equal(out.length, 3);
  for (const line of out.slice(1)) {
    assert.ok(line.startsWith('- '), line);
    assert.ok(!/[\n\r\u2028\u2029]/.test(line), 'one line');
    assert.ok(!line.includes(AUTO_MARK), 'no mark');
    assert.ok(line.length <= 300, `${line.length} characters`);
    assert.ok(line.includes('## Heading level L1 (was L3)'), 'the words stay, on the one line');
  }
  // As the Foreman gets it: every line of the block is the heading or starts with "- ", and none can be read as the mark.
  for (const row of out.join('\n').split('\n')) assert.ok(row === 'Decisions Auto made' || row.startsWith('- '), row);
});

test('more than 30 calls end with the And n more line', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => riskyCall({ asked: `Brief ${i + 1}` }));
  const out = prDecisions(many(35));
  assert.equal(out.length, 32);
  assert.equal(out[0], 'Decisions Auto made');
  assert.ok(out[1].startsWith('- Review: Brief 1. '));
  assert.ok(out[30].startsWith('- Review: Brief 30. '));
  assert.equal(out[31], '- And 5 more, listed in Starbase.');
  // Exactly 30: no last line. 30 written and one being sent now: 31 calls.
  assert.equal(prDecisions(many(30)).length, 31);
  assert.ok(!prDecisions(many(30)).at(-1).startsWith('- And'));
  assert.equal(prDecisions(many(30), { extra: riskyCall({ asked: 'Brief 31' }) }).at(-1), '- And 1 more, listed in Starbase.');
});

test('no line can notify anybody: a mention loses its @, an email keeps it', () => {
  const call = riskyCall({ asked: '@raj please look', first: 'Stop: (@org/team)', why: 'mail a@b.co' });
  const out = prDecisions([call], { extra: { stage: 'review', asked: '@@raj and @Vignesh-x', first: 'Stop: cc @team.', why: '`@raj` too' } });
  assert.equal(out[1], '- Review: raj please look. In doubt: Stop: (org/team). Auto chose: mail a@b.co');
  assert.ok(out[2].includes('raj and Vignesh-x'), out[2]);
  assert.ok(out[2].includes('cc team'), out[2]);
  for (const line of out) assert.ok(!MENTION.test(line), line);
  // Forms that only become a mention once Markdown is rendered: underscore emphasis and the character references for @.
  for (const form of ['_@raj_', '(_@raj_)', '__@raj__', '&#64;raj', '&#064;raj', '&#x40;raj', '&#X0040;raj', '&commat;raj', '&COMMAT;raj']) {
    const [, line] = prDecisions([riskyCall({ asked: `cc ${form}`, first: `Stop: ${form}`, why: form })]);
    assert.ok(!line.includes('@'), `${form}: ${line}`);
    assert.ok(line.includes('raj'), `${form}: ${line}`);
  }
  assert.ok(prDecisions([riskyCall({ why: 'mail a@b.co, or &#64;raj' })])[1].endsWith('Auto chose: mail a@b.co, or raj'));
});

test('a long line keeps what was in doubt: the question is cut first, then the choice', () => {
  const first = `Stop: ${'d'.repeat(114)}`; // 120 characters
  const call = riskyCall({ asked: 'q'.repeat(200), first, why: 'w'.repeat(200) });
  const [, line] = prDecisions([call]);
  assert.equal(line.length, 300);
  assert.ok(line.startsWith(`- Review: ${'q'.repeat(80)}… In doubt: ${first}. Auto chose: w`), line);
  assert.ok(line.endsWith('w…'), line);
  // A short question is not cut; only the choice is.
  const [, short] = prDecisions([riskyCall({ asked: 'Review brief 2', first, why: 'w'.repeat(300) })]);
  assert.ok(short.startsWith(`- Review: Review brief 2. In doubt: ${first}. Auto chose: w`), short);
  assert.equal(short.length, 300);
  // Only when the doubt itself is too long is the whole line cut.
  const [, huge] = prDecisions([riskyCall({ asked: 'q'.repeat(200), first: `Stop: ${'d'.repeat(400)}`, why: 'w'.repeat(50) })]);
  assert.equal(huge.length, 300);
  assert.ok(huge.startsWith(`- Review: ${'q'.repeat(80)}… In doubt: Stop: ddd`), huge);
  assert.ok(huge.endsWith('d…'), huge);
});

test('a risky go that left decided items open says how many, and the ending survives the cut', () => {
  const two = ' 2 decided items on this step are left for you in Starbase.';
  const one = ' 1 decided item on this step is left for you in Starbase.';
  assert.deepEqual(prDecisions([riskyCall({ open: 2 })]).at(-1), `- Review: Review brief 2. In doubt: Stop: The review found a gap. Auto chose: I kept the old column.${two}`);
  assert.deepEqual(prDecisions([riskyCall({ open: 1 })]).at(-1), `- Review: Review brief 2. In doubt: Stop: The review found a gap. Auto chose: I kept the old column.${one}`);
  // None open, or no field: no ending.
  for (const open of [0, undefined, -1, '2']) assert.ok(prDecisions([riskyCall({ open })]).at(-1).endsWith('Auto chose: I kept the old column.'));
  // Long: the cuts make room for the ending, which is never cut.
  const long = riskyCall({ asked: 'q'.repeat(200), first: `Stop: ${'d'.repeat(114)}`, why: 'w'.repeat(200), open: 2 });
  const [, cut] = prDecisions([long]);
  assert.equal(cut.length, 300);
  assert.ok(cut.endsWith(`w…${two}`), cut);
  assert.ok(cut.includes(`In doubt: Stop: ${'d'.repeat(114)}. Auto chose: w`));
  const [, huge] = prDecisions([{ ...long, first: `Stop: ${'d'.repeat(400)}` }]);
  assert.ok(huge.length <= 300 && huge.endsWith(`d…${two}`), huge);
  // The call being sent now carries the same ending.
  assert.ok(prDecisions([], { extra: { stage: 'review', asked: 'Review brief 3', first: 'Stop: x.', why: 'y.', open: 1 } }).at(-1).endsWith(`y.${one}`));
});

test('an unclosed backtick cannot swallow the description', () => {
  const [, odd] = prDecisions([riskyCall({ asked: 'Run `npm test', why: 'It ``passes.' })]);
  assert.equal(odd, '- Review: Run npm test. In doubt: Stop: The review found a gap. Auto chose: It passes.');
  // An even count is left as it is.
  const [, even] = prDecisions([riskyCall({ asked: 'Run `npm test`' })]);
  assert.ok(even.includes('Run `npm test`'), even);
  // Taking the backticks out cannot make a copy of the mark, or a mention.
  const hidden = `${AUTO_MARK.slice(0, 20)}\`${AUTO_MARK.slice(20)}`;
  const [, mark] = prDecisions([riskyCall({ asked: hidden, why: 'cc @``raj' })]);
  assert.ok(!mark.includes(AUTO_MARK), mark);
  assert.ok(!mark.includes('`'), mark);
  assert.ok(!MENTION.test(mark), mark);
});

test('neither cut leaves half of an emoji', () => {
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  // The question cut at 80 units falls inside the 40th emoji (after an "a", each emoji is two units).
  const [, asked] = prDecisions([riskyCall({ asked: `a${'😀'.repeat(100)}`, why: 'w'.repeat(300) })]);
  assert.ok(!lone.test(asked), JSON.stringify(asked));
  assert.ok(asked.startsWith(`- Review: a${'😀'.repeat(39)}… In doubt:`), asked);
  // The line cut at 300 falls inside the doubt, at either parity.
  for (const pre of ['', 'x']) {
    const [, line] = prDecisions([riskyCall({ first: `Stop: ${pre}${'😀'.repeat(300)}` })]);
    assert.ok(!lone.test(line), JSON.stringify(line.slice(-6)));
    assert.ok(line.length <= 300 && line.endsWith('😀…'), line.slice(-6));
    const [, ending] = prDecisions([riskyCall({ first: `Stop: ${pre}${'😀'.repeat(300)}`, open: 2 })]);
    assert.ok(!lone.test(ending) && ending.endsWith('😀… 2 decided items on this step are left for you in Starbase.'), ending.slice(-70));
  }
});

test('a line with no step starts with Step, so the caller\'s words never begin the list item', () => {
  for (const stage of [null, undefined, '']) {
    const [, line] = prDecisions([riskyCall({ stage, asked: '<!-- x' })]);
    assert.equal(line, '- Step: <!-- x. In doubt: Stop: The review found a gap. Auto chose: I kept the old column.');
  }
  assert.ok(prDecisions([riskyCall({ stage: 'deploy' })])[1].startsWith('- deploy: '), 'an unknown stage keeps its own name');
});
