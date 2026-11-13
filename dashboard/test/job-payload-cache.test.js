// The new job page's warm cache (lib/job-payload-cache.js, the job page rebuild, Task 4): one payload
// per job, rebuilt when the runner sees the job change (debounced 150 ms, at most 1 s behind a stream
// of changes), never on a request; `v` moves only when the payload's JSON really changed; a body is
// rendered once and kept until its version changes. The builds here are made up: no runner, no I/O.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { jobPageCache, itemSources, REBUILD_DELAY_MS, REBUILD_MAX_WAIT_MS, OPEN_MS } from '../lib/job-payload-cache.js';
import { longJobPage } from './fixtures/long-job.js';
import { renderMarkdown } from '../lib/markdown.js';

const settle = () => new Promise((r) => { setImmediate(r); });
const settled = async () => { for (let i = 0; i < 5; i++) await settle(); };

/** A made-up job store: build(slug) answers its current payload and one body per item; counts builds and renders. */
function store() {
  const jobs = new Map();
  const s = { jobs, builds: 0, renders: 0 };
  s.set = (slug, payload, bodies = {}) => jobs.set(slug, { payload, bodies });
  s.build = async (slug) => {
    s.builds++;
    const j = jobs.get(slug);
    if (!j) return null;
    const sources = new Map(Object.entries(j.bodies).map(([id, b]) => [id, { kind: b.kind ?? 'brief', version: b.version, text: b.text, meta: b.meta ?? {}, html: () => { s.renders++; return `<p>${b.text}</p>`; } }]));
    return { payload: structuredClone(j.payload), sources };
  };
  return s;
}

const payloadOf = (title, extra = {}) => ({ v: 0, slug: 'job-a', title, state: 'working', thread: [], ...extra });

test('v stays when a rebuild gives the same JSON, and goes up by one when it changes; the event only on a change', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const s = store();
  const told = [];
  const cache = jobPageCache({ build: s.build, onVersion: (slug, v) => told.push([slug, v]) });
  try {
    s.set('job-a', payloadOf('First'));
    const first = await cache.page('job-a');
    assert.equal(first.v, 1);
    assert.equal(first.title, 'First');
    assert.deepEqual(told, [['job-a', 1]]);
    // A change point with nothing really changed: rebuilt, same JSON, same v, no event.
    cache.touch('job-a');
    mock.timers.tick(REBUILD_DELAY_MS);
    await settled();
    assert.equal(s.builds, 2);
    assert.equal((await cache.page('job-a')).v, 1);
    assert.deepEqual(told, [['job-a', 1]]);
    // The payload builder's own v (the facts') does not count as a change.
    s.set('job-a', payloadOf('First', { v: 7 }));
    cache.touch('job-a');
    mock.timers.tick(REBUILD_DELAY_MS);
    await settled();
    assert.equal((await cache.page('job-a')).v, 1);
    // A real change: v 2, one event.
    s.set('job-a', payloadOf('Second'));
    cache.touch('job-a');
    mock.timers.tick(REBUILD_DELAY_MS);
    await settled();
    const second = await cache.page('job-a');
    assert.equal(second.v, 2);
    assert.equal(second.title, 'Second');
    assert.deepEqual(told, [['job-a', 1], ['job-a', 2]]);
  } finally { cache.close(); mock.timers.reset(); }
});

test('?v= the current version answers { same: true, v }; an older one answers the payload', async () => {
  const s = store();
  const cache = jobPageCache({ build: s.build });
  try {
    s.set('job-a', payloadOf('First'));
    const p = await cache.page('job-a');
    assert.deepEqual(await cache.page('job-a', p.v), { same: true, v: p.v });
    assert.equal((await cache.page('job-a', p.v - 1)).title, 'First');
    assert.equal((await cache.page('job-a', null)).title, 'First');
  } finally { cache.close(); }
});

test('a request on a warm job never builds: page and item answer from what the last rebuild left', async () => {
  const s = store();
  const cache = jobPageCache({ build: s.build });
  try {
    s.set('job-a', payloadOf('First'), { 'brief:briefs/001-plan.md': { version: 'aaa', text: 'The plan' } });
    await cache.page('job-a');
    const builds = s.builds;
    for (let i = 0; i < 50; i++) {
      await cache.page('job-a');
      await cache.page('job-a', 1);
      await cache.item('job-a', 'brief:briefs/001-plan.md');
    }
    assert.equal(s.builds, builds, 'no build on a request');
    assert.equal(cache.stats().builds, builds);
  } finally { cache.close(); }
});

