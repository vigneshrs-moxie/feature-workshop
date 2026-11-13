// The made-up long job (test/fixtures/long-job.js): its counts are what the job page rebuild's
// Task 2 says, for both sizes, so later tests and the speed checks can rely on them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LONG_JOB, LONG_JOB_COUNTS, SIZES, longJobFacts, longJobPage, longJobSource, wordCount } from './fixtures/long-job.js';

const pages = Object.fromEntries(SIZES.map((size) => [size, longJobPage({ size })]));
const step = (p, id) => p.payload.steps.find((s) => s.id === id);

test('the two sizes are the 52-item job and one four times as long (200 items)', () => {
  assert.deepEqual(SIZES, [52, 200]);
  const [a, b] = [LONG_JOB_COUNTS[52], LONG_JOB_COUNTS[200]];
  assert.deepEqual({ items: a.items, replies: a.replies, you: a.you, briefs: a.briefs, small: a.small }, { items: 52, replies: 16, you: 16, briefs: 15, small: 5 });
  assert.equal(b.items, 200);
  assert.equal(b.briefs, 4 * a.briefs);
  assert.equal(b.small, 4 * a.small);
  for (const k of ['reviewFiles', 'findings', 'commits', 'commitFiles', 'longestReplies', 'checks', 'decisions']) assert.equal(b[k], 4 * a[k], k);
  for (const k of ['steps', 'recordings', 'prs', 'replyMedianWords', 'replyMaxWords']) assert.equal(b[k], a[k], k);
  assert.notEqual(LONG_JOB[52].slug, LONG_JOB[200].slug);
});

