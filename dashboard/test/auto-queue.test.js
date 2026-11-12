// The Auto queue (lib/auto-queue.js): the places, the ceiling and the Inbox's Auto groups that the
// snapshot carries. Pure: board cards and Inbox items made by hand, no runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { autoQueueView } from '../lib/auto-queue.js';
import { autoCardView, autoRecord } from '../lib/auto.js';
import { pickNext, startsByItself } from '../lib/auto-start.js';

const AT = '2026-11-12T10:00:00.000Z';
const SETTING = { on: true, tag: 'auto', max: 5 };
const item = (n, o = {}) => ({ key: `ORBIT-${n}`, number: n, title: `Ticket ${n}`, type: 'feature', status: 'open', why: ['assigned'], tags: ['auto'], job: null, ...o });
const card = (slug, record, o = {}) => ({ slug, title: `Job ${slug}`, closed: null, auto: autoCardView(record, { closed: Boolean(o.closed) }), ...o });
const on = (o = {}) => ({ ...autoRecord(null, { on: true, by: 'tag', tag: 'auto', now: AT }), ...o });
const stopped = () => on({ stopped: { reason: 'It needs a database command.', rule: 'database', at: AT } });
const tooBig = () => ({ ...autoRecord(on(), { on: false }), tooBig: { at: AT, reason: 'The first brief calls it stack-sized.' } });
const ready = () => ({ ...autoRecord(on(), { on: false }), finished: AT, acted: null });
const view = (o = {}) => autoQueueView({ setting: SETTING, paused: null, cards: [], items: [], failed: [], ...o });

test('the Inbox\'s Auto groups: next up, working, too big, couldn\'t start', () => {
  const q = view({
    cards: [card('orbit-2-a', on()), card('orbit-3-b', tooBig()), card('plain-job', on())],
    items: [
      item(1),
      item(2, { job: { slug: 'orbit-2-a', title: 'Job orbit-2-a' } }),
      item(3, { job: { slug: 'orbit-3-b', title: 'Job orbit-3-b' } }),
      item(4),
    ],
    failed: [{ key: 'ORBIT-4', reason: 'Orbit said no.' }],
  });
  assert.deepEqual(q.tickets.map((t) => t.group), ['next', 'working', 'too-big', 'failed']);
  assert.deepEqual(q.tickets, [
    { key: 'ORBIT-1', title: 'Ticket 1', group: 'next', slug: null, reason: null },
    { key: 'ORBIT-2', title: 'Ticket 2', group: 'working', slug: 'orbit-2-a', reason: null },
    { key: 'ORBIT-3', title: 'Ticket 3', group: 'too-big', slug: 'orbit-3-b', reason: 'The first brief calls it stack-sized.' },
    { key: 'ORBIT-4', title: 'Ticket 4', group: 'failed', slug: null, reason: 'Orbit said no.' },
  ]);
  for (const t of q.tickets) assert.deepEqual(Object.keys(t), ['key', 'title', 'group', 'slug', 'reason']);
});

test('a stopped job is still under working; a ready one is not listed', () => {
  const q = view({
    cards: [card('orbit-1-a', stopped()), card('orbit-2-b', ready())],
    items: [item(1, { job: { slug: 'orbit-1-a' } }), item(2, { job: { slug: 'orbit-2-b' } })],
  });
  assert.deepEqual(q.tickets, [{ key: 'ORBIT-1', title: 'Ticket 1', group: 'working', slug: 'orbit-1-a', reason: null }]);
});

test('places: working and unfinished counted from the cards, max from the setting, ceiling 10', () => {
  const q = autoQueueView({
    setting: { on: true, tag: ' auto ', max: 3 }, paused: 'limit', items: [], failed: [],
    cards: [
      card('a', on()), card('b', on()), card('c', stopped()), card('d', ready()), card('e', tooBig()),
      card('f', autoRecord(on(), { on: false })), card('g', null),
      card('h', on(), { closed: { as: 'done', at: AT } }),
    ],
  });
  assert.deepEqual(Object.keys(q), ['on', 'tag', 'max', 'working', 'unfinished', 'ceiling', 'paused', 'testing', 'tickets']);
  assert.deepEqual(q, { on: true, tag: 'auto', max: 3, working: 2, unfinished: 3, ceiling: 10, paused: 'limit', testing: null, tickets: [] });
  assert.equal(autoQueueView({ setting: null, cards: [], items: [], failed: [], testing: 'orbit-9-x' }).testing, 'orbit-9-x');
  assert.deepEqual(autoQueueView({ setting: null, paused: null, cards: [], items: [], failed: [] }), { on: false, tag: '', max: 5, working: 0, unfinished: 0, ceiling: 10, paused: null, testing: null, tickets: [] });
});

test('a job whose ticket lost its tag is still listed by its job', () => {
  const q = view({
    cards: [card('orbit-1-a', on()), card('orbit-2-b', tooBig())],
    items: [item(1, { tags: [], job: { slug: 'orbit-1-a' } }), item(2, { tags: ['other'], job: { slug: 'orbit-2-b' } }), item(3, { tags: [] })],
  });
  assert.deepEqual(q.tickets.map((t) => [t.key, t.group]), [['ORBIT-1', 'working'], ['ORBIT-2', 'too-big']]);
});

test('next up is the starter\'s own rule: not tried, assigned, open, no job, the tag, Auto start on', () => {
  const memory = { started: [{ key: 'ORBIT-1', at: AT, slug: 'orbit-1-a', tag: 'auto' }], failed: [] };
  assert.equal(startsByItself(item(1), SETTING, memory), false, 'started before (its job closed since)');
  assert.equal(startsByItself(item(2), SETTING, memory), true);
  assert.equal(startsByItself(item(2), { ...SETTING, on: false }, memory), false, 'Auto start off');
  assert.equal(startsByItself(item(2, { why: ['watching'] }), SETTING, memory), false, 'not assigned');
  assert.equal(startsByItself(item(2, { status: 'resolved' }), SETTING, memory), false, 'closed');
  assert.equal(startsByItself(item(2, { job: { slug: 'x' } }), SETTING, memory), false, 'has a job');
  assert.equal(startsByItself(item(2, { tags: ['AUTO '] }), SETTING, memory), true, 'the tag, any case');
  // pickNext starts what startsByItself says, and the queue lists it as next.
  assert.equal(pickNext({ items: [item(1), item(2)], setting: SETTING, memory, tagsShown: true }).start.key, 'ORBIT-2');
  const q = view({ items: [item(1), item(2)], started: memory.started });
  assert.deepEqual(q.tickets.map((t) => [t.key, t.group]), [['ORBIT-2', 'next']]);
});