test('a body of an answered brief is rendered once: asked again, and after a rebuild that kept its version', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const s = store();
  const cache = jobPageCache({ build: s.build });
  try {
    const bodies = { 'brief:briefs/001-plan.md': { version: 'aaa', text: 'The plan', meta: { answered: 'Go' } } };
    s.set('job-a', payloadOf('First'), bodies);
    const one = await cache.item('job-a', 'brief:briefs/001-plan.md');
    assert.deepEqual(one, { id: 'brief:briefs/001-plan.md', kind: 'brief', version: 'aaa', html: '<p>The plan</p>', text: 'The plan', meta: { answered: 'Go' } });
    await cache.item('job-a', 'brief:briefs/001-plan.md');
    assert.equal(s.renders, 1);
    assert.equal(cache.stats().renders, 1);
    // The job changes elsewhere; the brief's version is the same: kept, not rendered again.
    s.set('job-a', payloadOf('Second'), bodies);
    cache.touch('job-a');
    mock.timers.tick(REBUILD_DELAY_MS);
    await settled();
    assert.equal((await cache.page('job-a')).title, 'Second');
    await cache.item('job-a', 'brief:briefs/001-plan.md');
    assert.equal(s.renders, 1, 'still the one render');
    // Its version changes (the file was written again): rendered once more.
    s.set('job-a', payloadOf('Second'), { 'brief:briefs/001-plan.md': { version: 'bbb', text: 'The plan, again' } });
    cache.touch('job-a');
    mock.timers.tick(REBUILD_DELAY_MS);
    await settled();
    const two = await cache.item('job-a', 'brief:briefs/001-plan.md');
    assert.equal(two.version, 'bbb');
    assert.equal(two.html, '<p>The plan, again</p>');
    assert.equal(s.renders, 2);
  } finally { cache.close(); mock.timers.reset(); }
});

test('an unknown job is a 404 and is not kept; an unknown item on a known job is a 404', async () => {
  const s = store();
  const cache = jobPageCache({ build: s.build });
  try {
    await assert.rejects(cache.page('nope'), (err) => err.status === 404 && /No job by that name/.test(err.message));
    await assert.rejects(cache.item('nope', 'x'), (err) => err.status === 404);
    assert.equal(cache.has('nope'), false);
    s.set('job-a', payloadOf('First'));
    await assert.rejects(cache.item('job-a', 'reply:missing'), (err) => err.status === 404);
  } finally { cache.close(); }
});

test('a job that goes away leaves the cache at its next rebuild', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const s = store();
  const cache = jobPageCache({ build: s.build });
  try {
    s.set('job-a', payloadOf('First'));
    await cache.page('job-a');
    s.jobs.delete('job-a');
    cache.touch('job-a');
    mock.timers.tick(REBUILD_DELAY_MS);
    await settled();
    assert.equal(cache.has('job-a'), false);
  } finally { cache.close(); mock.timers.reset(); }
});

test('rebuilds wait 150 ms after the last change, and never more than 1 s behind a stream of changes', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const s = store();
  const cache = jobPageCache({ build: s.build });
  try {
    s.set('job-a', payloadOf('First'));
    await cache.page('job-a');
    const base = s.builds;
    // Five changes 50 ms apart: one rebuild, 150 ms after the last.
    for (let i = 0; i < 5; i++) { cache.touch('job-a'); mock.timers.tick(50); await settled(); }
    assert.equal(s.builds, base, 'not yet');
    mock.timers.tick(100);
    await settled();
    assert.equal(s.builds, base + 1);
    // A change every 100 ms for 3 s (a reply streaming): a rebuild at least every second.
    const at = s.builds;
    for (let i = 0; i < 30; i++) { cache.touch('job-a'); mock.timers.tick(100); await settled(); }
    assert.ok(s.builds - at >= 2, `rebuilt ${s.builds - at} times in 3 s`);
    assert.ok(s.builds - at <= 4, `rebuilt ${s.builds - at} times in 3 s`);
    // A change for a job nobody has opened builds nothing.
    cache.touch('job-b');
    mock.timers.tick(REBUILD_MAX_WAIT_MS);
    await settled();
    assert.equal(cache.has('job-b'), false);
  } finally { cache.close(); mock.timers.reset(); }
});

