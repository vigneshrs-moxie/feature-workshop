import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refsFrom } from '../lib/doc-refs.js';

const docs = [
  { file: 'review/errors.md', name: 'Errors lens', text: '# Errors lens\n\n## R-2 (major): the file name’s date\n\nThe name is built from the server’s clock, so after 5pm in California it names tomorrow.\n\n```js\nconst x = 1;\n```\n' },
  { file: 'spec.md', name: 'Spec', text: '| ID | Requirement |\n|---|---|\n| FR-002 | The export button sits next to the widgets table heading. |\n\nAC-002: clicking Export downloads `widgets-YYYY-MM-DD.csv`.\n\nFix R-2 and R-3 now?\n' },
];

test('a heading, a table row and a line define an id; a mention does not', () => {
  const refs = refsFrom({ docs });
  assert.deepEqual(refs['R-2'], { id: 'R-2', title: 'the file name’s date', text: 'Major · the file name’s date. The name is built from the server’s clock, so after 5pm in California it names tomorrow.', where: { kind: 'doc', id: 'review/errors.md', name: 'Errors lens' } });
  assert.equal(refs['FR-002'].title, 'The export button sits next to the widgets table heading');
  assert.equal(refs['AC-002'].text, 'clicking Export downloads widgets-YYYY-MM-DD.csv.');
  assert.equal(refs['R-3'], undefined, 'a mention is not a definition');
});

test('decisions and findings rows define ids too; documents win over findings', () => {
  const refs = refsFrom({
    docs,
    decided: [{ id: 'D-005', decision: 'Export is limited to 10,000 rows', reason: 'investigation found no paging' }],
    findings: [{ text: 'R-3: the limit message isn’t announced to screen readers.', severity: 'major' }, { text: 'R-2: something else', severity: 'minor' }],
  });
  assert.equal(refs['D-005'].text, 'Export is limited to 10,000 rows — investigation found no paging');
  assert.equal(refs['D-005'].where.kind, 'decisions');
  assert.equal(refs['R-3'].text, 'Major · the limit message isn’t announced to screen readers.');
  assert.equal(refs['R-2'].where.id, 'review/errors.md');
});

test('ticket keys and plan step tags are not ids; json documents are skipped', () => {
  const refs = refsFrom({ docs: [{ file: 'a.md', text: '## ORBIT-906: the job\n- S2: a plan step\n' }, { file: 'b.json', type: 'json', text: '{"x":"FR-001: no"}' }] });
  assert.deepEqual(refs, {});
});

test('the job page item `refs` holds the meanings, read from the documents, decisions and findings', async () => {
  const { itemSources } = await import('../lib/job-payload-cache.js');
  const sources = itemSources({ payload: { steps: [], thread: [] }, docs, decided: [{ id: 'D-005', decision: 'Export is limited to 10,000 rows' }], page: { review: { rows: [{ text: 'R-3: not announced', severity: 'major', status: 'open' }] } }, render: (t) => t });
  const refs = sources.get('refs');
  assert.equal(refs.kind, 'refs');
  assert.deepEqual(Object.keys(refs.meta.refs).sort(), ['AC-002', 'D-005', 'FR-002', 'R-2', 'R-3']);
});

test('a decision carries the meanings of the ids it mentions, and only those', async () => {
  const { mentionedRefs } = await import('../lib/doc-refs.js');
  const refs = refsFrom({ docs });
  const move = { ask: 'Review done', questions: [{ text: 'Fix R-2 now?', options: [{ label: 'Yes, per AC-002', consequence: null }, { label: 'No', consequence: 'R-9 stays open' }] }] };
  assert.deepEqual(Object.keys(mentionedRefs(refs, move)).sort(), ['AC-002', 'R-2']);
  assert.equal(mentionedRefs(refs, { ask: 'Go on?', questions: [] }), null);
});

test('a review table row takes its words for a title, and `## R-3 · An empty table` is a heading definition', () => {
  const refs = refsFrom({ docs: [{ file: 'review.md', text: '| ID | Severity | Lens | Finding |\n|---|---|---|---|\n| R-3 | major | tests | No test for an empty widgets table (AC-001) |\n\n## R-4 · An empty table\n\nThe export throws on no rows.\n' }] });
  assert.equal(refs['R-3'].title, 'No test for an empty widgets table (AC-001)');
  assert.equal(refs['R-3'].text, 'major · tests · No test for an empty widgets table (AC-001)');
  assert.equal(refs['R-4'].title, 'An empty table');
});
