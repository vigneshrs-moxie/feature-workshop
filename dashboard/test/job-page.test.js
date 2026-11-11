// The job page's overview (Part 3, Task 1): what acceptance.md says the job is checked against.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readAcceptance } from '../lib/job-page.js';

test('readAcceptance reads both lists and drops the FR brackets', () => {
  const text = [
    '# Acceptance criteria',
    '',
    '## It works when',
    '1. A manager can add a note on any customer. (FR-001)',
    '',
    '## It must not',
    '1. Show notes to techs. (FR-004)',
    '2. Slow down the customer list.',
    '',
    '## Notes',
    '1. Not a check.',
  ].join('\n');
  assert.deepEqual(readAcceptance(text), {
    worksWhen: ['A manager can add a note on any customer.'],
    mustNot: ['Show notes to techs.', 'Slow down the customer list.'],
  });
  // One heading alone gives the other list empty.
  assert.deepEqual(readAcceptance('## It must not\n1. Lose a note. (FR-002, FR-003)\n'), { worksWhen: [], mustNot: ['Lose a note.'] });
});

test('a file with neither heading is null', () => {
  assert.equal(readAcceptance('# Acceptance criteria\n\nAC-001: it does what the request says.\n'), null);
  assert.equal(readAcceptance(''), null);
  assert.equal(readAcceptance(null), null);
});
