// The Foreman's answer to his notes (job page rebuild, Task 18, R5 "See the answer to each request"):
// the `--- Notes answered ---` block at the very end of its final message (the skills'
// workflow-common notes-and-comments.md), the notes block he sent read back, and the reply the audit
// keeps so the block survives the audit's cut. The text is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { composeNotes, keptReply, parseAnswered, parseNotes, REPLY_KEPT } from '../lib/notes-block.js';

const BLOCK = [
  '--- Notes answered ---',
  '1. done · Plan v3 · step 4 removed',
  '2. done · commit abc1234 · EmployeesTable.tsx',
  '3. not done · the badge component has no small size',
  '--- End ---',
].join('\n');

const THREE = [
  { n: 1, done: true, explained: false, where: 'Plan v3', what: 'step 4 removed' },
  { n: 2, done: true, explained: false, where: 'commit abc1234', what: 'EmployeesTable.tsx' },
  { n: 3, done: false, explained: false, where: null, what: 'the badge component has no small size' },
];

test('parseAnswered reads the block at the end of the reply, one answer per line', () => {
  assert.deepEqual(parseAnswered(`I made the changes.\n\n${BLOCK}`), THREE);
});

test('parseAnswered is forgiving about spacing: around the dots, before the numbers, at the ends of the fence lines', () => {
  const loose = [
    'Done.',
    '  --- Notes answered ---   ',
    '1.done·Plan v3 ·   step 4 removed',
    '   2.   done  ·commit abc1234·EmployeesTable.tsx  ',
    '',
    '3. not  done · the badge component has no small size',
    '--- End ---  ',
  ].join('\n');
  assert.deepEqual(parseAnswered(loose), THREE);
  // Windows line ends too.
  assert.deepEqual(parseAnswered(BLOCK.replace(/\n/g, '\r\n')), THREE);
});

test('parseAnswered is strict about the fence lines: a misspelt fence, or no end fence, is no block', () => {
  for (const bad of [
    BLOCK.replace('--- Notes answered ---', '-- Notes answered --'),
    BLOCK.replace('--- Notes answered ---', '--- notes answered ---'),
    BLOCK.replace('--- Notes answered ---', '--- Notes Answered ---'),
    BLOCK.replace('--- Notes answered ---', 'Notes answered:'),
    BLOCK.replace('--- End ---', '--- end ---'),
    BLOCK.replace('--- End ---', '--- End of notes ---'),
    BLOCK.replace('\n--- End ---', ''),
    // A fence inside a sentence is not a fence line.
    `He said --- Notes answered --- once.\n1. done · Plan v3 · step 4 removed\n--- End ---`,
  ]) assert.deepEqual(parseAnswered(bad), [], bad);
});

test('parseAnswered: a reply without the block, an empty one or no reply at all gives no answers', () => {
  assert.deepEqual(parseAnswered('A reply with no block.'), []);
  assert.deepEqual(parseAnswered('--- Notes answered ---\n--- End ---'), []);
  assert.deepEqual(parseAnswered(''), []);
  assert.deepEqual(parseAnswered(null), []);
  assert.deepEqual(parseAnswered(undefined), []);
});

test('parseAnswered: an explain note’s line carries the answer itself; lines that are not answers are left out', () => {
  const reply = [
    '--- Notes answered ---',
    '1. done · explained · It sits there so the office can sort before it filters · then it counts.',
    'A stray sentence the Foreman should not have written.',
    '2. done · Spec v4',
    '3. not done',
    '--- End ---',
  ].join('\n');
  assert.deepEqual(parseAnswered(reply), [
    { n: 1, done: true, explained: true, where: null, what: 'It sits there so the office can sort before it filters · then it counts.' },
    { n: 2, done: true, explained: false, where: 'Spec v4', what: '' },
    { n: 3, done: false, explained: false, where: null, what: '' },
  ]);
});

test('parseAnswered: the comments block before the notes block does not confuse it (both end with --- End ---)', () => {
  const reply = [
    'Fixed both comments and your three notes.',
    '',
    '--- Comments answered ---',
    'c901 · fixed in a1b2c3d · reply: Fixed in a1b2c3d: renamed to `feedbackId`.',
    '1. done · this line belongs to the comments block · not to the notes',
    '--- End ---',
    '',
    BLOCK,
  ].join('\n');
  assert.deepEqual(parseAnswered(reply), THREE);
  // A comments block alone is no notes block.
  assert.deepEqual(parseAnswered(reply.slice(0, reply.indexOf('--- Notes answered ---'))), []);
});

test('parseAnswered reads the last notes block when an earlier one is quoted higher up', () => {
  const reply = `Last time I answered:\n--- Notes answered ---\n1. not done · old\n--- End ---\n\nNow:\n${BLOCK}`;
  assert.deepEqual(parseAnswered(reply), THREE);
});

test('parseNotes reads back the notes block composeNotes wrote, with his words after it', () => {
  const notes = [
    { kind: 'change', place: 'Plan v2 · step 4 "Add the filter to the table"', quote: 'the words he pointed at', note: 'use the existing badge' },
    { kind: 'drop', place: 'Spec v3 · acceptance line 6', quote: '…' },
    { kind: 'explain', place: 'Findings · major · Saves twice', quote: null, note: '' },
    { kind: 'pin', place: 'Recording 0:14', pin: { n: 1, x: 62, y: 18 }, note: 'the Apply button sits on top of the table' },
  ];
  const text = composeNotes({ notes, words: 'And keep it small.' });
  assert.deepEqual(parseNotes(text), [
    { n: 1, kind: 'change', place: 'Plan v2 · step 4 "Add the filter to the table"', quote: 'the words he pointed at', note: 'use the existing badge' },
    { n: 2, kind: 'drop', place: 'Spec v3 · acceptance line 6', quote: '…', note: null },
    { n: 3, kind: 'explain', place: 'Findings · major · Saves twice', quote: null, note: null },
    { n: 4, kind: 'pin', place: 'Recording 0:14 · pin 1 at 62% across, 18% down', quote: null, note: 'the Apply button sits on top of the table' },
  ]);
  // Inside an approval's note (gateBody carries his words after its own lines) it is found as well.
  assert.equal(parseNotes(`Approved: go ahead.\n\nNote: ${text}`).length, 4);
  assert.deepEqual(parseNotes('No notes here.'), []);
  assert.deepEqual(parseNotes('--- Notes (1) ---\n1. [change] Plan v2 · step 4'), [], 'no end fence: no block');
  assert.deepEqual(parseNotes(null), []);
});

