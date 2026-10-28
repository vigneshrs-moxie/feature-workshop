// A job's "Your decisions" log (lib/decisions.js): what counts as your decision, in words, newest first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decisionId, decisionLog, decisionOf, decisionPrefix, decisionRows, gateAnswers, gateNote, keptParts, render, ticketCopy, writeDecisionsFile } from '../lib/decisions.js';

test('approvals, send-backs with their note, stops, permissions, levels, closing', () => {
  const log = decisionLog([
    { at: '2026-10-26T10:00:00Z', action: 'send', kind: 'approve', gateBrief: 2, text: 'I approve.' },
    { at: '2026-10-26T10:05:00Z', action: 'send', kind: 'changes', gateBrief: 3, text: '\nKeep the old column.\nAnd more.' },
    { at: '2026-10-26T10:06:00Z', action: 'send', kind: 'message', text: 'a question' },
    { at: '2026-10-26T10:07:00Z', action: 'permission', decision: 'deny', headline: 'Run rm -rf', note: 'not that' },
    { at: '2026-10-26T10:08:00Z', action: 'options', options: { level: 3 }, was: 2, via: 'gate' },
    { at: '2026-10-26T10:09:00Z', action: 'auto-allowed', headline: 'Read' },
    { at: '2026-10-26T10:10:00Z', action: 'close', as: 'dropped' },
  ]);
  assert.deepEqual(log.map((d) => d.text), ['Dropped the job', 'Level L2 → L3 (from a gate)', 'Said no to: Run rm -rf', 'Sent back brief 3 for changes', 'Approved brief 2']);
  assert.equal(log[3].note, 'Keep the old column.');
  assert.equal(log[2].note, 'not that');
  assert.equal('note' in log[0], false);
});

test('anything else is not a decision', () => {
  for (const e of [null, {}, { action: 'steer', text: 'x' }, { action: 'run-ended' }, { action: 'send', kind: 'resume' }]) assert.equal(decisionOf(e), null);
});

test('automatic picks and your overrides are in the log', () => {
  const log = decisionLog([
    { at: '2026-10-26T10:00:00Z', action: 'auto-level', how: 'chose', level: 2, was: null },
    { at: '2026-10-26T10:05:00Z', action: 'options', options: { level: 1 }, was: 2, overrode: 'auto' },
    { at: '2026-10-26T10:09:00Z', action: 'auto-level', how: 'diff', level: 3, was: 1 },
  ]);
  assert.deepEqual(log.map((d) => d.text), ['Level L1 → L3 (automatic, after a build)', 'Level L2 → L1 (you changed the automatic pick)', 'Level L2 (automatic)']);
});

test('automatic picks and your overrides are in the log', () => {
  const log = decisionLog([
    { at: '2026-10-26T10:00:00Z', action: 'auto-level', how: 'chose', level: 2, was: null },
    { at: '2026-10-26T10:05:00Z', action: 'options', options: { level: 1 }, was: 2, overrode: 'auto' },
    { at: '2026-10-26T10:09:00Z', action: 'auto-level', how: 'diff', level: 3, was: 1 },
  ]);
  assert.deepEqual(log.map((d) => d.text), ['Level L1 → L3 (automatic, after a build)', 'Level L2 → L1 (you changed the automatic pick)', 'Level L2 (automatic)']);
});

// ---------- decisions.md ----------

test('ids: the ticket key when there is one, else orbit-<n>- from the slug, else the slug', () => {
  assert.equal(decisionPrefix({ slug: 'feedback-api', ticketKey: 'ORBIT-479' }), 'ORBIT-479');
  assert.equal(decisionPrefix({ slug: 'feedback-api', ticketKey: 'orbit-12' }), 'ORBIT-12');
  assert.equal(decisionPrefix({ slug: 'orbit-479-feedback-api' }), 'ORBIT-479');
  assert.equal(decisionPrefix({ slug: 'orbit-0479-feedback-api' }), 'ORBIT-479');
  assert.equal(decisionPrefix({ slug: 'orbital-sander' }), 'orbital-sander');
  assert.equal(decisionPrefix({ slug: 'add-csv-export', ticketKey: 'not a key' }), 'add-csv-export');
  assert.equal(decisionId('ORBIT-479', 3), 'ORBIT-479.D3');
  assert.equal(decisionId('add-csv-export', 1), 'add-csv-export.D1');
});

