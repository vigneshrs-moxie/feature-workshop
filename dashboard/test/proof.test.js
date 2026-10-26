// The gate card's proof stamp (lib/proof.js): the tested commit from the test report, stale when the head moved.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proofStamp, testedCommit } from '../lib/proof.js';

test('reads the commit under test in each shape the tester writes', () => {
  assert.equal(testedCommit('| **Branch / commit under test** | feature/field-ops-damage-list · b32026b6 (worktree …) |'), 'b32026b6');
  assert.equal(testedCommit('| **Branch / commit under test** | feature/x · a6889a78 (S1 c2b38b4b) · base moxie/main 1f2c9ab1 |'), 'a6889a78');
  assert.equal(testedCommit('- **Branch / commit under test:** `feature/announcements-v1` at `5d3f1d0` (base `moxie/main @ e6d7422`)'), '5d3f1d0');
  assert.equal(testedCommit('No commit named here.'), null);
});

test('stale when the branch head is another commit; unknown head is not stale', () => {
  const reportText = '- commit under test: `5d3f1d0`';
  assert.deepEqual(proofStamp({ reportText, head: '5d3f1d0aaaa' }), { tested: '5d3f1d0', head: '5d3f1d0aaaa', stale: false, reportAt: null });
  assert.equal(proofStamp({ reportText, head: '9999999bbbb' }).stale, true);
  assert.equal(proofStamp({ reportText }).stale, false);
  assert.equal(proofStamp({ reportText: '' }), null);
});
