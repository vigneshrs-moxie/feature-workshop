import { describe, expect, it, vi } from 'vitest';
import { composeGate, composeMessage, gateChips } from './compose';
import { sendGate } from '../app/jobActions';
import type { ApiClient } from '../api/client';

const status = {
  questions: [{ id: '1', text: 'Keep the old column?', options: [{ id: 'a', label: 'Yes' }] }],
  decidedOnYourBehalf: [{ id: 'D-1', decision: 'Reviewers', confirmed: false }],
  nextProposed: 'Build step 1',
  spec: null,
  artifacts: [{ name: 'quick-plan', version: 2 }],
  brief: { number: 2 },
};

describe('composeGate', () => {
  it('passes answers, verdicts, chips and kind through to the dashboard’s composeReply', () => {
    const text = composeGate({
      kind: 'approve', answers: { 1: { choice: 'a' } }, verdicts: { 'D-1': { verdict: 'confirm' } },
      chips: [{ kind: 'skip', stage: 'test' }, { kind: 'level', level: 2, was: 1 }],
    }, status);
    expect(text).toBe([
      'My answers to brief 2:', '1. Keep the old column? → a) Yes', '',
      'Decided on my behalf, confirmed: D-1.', '',
      'Option change for the next step: skip test',
      'Option change for the next step: level L2 (was L1)', '',
      'I approve. Go ahead with the next stage: Build step 1',
      'At these versions: quick-plan v2.',
    ].join('\n'));
  });

  it('leaves out malformed chips; the composer’s plain message is unchanged', () => {
    expect(gateChips([{ kind: 'skip', stage: 'implement' }, { kind: 'fable', point: 'pr' }])).toEqual([{ kind: 'fable', point: 'pr' }]);
    expect(composeGate({ kind: 'stop' }, null)).toMatch(/^Stop here\./);
    expect(composeMessage('Hello', { brief: { number: 1 } })).toBe('Hello');
  });
});

describe('sendGate', () => {
  it('posts the gate body to the job’s gate route', async () => {
    const post = vi.fn(async () => ({ ok: true, sent: false, queued: false, text: 'x' }));
    const api = { post } as unknown as ApiClient;
    const r = await sendGate(api, 'a b', { kind: 'message', note: 'x', chips: [{ kind: 'self', stage: 'test' }] });
    expect(post).toHaveBeenCalledWith('/api/job/a%20b/gate', { kind: 'message', note: 'x', chips: [{ kind: 'self', stage: 'test' }] });
    expect(r.sent).toBe(false);
  });
});