for (const size of SIZES) {
  const c = LONG_JOB_COUNTS[size];

  test(`${size}: the conversation has ${c.items} items: ${c.replies} replies, ${c.you} of his messages, ${c.briefs} briefs, ${c.small} small notes`, () => {
    const p = pages[size];
    assert.equal(p.facts.thread.length, c.items);
    assert.equal(p.payload.thread.length, c.items);
    assert.equal(p.payload.rows.conversation.count, c.items);
    const kinds = {};
    for (const l of p.payload.thread) kinds[l.kind] = (kinds[l.kind] ?? 0) + 1;
    assert.deepEqual(kinds, { you: c.you, brief: c.briefs, reply: c.replies, small: c.small });
    assert.equal(new Set(p.payload.thread.map((l) => l.id)).size, c.items, 'every id once');
    const ats = p.payload.thread.map((l) => l.at);
    assert.ok(ats.every((t) => typeof t === 'string'), 'every line has a time');
    assert.deepEqual([...ats].sort(), ats, 'oldest first');
  });

  test(`${size}: replies have a median of ${c.replyMedianWords} words and ${c.longestReplies} of ${c.replyMaxWords}`, () => {
    const words = pages[size].facts.thread.filter((it) => it.kind === 'reply').map((it) => wordCount(it.reply)).sort((a, b) => a - b);
    assert.equal(words.length, c.replies);
    assert.equal((words[words.length / 2 - 1] + words[words.length / 2]) / 2, c.replyMedianWords);
    assert.equal(words.at(-1), c.replyMaxWords);
    assert.equal(words.filter((w) => w === c.replyMaxWords).length, c.longestReplies);
    assert.ok(words[0] >= 200, 'no short replies');
  });

  test(`${size}: seven steps, at Review with the gate open on the last brief`, () => {
    const p = pages[size];
    assert.equal(p.payload.steps.length, c.steps);
    assert.deepEqual(p.payload.steps.map((s) => s.id), ['spec', 'investigate', 'plan', 'build', 'test', 'review', 'ship']);
    assert.deepEqual(p.payload.steps.map((s) => s.state), ['done', 'done', 'done', 'done', 'done', 'current', 'todo']);
    assert.equal(p.payload.state, 'needs-you');
    assert.equal(p.payload.move.kind, 'gate');
    assert.equal(p.payload.move.brief, c.briefs);
    assert.equal(p.payload.move.goSays, 'open PR #1');
    assert.equal(p.payload.move.questions.length, 2);
    assert.equal(p.payload.rows.decisions.count, c.decisions);
    assert.deepEqual(p.payload.open, { kind: 'brief', id: `brief:briefs/${String(c.briefs).padStart(3, '0')}-review.md` });
    const briefs = p.payload.thread.filter((l) => l.kind === 'brief');
    assert.equal(briefs.at(-1).answered, false, 'the gate’s brief waits');
    assert.ok(briefs.slice(0, -1).every((l) => l.answered === 'Go' || l.answered === 'Send back'), 'every other brief was answered from its gate');
    assert.ok(briefs.some((l) => l.answered === 'Send back'));
  });

  test(`${size}: ${c.reviewFiles} review files, of which the latest of each kind shows (${c.reviewShown})`, () => {
    const p = pages[size];
    const files = p.facts.detail.page.docs.review.map((d) => d.file);
    assert.equal(files.length, c.reviewFiles);
    assert.equal(new Set(files).size, files.length);
    const shown = step(p, 'review').outputs.filter((o) => o.kind === 'doc').map((o) => o.id);
    assert.equal(shown.length, c.reviewShown);
    assert.ok(shown.includes('review.md'));
    assert.ok(!shown.some((f) => f.startsWith('briefs/')), 'briefs are in the conversation, not the step');
    // Each lens's highest round is the one shown.
    const round = (f) => Number(/-r(\d+)\.md$/.exec(f)?.[1] ?? 1);
    const lens = (f) => f.replace(/^review\//, '').replace(/(-r\d+)?\.md$/, '');
    for (const f of files.filter((x) => x.startsWith('review/'))) {
      const best = Math.max(...files.filter((x) => x.startsWith('review/') && lens(x) === lens(f)).map(round));
      assert.equal(shown.includes(f), round(f) === best, f);
    }
    assert.ok(files.some((f) => /-r[2-9]\.md$/.test(f)), 'some lenses have later rounds');
  });

  test(`${size}: ${c.findings} findings, ${c.findingsOpen} open`, () => {
    const p = pages[size];
    const rows = p.facts.detail.page.review.rows;
    assert.equal(rows.length, c.findings);
    assert.equal(rows.filter((r) => r.status === 'open').length, c.findingsOpen);
    assert.equal(rows.filter((r) => r.status === 'fixed').length, c.findings - c.findingsOpen);
    assert.equal(step(p, 'review').word, `${c.findingsOpen} open`);
  });

  test(`${size}: ${c.commits} commits over ${c.commitFiles} files, every plan step built`, () => {
    const p = pages[size];
    assert.equal(p.facts.commits, c.commits);
    assert.equal(p.commits.length, c.commits);
    assert.equal(new Set(p.commits.flatMap((x) => x.files.map((f) => f.path))).size, c.commitFiles);
    assert.equal(new Set(p.commits.map((x) => x.sha)).size, c.commits);
    assert.ok(p.commits.every((x) => /^[0-9a-f]{40}$/.test(x.sha) && x.short === x.sha.slice(0, 8)));
    assert.equal(step(p, 'build').word, `${c.commits} commits`);
    const plan = p.facts.detail.page.plan;
    assert.equal(plan.steps.length, c.planSteps);
    assert.ok(plan.steps.every((s) => s.state === 'done'));
  });

  test(`${size}: one recording, ${c.checks} checks passed, three PRs not started`, () => {
    const p = pages[size];
    const test = step(p, 'test');
    assert.equal(test.outputs.filter((o) => o.kind === 'recording').length, c.recordings);
    assert.equal(p.facts.evidence.evidence.criteria.length, c.checks);
    assert.equal(test.word, `${c.checks} passed`);
    assert.equal(p.payload.prs.length, c.prs);
    assert.deepEqual(p.payload.prs.map((x) => x.state), ['not-started', 'not-started', 'not-started']);
    assert.equal(step(p, 'ship').outputs.filter((o) => o.kind === 'pr').length, c.prs);
  });

  test(`${size}: one body per conversation line and per document a step shows, in the item route’s shape`, () => {
    const p = pages[size];
    const docIds = [...new Set(p.payload.steps.flatMap((s) => s.outputs.filter((o) => o.kind === 'doc').map((o) => o.id)))];
    assert.deepEqual(Object.keys(p.bodies).sort(), [...p.payload.thread.map((l) => l.id), ...docIds].sort());
    for (const [id, b] of Object.entries(p.bodies)) {
      assert.deepEqual(Object.keys(b), ['id', 'kind', 'html', 'text', 'meta'], id);
      assert.equal(b.id, id);
      assert.ok(b.text.trim() && b.html.trim(), id);
    }
    for (const l of p.payload.thread) {
      assert.equal(p.bodies[l.id].kind, l.kind);
      assert.equal(p.bodies[l.id].meta.hash, l.hash);
    }
    const reply = p.payload.thread.find((l) => l.kind === 'reply');
    assert.match(p.bodies[reply.id].html, /^<p><strong>/, 'a reply opens with its bold sentence');
  });

  test(`${size}: the same every time`, () => {
    assert.deepEqual(longJobPage({ size }), pages[size]);
    assert.deepEqual(longJobSource({ size }).audit, longJobSource({ size }).audit);
    // Another start moves only the times.
    const later = longJobFacts({ size, start: '2026-12-01T09:00:00.000Z' });
    assert.deepEqual(later.thread.map((it) => it.kind), pages[size].facts.thread.map((it) => it.kind));
    assert.notEqual(later.thread[0].at, pages[size].facts.thread[0].at);
  });
}

// ---------- The web's copy (web/src/jobpage/fixtures, written by fixtures/write-long-job.js) ----------

test('the web’s long job files are what the server fixture writes now (run node dashboard/test/fixtures/write-long-job.js)', async () => {
  const { WEB_FILES, WEB_FIXTURES, webFixture } = await import('./fixtures/write-long-job.js');
  const fs = await import('node:fs');
  const path = await import('node:path');
  for (const size of SIZES) {
    const file = path.join(WEB_FIXTURES, WEB_FILES[size]);
    assert.ok(fs.existsSync(file), `${WEB_FILES[size]} is written`);
    assert.ok(fs.readFileSync(file, 'utf8') === webFixture(size), `${WEB_FILES[size]} is out of date: run node dashboard/test/fixtures/write-long-job.js`);
  }
});

test('the web’s long job says nothing the web source checks refuse (the product name, old names, native controls, text arrows)', async () => {
  const { webFixture } = await import('./fixtures/write-long-job.js');
  for (const size of SIZES) {
    const text = webFixture(size);
    // web/src/app/brand.test.ts, dashboard/test/old-names.test.js, web/src/theme/nativeLook.test.ts, tokenCoverage.test.ts.
    assert.doesNotMatch(text, /Starbase|Feature Workshop|Ground Control|feature-workshop|ground-control|\bDashboard\b/);
    assert.doesNotMatch(text, /<select[\s>]|<datalist[\s>]|<title>|[▸▾▴▹▿]|['"]--[a-z]/);
    assert.doesNotMatch(text, /sk_live|sk_test|ghp_|BEGIN [A-Z ]*PRIVATE KEY/);
  }
});