// A job's audit lines, oldest first, as the dashboard writes them.
const AUDIT = [
  { at: '2026-10-27T09:00:00Z', action: 'new-job', featureDir: '/f/orbit-479-feedback-api' },
  { at: '2026-10-27T09:10:00Z', action: 'send', kind: 'approve', gateBrief: 1, text: 'My answers to brief 1:\n1. Write-back from agents? → a) None\n2. Who sees it? → b) Office managers. Only Phoenix for now\n\nI approve. Go ahead with the next stage: write the spec\nAt these versions: spec v0.1 (draft).\nagents must not write; people paste links' },
  { at: '2026-10-27T09:20:00Z', action: 'permission', decision: 'allow', headline: 'Read the env file' },
  { at: '2026-10-27T09:21:00Z', action: 'permission', decision: 'deny', headline: 'Run rm -rf build | tee x', note: 'not on my machine' },
  { at: '2026-10-27T09:22:00Z', action: 'permission', decision: 'allow', tool: 'AskUserQuestion', answers: { 'Keep the old column?': 'Yes' } },
  { at: '2026-10-27T09:30:00Z', action: 'options', options: { level: 3 }, was: 2, via: 'gate' },
  { at: '2026-10-27T09:31:00Z', action: 'options', options: { level: 3, fable: [] }, was: 3 },
  { at: '2026-10-27T09:32:00Z', action: 'auto-level', level: 2, was: 3 },
  { at: '2026-10-27T09:40:00Z', action: 'send', kind: 'changes', gateBrief: 2, text: 'Please make changes before moving on, and stay in the current stage:\nKeep the export button where it is.' },
  { at: '2026-10-27T09:41:00Z', action: 'send', kind: 'message', text: 'just a question' },
  { at: '2026-10-28T08:00:00Z', action: 'send', kind: 'stop', text: 'Stop here. Record where things stand in workflow-status.md and don’t start anything else.' },
];

test('rows: gate decisions with their answers and note, level changes, questions answered, permissions with a reason', () => {
  const rows = decisionRows(AUDIT, { prefix: 'ORBIT-479', person: 'Vignesh', briefs: { 1: 'clarify', 2: 'spec' } });
  assert.deepEqual(rows.map((r) => [r.id, r.question, r.choice, r.why]), [
    ['ORBIT-479.D1', 'Write-back from agents?', 'None', ''],
    ['ORBIT-479.D2', 'Who sees it?', 'Office managers. Only Phoenix for now', ''],
    ['ORBIT-479.D3', 'Brief 1 (clarify): go ahead?', 'approve', 'agents must not write; people paste links'],
    ['ORBIT-479.D4', 'Allow “Run rm -rf build | tee x”?', 'say no', 'not on my machine'],
    ['ORBIT-479.D5', 'Keep the old column?', 'Yes', ''],
    ['ORBIT-479.D6', 'Level for this job', 'L3', 'was L2, from a gate'],
    ['ORBIT-479.D7', 'Brief 2 (spec): go ahead?', 'send back', 'Keep the export button where it is.'],
    ['ORBIT-479.D8', 'The Foreman’s latest brief: go ahead?', 'stop', ''],
  ]);
  assert.ok(rows.every((r) => r.who === 'Vignesh'));
  assert.deepEqual(rows.map((r) => r.when), ['2026-10-27', '2026-10-27', '2026-10-27', '2026-10-27', '2026-10-27', '2026-10-27', '2026-10-27', '2026-10-28']);
  assert.equal(rows[2].options, 'approve · send back · stop');
  assert.equal(rows[5].options, 'L0 · L1 · L2 · L3');
});

test('the note typed on the card is read back out of the reply; an edited reply gives its first own line', () => {
  assert.equal(gateNote('approve', 'I approve. Go ahead with the next stage you proposed.'), '');
  assert.equal(gateNote('changes', 'Please make changes before moving on, and stay in the current stage:\n(describe the changes)'), '');
  assert.equal(gateNote('stop', 'Stop here. Record where things stand.\nOut of time this week.'), 'Out of time this week.');
  assert.equal(gateNote('approve', 'My answers to brief 2:\n1. Q → a) x\n\nLooks fine, ship the spec.\nThanks'), 'Looks fine, ship the spec.');
  assert.deepEqual(gateAnswers('I approve.'), []);
});

const rowsOf = (audit) => decisionRows(audit, { prefix: 'ORBIT-479', person: 'Vignesh', briefs: { 1: 'clarify', 2: 'spec' } });

