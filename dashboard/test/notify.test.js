// Notifications outside the browser (lib/notify.js): settings, quiet hours, what is sent and how,
// and the history. Nothing reaches macOS: the command runner is replaced.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { commandFor, decide, findMethod, inQuietHours, noticeBody, Notifier, notifySettings, OPEN_TAB_SCRIPT, openTabCommand, validateNotifyPatch, waitedFor } from '../lib/notify.js';

const at = (hh, mm = 0) => { const d = new Date(2026, 9, 21, hh, mm); return d; };

test('notify: settings fill in defaults and refuse what isn’t allowed', () => {
  assert.deepEqual(notifySettings({}), { enabled: true, levels: { needs: 'sound', problem: 'sound', done: 'silent' }, quiet: { on: false, from: '22:00', to: '07:00' }, skipWhenWatching: true });
  assert.equal(notifySettings({ levels: { needs: 'loud' } }).levels.needs, 'sound', 'an unknown mode is ignored');
  const next = validateNotifyPatch({ levels: { done: 'off' }, quiet: { on: true, from: '21:30' } }, {});
  assert.equal(next.levels.done, 'off');
  assert.deepEqual(next.quiet, { on: true, from: '21:30', to: '07:00' });
  for (const bad of [{ levels: { done: 'loud' } }, { levels: { other: 'off' } }, { quiet: { from: '25:00' } }, { enabled: 'yes' }, { sms: true }, null]) {
    assert.throws(() => validateNotifyPatch(bad, {}), JSON.stringify(bad));
  }
});

test('notify: quiet hours, also across midnight', () => {
  const q = { on: true, from: '22:00', to: '07:00' };
  assert.equal(inQuietHours(q, at(23)), true);
  assert.equal(inQuietHours(q, at(6, 59)), true);
  assert.equal(inQuietHours(q, at(7)), false);
  assert.equal(inQuietHours(q, at(12)), false);
  assert.equal(inQuietHours({ ...q, on: false }, at(23)), false);
  assert.equal(inQuietHours({ on: true, from: '12:00', to: '13:00' }, at(12, 30)), true);
});

test('notify: what is sent, with a sound or not', () => {
  const s = notifySettings({ quiet: { on: true } });
  assert.deepEqual(decide('needs', s, { now: at(12) }), { send: true, sound: true, why: null });
  assert.deepEqual(decide('done', s, { now: at(12) }), { send: true, sound: false, why: null });
  assert.equal(decide('needs', s, { now: at(23) }).send, false, 'quiet hours');
  assert.deepEqual(decide('problem', s, { now: at(23) }), { send: true, sound: false, why: 'Quiet hours: shown without a sound.' });
  assert.equal(decide('needs', s, { now: at(12), watching: true }).send, false, 'you’re looking at the page');
  assert.equal(decide('needs', { ...s, skipWhenWatching: false }, { now: at(12), watching: true }).send, true);
  assert.equal(decide('needs', { ...s, enabled: false }, { now: at(12) }).send, false);
  assert.equal(decide('done', { ...s, levels: { done: 'off' } }, { now: at(12) }).send, false);
  assert.equal(decide('needs', s, { now: at(12), demo: true }).send, false, 'the demo sends only the test');
});

test('notify: the macOS commands', async () => {
  const [cmd, args] = commandFor('terminal-notifier', { title: 'Feature Workshop', subtitle: 'Widget Export', body: 'Go-ahead on Plan', url: 'http://127.0.0.1:4477/next/#/job/w', group: 'w', sound: 'Glass' });
  assert.equal(cmd, 'terminal-notifier');
  assert.deepEqual(args, ['-title', 'Feature Workshop', '-subtitle', 'Widget Export', '-message', 'Go-ahead on Plan', '-open', 'http://127.0.0.1:4477/next/#/job/w', '-group', 'w', '-sound', 'Glass']);
  const [osa, oargs] = commandFor('osascript', { title: 'T', subtitle: 'Say "hi"', body: 'a\\b', sound: null });
  assert.equal(osa, 'osascript');
  assert.equal(oargs[1], 'display notification "a\\\\b" with title "T" subtitle "Say \\"hi\\""');
  assert.equal(commandFor(null, { title: 'x' }), null);
  assert.equal(await findMethod({ platform: 'linux' }), null);
  assert.equal(await findMethod({ platform: 'darwin', which: async (c) => c === 'osascript' }), 'osascript');
  assert.equal(await findMethod({ platform: 'darwin', which: async () => true }), 'terminal-notifier');
});