test('a change with no job rebuilds only the jobs opened in the last 10 minutes; a quiet one is rebuilt behind its next request', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const s = store();
  const cache = jobPageCache({ build: s.build });
  try {
    s.set('job-a', payloadOf('A'));
    s.set('job-b', payloadOf('B', { slug: 'job-b' }));
    await cache.page('job-a');
    mock.timers.tick(OPEN_MS + 1000);
    await cache.page('job-b');
    const base = s.builds;
    cache.touchAll();
    mock.timers.tick(REBUILD_DELAY_MS);
    await settled();
    assert.equal(s.builds, base + 1, 'only job-b, opened just now');
    // job-a, quiet for over 10 minutes, answers at once from what it holds, and rebuilds behind the answer.
    s.set('job-a', payloadOf('A, later'));
    assert.equal((await cache.page('job-a')).title, 'A');
    mock.timers.tick(REBUILD_DELAY_MS);
    await settled();
    assert.equal(s.builds, base + 2);
    assert.equal((await cache.page('job-a')).title, 'A, later');
    // A change to job-a itself always rebuilds it, opened lately or not.
    mock.timers.tick(OPEN_MS + 1000);
    s.set('job-a', payloadOf('A, latest'));
    cache.touch('job-a');
    mock.timers.tick(REBUILD_DELAY_MS);
    await settled();
    assert.equal(s.builds, base + 3);
  } finally { cache.close(); mock.timers.reset(); }
});

test('first requests that arrive together share one build', async () => {
  const s = store();
  const cache = jobPageCache({ build: s.build });
  try {
    s.set('job-a', payloadOf('First'));
    const answers = await Promise.all([cache.page('job-a'), cache.page('job-a'), cache.item('job-a', 'x').catch((e) => e.status)]);
    assert.equal(answers[0].v, 1);
    assert.equal(answers[1].v, 1);
    assert.equal(answers[2], 404);
    assert.equal(s.builds, 1);
  } finally { cache.close(); }
});

test('a build that fails keeps what the page had; a first one that fails is an error and is tried again next time', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const s = store();
  let fail = true;
  const logged = [];
  const cache = jobPageCache({ build: async (slug) => { if (fail) throw new Error('disk gone'); return s.build(slug); }, log: (...a) => logged.push(a.join(' ')) });
  try {
    s.set('job-a', payloadOf('First'));
    await assert.rejects(cache.page('job-a'), /disk gone/);
    fail = false;
    assert.equal((await cache.page('job-a')).title, 'First');
    fail = true;
    cache.touch('job-a');
    mock.timers.tick(REBUILD_DELAY_MS);
    await settled();
    assert.equal((await cache.page('job-a')).title, 'First');
    assert.ok(logged.some((l) => /disk gone/.test(l)));
  } finally { cache.close(); mock.timers.reset(); }
});

test('itemSources: one body per conversation item and per document the steps show, versioned by the line hash or the text', () => {
  const { facts, payload } = longJobPage({ size: 52 });
  const briefTexts = new Map(facts.thread.filter((t) => t.kind === 'brief').map((t) => [t.file, `# ${t.headline}\n\nThe brief.`]));
  const docs = payload.steps.flatMap((st) => st.outputs).filter((o) => o.kind === 'doc').map((o) => ({ file: o.id, name: o.label, type: 'md', text: `# ${o.label}\n\nWords.`, updatedAt: '2026-11-02T15:00:00.000Z', size: 20, summary: null }));
  let renders = 0;
  const render = (text) => { renders++; return renderMarkdown(text); };
  const sources = itemSources({ payload, thread: facts.thread, briefTexts, docs, decided: facts.detail.decidedOnYourBehalf, render });
  assert.equal(renders, 0, 'nothing rendered until asked');
  for (const line of payload.thread) {
    const s = sources.get(line.id);
    assert.ok(s, line.id);
    assert.equal(s.version, line.hash, 'a line’s body is versioned by its hash');
    assert.equal(s.kind, line.kind);
  }
  const reply = facts.thread.find((t) => t.kind === 'reply');
  assert.equal(sources.get(reply.id).text, reply.reply);
  assert.match(sources.get(reply.id).html(), /<p>/);
  const brief = facts.thread.find((t) => t.kind === 'brief');
  assert.equal(sources.get(brief.id).text, briefTexts.get(brief.file));
  assert.equal(sources.get(brief.id).meta.file, brief.file);
  assert.equal(sources.get(brief.id).meta.answered, payload.thread.find((l) => l.id === brief.id).answered);
  for (const d of docs) {
    const s = sources.get(d.file);
    assert.equal(s.kind, 'doc');
    assert.match(s.version, /^[0-9a-f]{12}$/);
    assert.equal(s.meta.name, d.name);
  }
  const decisions = sources.get('decisions');
  assert.equal(decisions.kind, 'decisions');
  assert.equal(decisions.meta.rows.length, facts.detail.decidedOnYourBehalf.length);
  assert.equal(renders, 1, 'only the reply that was asked for');
  // Bodies carry no reply words twice: the text is the body, meta the rest.
  assert.equal(sources.get(reply.id).meta.reply, undefined);
});