test('render: the §8 format, a title, the table with escaped pipes, no sections, Not doing at the end', () => {
  const text = render({ prefix: 'ORBIT-479', title: 'Feedback API and MCP', rows: rowsOf(AUDIT) });
  const lines = text.split('\n');
  assert.equal(lines[0], '# ORBIT-479 · Feedback API and MCP');
  assert.ok(lines.includes('| id | question | options | choice | who | when | why |'));
  assert.ok(lines.includes('|---|---|---|---|---|---|---|'));
  assert.ok(lines.includes('| ORBIT-479.D3 | Brief 1 (clarify): go ahead? | approve · send back · stop | approve | Vignesh | 2026-10-27 | agents must not write; people paste links |'));
  assert.ok(lines.includes('| ORBIT-479.D4 | Allow “Run rm -rf build \\| tee x”? | allow · allow for this reply · say no | say no | Vignesh | 2026-10-27 | not on my machine |'));
  assert.equal(lines.filter((l) => /^\| ORBIT-479\.D\d+ /.test(l)).length, 8);
  assert.equal(lines.some((l) => /^## Section:/.test(l)), false);
  assert.equal(lines.filter(Boolean).at(-1), '## Not doing');
  assert.equal(render({ prefix: 'add-csv-export', title: 'add-csv-export' }).split('\n')[0], '# add-csv-export');
});

const FOREMAN_FILE = [
  '# ORBIT-479 · Old title',
  '',
  'Some prose someone typed, not kept.',
  '',
  '| id | question | options | choice | who | when | why |',
  '|---|---|---|---|---|---|---|',
  '| ORBIT-479.D1 | an old generated row | a · b | a | Vignesh | 2026-10-01 | stale |',
  '| ORBIT-479.F1 | Store feedback per office? | yes · no | yes | Foreman | 2026-10-27 | the spec says offices differ | <!-- foreman -->',
  '',
  '## Section: work-order-v2',
  '| ORBIT-479.F2 | Reuse the old queue? | yes · no | no | Foreman | 2026-10-27 | it drops jobs |  <!-- foreman -->',
  '',
  '## Not doing',
  '',
  '- Automatic ticket pickup (needs an event feed Orbit does not have)',
  '- A second **export** format | maybe later',
  '| ORBIT-479.F3 | Keep the old column? | yes · no | yes | Foreman | 2026-10-28 | asked in brief 2 | <!-- foreman -->',
  '',
].join('\n');

test('merge: the Foreman rows (with their section) and the Not doing list are kept verbatim; generated rows are written again', () => {
  const kept = keptParts(FOREMAN_FILE);
  assert.deepEqual(kept.foreman.map((f) => [f.section, f.line.slice(0, 16)]), [[null, '| ORBIT-479.F1 |'], ['work-order-v2', '| ORBIT-479.F2 |'], [null, '| ORBIT-479.F3 |']]);
  assert.deepEqual(kept.notDoing, ['- Automatic ticket pickup (needs an event feed Orbit does not have)', '- A second **export** format | maybe later']);
  const text = render({ prefix: 'ORBIT-479', title: 'Feedback API and MCP', rows: rowsOf(AUDIT), existing: FOREMAN_FILE });
  assert.equal(text.includes('an old generated row'), false);
  assert.equal(text.includes('Some prose'), false);
  for (const line of FOREMAN_FILE.split('\n').filter((l) => /foreman -->|^- /.test(l))) assert.ok(text.split('\n').includes(line.replace(/\s+$/, '')), line);
  const lines = text.split('\n');
  // The Foreman's main-table rows follow the generated ones, inside the table; the section keeps its row.
  assert.ok(lines.indexOf(lines.find((l) => l.startsWith('| ORBIT-479.F1 '))) > lines.indexOf(lines.find((l) => l.startsWith('| ORBIT-479.D8 '))));
  assert.equal(lines[lines.indexOf('## Section: work-order-v2') + 1].slice(0, 16), '| ORBIT-479.F2 |');
  assert.deepEqual(lines.slice(lines.indexOf('## Not doing')).filter(Boolean), ['## Not doing', ...kept.notDoing]);
  // Written again from its own output, nothing changes.
  assert.equal(render({ prefix: 'ORBIT-479', title: 'Feedback API and MCP', rows: rowsOf(AUDIT), existing: text }), text);
});

test('ids stay the same across rewrites: later decisions only add rows', () => {
  const first = render({ prefix: 'ORBIT-479', rows: rowsOf(AUDIT.slice(0, 6)) });
  const later = render({ prefix: 'ORBIT-479', rows: rowsOf(AUDIT), existing: first });
  const ids = (t) => t.split('\n').filter((l) => /^\| ORBIT-479\.D/.test(l));
  assert.deepEqual(ids(later).slice(0, ids(first).length), ids(first));
  assert.ok(ids(later).length > ids(first).length);
});

test('writeDecisionsFile: written in the job folder from the audit, status.json ticket and briefs; Foreman rows survive; never through a link', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'decisions-'));
  try {
    const dir = path.join(root, 'feedback-api');
    await fs.mkdir(path.join(dir, 'briefs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'status.json'), JSON.stringify({ title: 'Feedback API and MCP', ticket: { key: 'ORBIT-479' } }));
    await fs.writeFile(path.join(dir, 'briefs', '001-clarify.md'), '# brief');
    await fs.writeFile(path.join(dir, 'briefs', '001-clarify-detail.md'), '# detail');
    const auditFile = path.join(root, 'audit.jsonl');
    const lines = AUDIT.map((e) => ({ ...e, featureDir: dir }));
    lines.push({ at: '2026-10-28T09:00:00Z', action: 'send', kind: 'approve', featureDir: path.join(root, 'other'), text: 'I approve.' });
    await fs.writeFile(auditFile, lines.map((e) => JSON.stringify(e)).join('\n') + '\n');

    const a = await writeDecisionsFile(dir, { auditFile, person: 'Vignesh' });
    assert.equal(a.changed, true);
    const text = await fs.readFile(path.join(dir, 'decisions.md'), 'utf8');
    assert.equal(text, a.text);
    assert.equal(text.split('\n')[0], '# ORBIT-479 · Feedback API and MCP');
    assert.ok(text.includes('| ORBIT-479.D3 | Brief 1 (clarify): go ahead? |'));
    assert.equal((text.match(/^\| ORBIT-479\.D/gm) ?? []).length, 8, 'the other job’s line is not in this file');

    // The Foreman adds a row and a not-doing item; a later gate writes the file again.
    await fs.writeFile(path.join(dir, 'decisions.md'), text.replace('\n\n## Not doing\n', '\n| ORBIT-479.F1 | Per office? | yes · no | yes | Foreman | 2026-10-28 | offices differ | <!-- foreman -->\n\n## Not doing\n- CSV import\n'));
    const audit2 = [...lines.slice(0, -1), { at: '2026-10-28T10:00:00Z', action: 'send', kind: 'approve', gateBrief: 3, featureDir: dir, text: 'I approve. Go ahead with the next stage you proposed.' }];
    const b = await writeDecisionsFile(dir, { audit: audit2, person: 'Vignesh' });
    assert.ok(b.text.includes('| ORBIT-479.D9 | Brief 3: go ahead? |'));
    assert.ok(b.text.includes('| ORBIT-479.F1 | Per office? | yes · no | yes | Foreman | 2026-10-28 | offices differ | <!-- foreman -->'));
    assert.ok(b.text.endsWith('## Not doing\n- CSV import\n'));
    assert.equal((await writeDecisionsFile(dir, { audit: audit2, person: 'Vignesh' })).changed, false);

    // A link in place of the file, or no folder at all: nothing written.
    const linked = path.join(root, 'linked');
    await fs.mkdir(linked);
    await fs.writeFile(path.join(root, 'target.md'), 'keep me');
    await fs.symlink(path.join(root, 'target.md'), path.join(linked, 'decisions.md'));
    assert.equal(await writeDecisionsFile(linked, { audit: audit2, person: 'V' }), null);
    assert.equal(await fs.readFile(path.join(root, 'target.md'), 'utf8'), 'keep me');
    assert.equal(await writeDecisionsFile(path.join(root, 'gone'), { audit: [], person: 'V' }), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('copy for the ticket: plain text with the pipes, no notes to agents, at most 40 lines (the last ones, said so)', () => {
  const text = render({ prefix: 'ORBIT-479', title: 'Feedback API and MCP', rows: rowsOf(AUDIT), existing: FOREMAN_FILE });
  const c = ticketCopy(text);
  assert.equal(c.cut, false);
  assert.equal(c.text.split('\n')[0], '# ORBIT-479 · Feedback API and MCP');
  assert.equal(/<!--/.test(c.text), false);
  assert.ok(c.text.includes('| ORBIT-479.F1 | Store feedback per office? | yes · no | yes | Foreman | 2026-10-27 | the spec says offices differ |\n'));
  assert.ok(c.text.includes('| id | question | options | choice | who | when | why |'));
  assert.ok(c.text.endsWith('- A second **export** format | maybe later'));
  assert.equal(c.lines, c.text.split('\n').length);
  assert.ok(c.lines <= 40);

  const many = Array.from({ length: 60 }, (_, i) => ({ at: `2026-10-27T10:${String(i).padStart(2, '0')}:00Z`, action: 'send', kind: 'approve', gateBrief: i + 1, text: 'I approve.' }));
  const long = ticketCopy(render({ prefix: 'ORBIT-479', rows: rowsOf(many) }));
  assert.equal(long.cut, true);
  assert.equal(long.lines, 40);
  assert.ok(long.total > 40);
  assert.ok(long.text.endsWith('## Not doing'));
  assert.ok(long.text.split('\n').includes('| ORBIT-479.D60 | Brief 60: go ahead? | approve · send back · stop | approve | Vignesh | 2026-10-27 |  |'));
});