test('notify: Notifier sends, links to the job, and keeps the last 50 in its history', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workshop-notify-'));
  const calls = [];
  let clock = at(12);
  const n = new Notifier({ dir, settings: async () => ({}), baseUrl: 'http://127.0.0.1:4477', method: 'terminal-notifier', run: async (cmd, args) => { calls.push(args); return true; }, now: () => clock });
  const e = await n.notify({ level: 'needs', title: 'Widget Export', body: 'Go-ahead on Plan', slug: 'widget-export' });
  assert.equal(e.sent, true);
  assert.ok(calls[0][calls[0].indexOf('-execute') + 1].includes("'http://127.0.0.1:4477/next/#/job/widget-export'"));
  assert.ok(calls[0].includes('Glass'));
  n.seen();
  const skipped = await n.notify({ level: 'needs', title: 'X', slug: 'x' });
  assert.equal(skipped.sent, false);
  assert.match(skipped.why, /looking at the dashboard/);
  clock = new Date(clock.getTime() + 60000);
  assert.equal((await n.notify({ level: 'done', title: 'Y' })).sent, true, 'a minute later you aren’t watching any more');
  const test1 = await n.notify({ level: 'needs', title: 'Test', test: true });
  assert.equal(test1.sent, true, 'the test is sent even while you watch');
  // A quiet one (the "Landed" marks): sent at the level, never with a sound.
  const landed = await n.notify({ level: 'needs', title: 'Landed', quiet: true });
  assert.equal(landed.sent, true);
  assert.equal(landed.quiet, true);
  assert.ok(!calls.at(-1).includes('-sound'), 'no sound, though the level has one');
  for (let i = 0; i < 60; i++) await n.notify({ level: 'done', title: `t${i}` });
  // macOS refuses terminal-notifier (not allowed yet): shown with the built-in notifier, and said.
  const refused = new Notifier({ dir: null, settings: async () => ({}), baseUrl: 'x', method: 'terminal-notifier', now: () => at(12),
    run: async (cmd) => (cmd === 'terminal-notifier' ? { ok: false, err: 'Could not request notification permission: Notifications are not allowed for this application' } : { ok: true, err: null }) });
  const fell = await refused.notify({ level: 'needs', title: 'Z' });
  assert.equal(fell.sent, true);
  assert.match(fell.why, /built-in notifier: terminal-notifier isn’t allowed yet/);
  assert.match(refused.blocked, /not allowed/);
  const again = new Notifier({ dir, settings: async () => ({}), baseUrl: 'x', method: null });
  const list = await again.list();
  assert.equal(list.length, 50);
  assert.equal(list[0].title, 't59', 'newest first, read back from disk');
});

test('notify: a click goes to the dashboard tab already open in Chrome, else a new tab', async () => {
  const [, args] = commandFor('terminal-notifier', { title: 'T', body: 'b', url: 'http://u', execute: 'run-me' });
  assert.deepEqual(args.slice(args.indexOf('-execute'), args.indexOf('-execute') + 2), ['-execute', 'run-me']);
  assert.ok(!args.includes('-open'), 'one click action only');
  assert.equal(openTabCommand("/s/it's.applescript", 'http://127.0.0.1:4477/next/#/job/w', ['http://127.0.0.1:4477/']),
    "'/usr/bin/osascript' '/s/it'\\''s.applescript' 'http://127.0.0.1:4477/next/#/job/w' 'http://127.0.0.1:4477/'");
  assert.match(OPEN_TAB_SCRIPT, /application "Google Chrome" is running/, 'never starts Chrome just to look');
  assert.match(OPEN_TAB_SCRIPT, /open location u\n end run|open location u\nend run/, 'falls back to a new tab');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fw-notify-tab-'));
  const calls = [];
  const n = new Notifier({ dir, settings: async () => ({}), baseUrl: 'http://127.0.0.1:4477', method: 'terminal-notifier', run: async (cmd, a) => { calls.push(a); return true; } });
  await n.notify({ level: 'needs', title: 'W', body: 'b', slug: 'w', test: true });
  const exec = calls[0][calls[0].indexOf('-execute') + 1];
  assert.ok(exec.includes("'http://127.0.0.1:4477/next/#/job/w'") && exec.includes("'http://localhost:4477/'"), exec);
  assert.equal(await fs.readFile(path.join(dir, 'open-tab.applescript'), 'utf8'), OPEN_TAB_SCRIPT);
});

test('notify: the text says the stage, how long it has waited and the brief headline', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  assert.equal(waitedFor('2026-10-22T11:59:30Z', now), '');
  assert.equal(waitedFor('2026-10-22T11:48:00Z', now), '12m');
  assert.equal(waitedFor('2026-10-22T07:00:00Z', now), '5h');
  assert.equal(waitedFor('2026-10-19T12:00:00Z', now), '3d');
  assert.equal(waitedFor(null, now), '');
  assert.equal(noticeBody({ stage: 'review', waitingSince: '2026-10-22T11:48:00Z', headline: 'Widget Export · Review done: 0 blockers', title: 'Widget Export', what: 'x' }, now),
    'Review · waiting 12m — Review done: 0 blockers');
  assert.equal(noticeBody({ stage: 'plan', headline: null, what: 'The Foreman is waiting for your go-ahead.' }, now), 'Plan — The Foreman is waiting for your go-ahead.');
  assert.equal(noticeBody({ stage: null, what: 'A question for you.' }, now), 'A question for you.');
});