test('keptReply: a short reply is kept whole; a long one keeps its start and its answer blocks at the end', () => {
  assert.equal(REPLY_KEPT, 8000);
  const short = `Done.\n\n${BLOCK}`;
  assert.equal(keptReply(short), short);
  assert.equal(keptReply(''), '');
  assert.equal(keptReply(null), '');
  // A long reply with no block: cut at the limit, as the audit always did.
  const long = 'word '.repeat(3000);
  assert.equal(keptReply(long), long.slice(0, REPLY_KEPT));
  // A long reply whose blocks are past the cut: the start, a gap mark, then both blocks whole.
  const comments = '--- Comments answered ---\nc901 · fixed in a1b2c3d · reply: Fixed.\n--- End ---';
  const tail = `${comments}\n\n${BLOCK}`;
  const full = `${'The long brief. '.repeat(900)}\n\n${tail}`;
  assert.ok(full.length > REPLY_KEPT && full.slice(0, REPLY_KEPT).indexOf('--- Notes answered ---') < 0, 'the plain cut loses the block');
  const kept = keptReply(full);
  assert.ok(kept.length <= REPLY_KEPT + tail.length + 10, kept.length);
  assert.ok(kept.startsWith('The long brief. '));
  assert.ok(kept.endsWith(tail));
  assert.match(kept, /\n\n…\n\n--- Comments answered ---/);
  assert.deepEqual(parseAnswered(kept), THREE);
  // A block that starts before the cut and ends after it: nothing is lost and nothing is said twice.
  const near = `${'x'.repeat(REPLY_KEPT - 20)}\n\n${BLOCK}`;
  assert.equal(keptReply(near), near);
});

test('parseNotes reads the block a gate reply carries on one line (compose.js puts a Go’s or Send back’s note on one line)', () => {
  const notes = [
    { kind: 'change', place: 'Plan v2 · step 4 "Add the filter to the table"', quote: 'the words he pointed at', note: 'use the existing badge' },
    { kind: 'drop', place: 'Spec v3 · acceptance line 6', quote: '…' },
    { kind: 'explain', place: 'Findings · major · Saves twice', quote: null, note: '' },
  ];
  const flat = composeNotes({ notes, words: 'And keep it small.' }).replace(/\s+/g, ' ');
  const sent = `Please make changes before moving on, and stay in the current stage:\n${flat}`;
  assert.deepEqual(parseNotes(sent), [
    { n: 1, kind: 'change', place: 'Plan v2 · step 4 "Add the filter to the table"', quote: 'the words he pointed at', note: 'use the existing badge' },
    { n: 2, kind: 'drop', place: 'Spec v3 · acceptance line 6', quote: '…', note: null },
    { n: 3, kind: 'explain', place: 'Findings · major · Saves twice', quote: null, note: null },
  ]);
});

test('fix round 1: parseNotes reads the block by its lines: a quote holding `2. [drop]` or `Note:` does not split the note', () => {
  const text = [
    '--- Notes (2) ---',
    '1. [change] Spec v3 · line 4 "A > B, then C"',
    '   > see 2. [drop] x and Note: keep it',
    '   Note: shorter',
    '2. [drop] Spec v3 · line 6',
    '--- End of notes ---',
  ].join('\n');
  assert.deepEqual(parseNotes(text), [
    { n: 1, kind: 'change', place: 'Spec v3 · line 4 "A > B, then C"', quote: 'see 2. [drop] x and Note: keep it', note: 'shorter' },
    { n: 2, kind: 'drop', place: 'Spec v3 · line 6', quote: null, note: null },
  ]);
});

test('fix round 1: the one-line form keeps ` > ` inside a place’s quoted words, `Note:` and the next number inside a quote', () => {
  const notes = [
    { kind: 'change', place: 'Spec v3 · line 4 "A > B, then C"', quote: 'see 2. [drop] x and Note: keep it', note: 'shorter' },
    { kind: 'drop', place: 'Spec v3 · line 6', quote: 'Export > PDF' },
  ];
  const flat = composeNotes({ notes }).replace(/\s+/g, ' ');
  assert.deepEqual(parseNotes(flat), [
    { n: 1, kind: 'change', place: 'Spec v3 · line 4 "A > B, then C"', quote: 'see 2. [drop] x and Note: keep it', note: 'shorter' },
    { n: 2, kind: 'drop', place: 'Spec v3 · line 6', quote: 'Export > PDF', note: null },
  ]);
});

test('fix round 1: keptReply finds the real answer blocks, not a fence quoted earlier in the reply', () => {
  const quoted = 'I will end with a --- Comments answered --- block? No:\n--- Comments answered ---\nquoted here only\n';
  const full = `${quoted}${'Long words. '.repeat(2000)}\n\n${BLOCK}`;
  assert.ok(full.length > REPLY_KEPT + 16000);
  const kept = keptReply(full);
  assert.ok(kept.endsWith(BLOCK));
  assert.deepEqual(parseAnswered(kept), THREE);
});
