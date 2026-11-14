// The notes block (job page rebuild, Task 17, R4 "Point, then say"): what the page sends when he has
// pointed at places and left notes. The text is fixed exactly: the Foreman reads it
// (claude-feature-workflow common/skills/workflow-common/notes-and-comments.md), and the web page
// shows it under `Show what will be sent` from the same module (web imports this file).
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeNotes, cutQuote, explainedAnswer, NOTE_KINDS, pinPlace, QUOTE_MAX } from '../lib/notes-block.js';

const SAMPLE = [
  { kind: 'change', place: 'Plan v2 · step 4 "Add the filter to the table"', quote: 'the words he pointed at, at most 300 characters', note: 'use the existing badge' },
  { kind: 'drop', place: 'Spec v3 · acceptance line 6', quote: '…' },
  { kind: 'pin', place: 'Recording 0:14', pin: { n: 1, x: 62, y: 18 }, note: 'the Apply button sits on top of the table' },
];

const EXACT = [
  '--- Notes (3) ---',
  '1. [change] Plan v2 · step 4 "Add the filter to the table"',
  '   > the words he pointed at, at most 300 characters',
  '   Note: use the existing badge',
  '2. [drop] Spec v3 · acceptance line 6',
  '   > …',
  '3. [pin] Recording 0:14 · pin 1 at 62% across, 18% down',
  '   Note: the Apply button sits on top of the table',
  '--- End of notes ---',
].join('\n');

test('three notes make the block exactly, character for character', () => {
  assert.equal(composeNotes({ notes: SAMPLE }), EXACT);
  assert.equal(composeNotes({ notes: SAMPLE, words: '' }), EXACT);
  assert.equal(composeNotes({ notes: SAMPLE, words: '  \n ' }), EXACT);
});

test('his typed words follow the block after one blank line, kept as he wrote them (trimmed)', () => {
  assert.equal(composeNotes({ notes: SAMPLE, words: '  Also keep the old export.\nThanks  ' }), `${EXACT}\n\nAlso keep the old export.\nThanks`);
});

test('no notes: only his words, no block', () => {
  assert.equal(composeNotes({ notes: [], words: ' Hello there ' }), 'Hello there');
  assert.equal(composeNotes({ words: 'Hi' }), 'Hi');
  assert.equal(composeNotes({}), '');
});

test('the pointed words are cut at 300 characters, the cut marked with an ellipsis inside the 300', () => {
  const long = 'x'.repeat(320);
  const out = composeNotes({ notes: [{ kind: 'change', place: 'Spec v1 · paragraph 2', quote: long, note: 'shorter' }] });
  const q = out.split('\n')[2];
  assert.equal(q.slice(0, 5), '   > ');
  assert.equal(q.slice(5).length, QUOTE_MAX);
  assert.equal(q.slice(5), `${'x'.repeat(299)}…`);
  assert.equal(cutQuote('y'.repeat(300)), 'y'.repeat(300));
  assert.equal(cutQuote('y'.repeat(301)).length, 300);
});

test('a line break inside the words, the place or the note never breaks the block: it is one line each', () => {
  const out = composeNotes({ notes: [{ kind: 'change', place: 'Plan v2 ·\n step 4', quote: 'first line\n\nsecond   line', note: 'one\ntwo' }] });
  assert.equal(out, [
    '--- Notes (1) ---',
    '1. [change] Plan v2 · step 4',
    '   > first line second line',
    '   Note: one two',
    '--- End of notes ---',
  ].join('\n'));
});

test('drop and explain carry no Note line when there are no words; empty pointed words carry no > line', () => {
  const out = composeNotes({ notes: [
    { kind: 'drop', place: 'Spec v3 · acceptance line 6', quote: '', note: '' },
    { kind: 'explain', place: 'EmployeesTable.tsx:88 (commit abc1234)', quote: 'const badge = small;' },
  ] });
  assert.equal(out, [
    '--- Notes (2) ---',
    '1. [drop] Spec v3 · acceptance line 6',
    '2. [explain] EmployeesTable.tsx:88 (commit abc1234)',
    '   > const badge = small;',
    '--- End of notes ---',
  ].join('\n'));
});

test('a pin names its picture and where on it, from the picture’s top left, in whole per cent', () => {
  assert.equal(pinPlace('Recording AC-3 at 0:14 (evidence/ac-3.webm)', { n: 2, x: 61.6, y: 18.2 }), 'Recording AC-3 at 0:14 (evidence/ac-3.webm) · pin 2 at 62% across, 18% down');
  assert.equal(pinPlace('Pasted picture 1', { n: 1, x: -3, y: 140 }), 'Pasted picture 1 · pin 1 at 0% across, 100% down');
});

test('the kinds are the four the Foreman knows; an unknown kind is refused, not sent', () => {
  assert.deepEqual(NOTE_KINDS, ['change', 'drop', 'explain', 'pin']);
  assert.throws(() => composeNotes({ notes: [{ kind: 'remove', place: 'x' }] }), /kind/);
});

test('explainedAnswer reads the answer of an explain note from the end of the Foreman’s reply', () => {
  const reply = [
    'The filter lives in the table header because the office sorts first.',
    '',
    '--- Notes answered ---',
    '1. done · explained · It sits there so the office can sort before it filters.',
    '--- End ---',
  ].join('\n');
  assert.equal(explainedAnswer(reply), 'It sits there so the office can sort before it filters.');
  assert.equal(explainedAnswer('A reply with no block.'), null);
  assert.equal(explainedAnswer('--- Notes answered ---\n1. not done · step 4 is no longer in Plan v3\n--- End ---'), null);
  assert.equal(explainedAnswer(null), null);
});
