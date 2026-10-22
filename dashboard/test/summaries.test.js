// Key points (lib/docs.js): the Foreman's short summary of each document and brief, one small JSON
// file per document and version in the job folder's summaries/. Picking the version, marking a
// stale one, cleaning what the file says, and never following a link out of the folder.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cleanSummary, readSummary, summaryIndex, summaryState, summaryStem } from '../lib/docs.js';

let root, dir, outside;
const put = async (rel, data) => {
  await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await fs.writeFile(path.join(dir, rel), typeof data === 'string' ? data : JSON.stringify(data));
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-summaries-'));
  dir = path.join(root, 'job');
  outside = path.join(root, 'outside');
  await fs.mkdir(outside, { recursive: true });
  await put('summaries/findings.v1.json', { outcome: ['Old findings.'] });
  await put('summaries/findings.v2.json', { outcome: ['The filter lives in TicketList.'], risks: ['Tags query reads all offices.'] });
  await put('summaries/plan.v0.9.json', { outcome: ['Nine.'] });
  await put('summaries/plan.v0.10.json', { outcome: ['Ten.'] });
  await put('summaries/briefs/006-review.json', { outcome: ['7 reviewers; 2 majors.'], decisions: ['Fix R-2 now?'] });
  await put('summaries/spec.v0.3.json', { outcome: ['Spec v0.3.'] });
  await put('summaries/broken.json', '{ not json');
  await put('summaries/empty.json', { outcome: [], risks: 'not a list' });
  await put('summaries/.hidden.json', { outcome: ['Hidden.'] });
  await fs.writeFile(path.join(outside, 'secret.json'), JSON.stringify({ outcome: ['Secret.'] }));
  await fs.symlink(path.join(outside, 'secret.json'), path.join(dir, 'summaries', 'linked.json'));
  await fs.symlink(outside, path.join(dir, 'summaries', 'review'));
});

after(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

test('summaries: the stem is the document’s path without .md/.json', () => {
  assert.equal(summaryStem('findings.md'), 'findings');
  assert.equal(summaryStem('briefs/006-review.md'), 'briefs/006-review');
  assert.equal(summaryStem('spec'), 'spec');
});

test('summaries: the one for the document’s version; else the newest, marked stale', async () => {
  const now = await readSummary(dir, 'findings.md', '2');
  assert.deepEqual(now.outcome, ['The filter lives in TicketList.']);
  assert.deepEqual(now.risks, ['Tags query reads all offices.']);
  assert.equal(now.stale, false);
  assert.equal(now.version, '2');
  const later = await readSummary(dir, 'findings.md', '3');
  assert.equal(later.stale, true, 'v3 has none: v2’s is shown, marked');
  assert.equal(later.version, '2');
  assert.equal((await readSummary(dir, 'findings.md', null)).version, '2', 'no version known: the newest, not stale');
  assert.equal((await readSummary(dir, 'findings.md', null)).stale, false);
  assert.deepEqual((await readSummary(dir, 'plan.md', '0.11')).outcome, ['Ten.'], '0.10 is newer than 0.9');
  assert.deepEqual((await readSummary(dir, 'spec', '0.3')).outcome, ['Spec v0.3.']);
});

test('summaries: briefs have no version; a plain string decision has no recommendation', async () => {
  const s = await readSummary(dir, 'briefs/006-review.md', null);
  assert.deepEqual(s.decisions, [{ text: 'Fix R-2 now?', recommendation: null }]);
  assert.equal(s.version, null);
});

test('summaries: none, broken, empty, hidden or linked is null', async () => {
  assert.equal(await readSummary(dir, 'notes.md', null), null);
  assert.equal(await readSummary(dir, 'broken.md', null), null);
  assert.equal(await readSummary(dir, 'empty.md', null), null);
  assert.equal(await readSummary(dir, '.hidden.md', null), null);
  assert.equal(await readSummary(dir, 'linked.md', null), null);
  const index = await summaryIndex(dir);
  assert.ok(![...index.keys()].some((k) => k.startsWith('review/')), 'a symlinked folder is not followed');
  assert.equal(await readSummary(path.join(root, 'no-such-job'), 'findings.md', '1'), null);
});

test('summaries: the list mark is current, stale or null', async () => {
  const index = await summaryIndex(dir);
  assert.equal(summaryState(index, 'findings.md', '2'), 'current');
  assert.equal(summaryState(index, 'findings.md', '5'), 'stale');
  assert.equal(summaryState(index, 'notes.md', null), null);
});

test('summaries: cleaning keeps four parts of at most three short lines and drops the rest', () => {
  const long = 'x'.repeat(400);
  const s = cleanSummary({ outcome: ['a', ' b ', '', 'c', 'd'], risks: [long, 7], decisions: [{ text: 'q', recommendation: 'r', extra: 1 }, { nope: 1 }], changed: 'not a list', html: '<script>' });
  assert.deepEqual(s.outcome, ['a', 'b', 'c']);
  assert.equal(s.risks.length, 1);
  assert.ok(s.risks[0].length <= 240 && s.risks[0].endsWith('…'));
  assert.deepEqual(s.decisions, [{ text: 'q', recommendation: 'r' }]);
  assert.deepEqual(s.changed, []);
  assert.ok(!('html' in s));
  assert.equal(cleanSummary(null), null);
  assert.equal(cleanSummary([]), null);
  assert.equal(cleanSummary({ outcome: [] }), null);
});
