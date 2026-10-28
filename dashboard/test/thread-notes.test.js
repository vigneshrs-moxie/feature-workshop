// The thread's plain notes for what Ground Control did by itself (packet N step 5), from fixture
// audit lines: none of these shows as a message you wrote.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThread } from '../lib/thread.js';
import { RESTART_NOTE, RESUME_KIND, RESTART_TEXT, withRestartNotes } from '../runner/replay.js';

const DIR = '/jobs/dark-mode';
const line = (at, e) => ({ at, featureDir: DIR, slug: 'dark-mode', ...e });
const notes = (thread) => thread.filter((t) => t.kind === 'note').map((t) => t.text);
const yours = (thread) => thread.filter((t) => t.kind === 'you');
// The clock the notes use: this computer's local time, as "14:02".
const hm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

test('status_invalid: the first error, as a note', () => {
  const t = buildThread({ audit: [line('2026-10-27T10:00:00Z', { action: 'status_invalid', errors: ['stage must be one of spec, plan, implement.', 'updated_at is missing'], attempt: 1, of: 3, sent: true })] });
  assert.deepEqual(notes(t), ['The Foreman’s status.json didn’t match the format: stage must be one of spec, plan, implement.']);
});

test('a status-fix send is a note, not a message from you', () => {
  const t = buildThread({ audit: [line('2026-10-27T10:00:00Z', { action: 'send', kind: 'status-fix', text: 'status.json is invalid: …', runId: 'r1', sessionId: 's1' })] });
  assert.deepEqual(notes(t), ['Ground Control asked the Foreman to rewrite status.json.']);
  assert.equal(yours(t).length, 0);
});

test('resume-after-restart: the carry-on Ground Control sent by itself is a note', () => {
  const audit = [
    line('2026-10-27T14:05:01Z', { action: 'send', kind: RESUME_KIND, text: RESTART_TEXT, runId: 'r2', sessionId: 's1' }),
    line('2026-10-27T14:05:01Z', { action: 'resumed', runId: 'r2', sessionId: 's1', via: 'auto' }),
  ];
  const t = withRestartNotes(buildThread({ audit }), audit);
  assert.deepEqual(notes(t), [RESTART_NOTE]);
  assert.equal(RESTART_NOTE, 'Ground Control restarted, so it told the Foreman to carry on.');
  assert.equal(yours(t).length, 0);
});

test('service-stop and service-start: one note with both times, for the job whose reply it paused', () => {
  const stop = { at: '2026-10-27T14:02:00Z', action: 'service-stop', pid: 1, paused: [{ runId: 'r1', slug: 'dark-mode', featureDir: DIR, sessionId: 's1' }] };
  const start = { at: '2026-10-27T14:05:00Z', action: 'service-start', pid: 2, resumes: ['dark-mode'], paused: [] };
  const audit = [line('2026-10-27T14:00:00Z', { action: 'send', kind: 'message', text: 'Go on.', runId: 'r1', sessionId: 's1' })];
  const t = buildThread({ audit, service: [stop, start], featureDir: DIR });
  assert.deepEqual(notes(t), [`Ground Control stopped at ${hm(stop.at)} and started again at ${hm(start.at)}.`]);
  assert.equal(t.at(-1).text, notes(t)[0], 'in time order, after the message');
  // Another job's thread: nothing (the stop didn't pause it).
  assert.deepEqual(notes(buildThread({ audit: [], service: [stop, start], featureDir: '/jobs/other' })), []);
  // Stopped and not started since (the thread read by another process): the stop alone.
  assert.deepEqual(notes(buildThread({ audit, service: [stop], featureDir: DIR })), [`Ground Control stopped at ${hm(stop.at)}.`]);
  // The ids stay the same on every read.
  assert.equal(buildThread({ audit, service: [stop, start], featureDir: DIR }).at(-1).id, t.at(-1).id);
});

test('pr-feedback-sent: a note naming the check or the comment, and the message itself is not shown as yours', () => {
  const audit = [
    line('2026-10-27T15:00:00Z', { action: 'pr-feedback-found', key: 'pr7:check:lint@abc', kind: 'check', pr: 7, prLabel: 'PR #1', name: 'lint' }),
    line('2026-10-27T15:01:00Z', { action: 'send', kind: 'pr-feedback', text: 'A check failed on PR #1: lint. …', runId: 'r3', sessionId: 's1' }),
    line('2026-10-27T15:01:00Z', { action: 'pr-feedback-sent', key: 'pr7:check:lint@abc', kind: 'check', pr: 7, prLabel: 'PR #1', name: 'lint', runId: 'r3', sessionId: 's1' }),
    line('2026-10-27T15:02:00Z', { action: 'pr-feedback-queued', key: 'pr7:comment:c9', kind: 'comment', pr: 7, prLabel: 'PR #1', author: 'Ana', file: 'web/src/App.tsx', line: 40 }),
    line('2026-10-27T15:03:00Z', { action: 'pr-feedback-sent', key: 'pr7:comment:c9', kind: 'comment', pr: 7, prLabel: 'PR #1', author: 'Ana', file: 'web/src/App.tsx', line: 40 }),
    line('2026-10-27T15:04:00Z', { action: 'pr-feedback-not-sent', key: 'pr7:comment:c10', kind: 'comment', pr: 7, prLabel: 'PR #1', author: 'Bo', reason: 'The Foreman’s reply was paused first.' }),
    line('2026-10-27T15:05:00Z', { action: 'pr-feedback-left', key: 'pr7:comment:c11', kind: 'comment', pr: 7, prLabel: 'PR #1', author: 'Cy' }),
  ];
  const t = buildThread({ audit });
  assert.deepEqual(notes(t), [
    'You sent the failed check lint on PR #1 to the Foreman.',
    'Ana’s comment on PR #1 waits for the Foreman to finish its reply; it goes then.',
    'You sent Ana’s comment on PR #1 to the Foreman.',
    'Bo’s comment on PR #1 wasn’t sent: The Foreman’s reply was paused first. Its card is back under Needs you.',
  ]);
  assert.equal(yours(t).length, 0);
});

test('a message you wrote is still yours', () => {
  const t = buildThread({ audit: [line('2026-10-27T10:00:00Z', { action: 'send', kind: 'message', text: 'Use the smaller table.', runId: 'r1' })] });
  assert.deepEqual(yours(t).map((x) => x.text), ['Use the smaller table.']);
});
