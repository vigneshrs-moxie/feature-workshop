// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { job, permission } from '../state/test-fixtures';
import { attentionKeys, newAlerts } from './alerts';

describe('what counts as newly needing you', () => {
  const calm = { jobs: [job('alpha', 'idle'), job('beta', 'running')], permissions: [] };

  it('lists jobs in Needs you and pending permission cards', () => {
    const keys = attentionKeys({ jobs: [job('alpha', 'needs-you'), job('beta', 'running')], permissions: [permission('p1', 'beta')] });
    expect([...keys].sort()).toEqual(['job:alpha', 'perm:p1']);
  });

  it('alerts once when a job enters Needs you, using its headline when it has one', () => {
    const before = attentionKeys(calm);
    const after = { jobs: [job('alpha', 'needs-you', { headline: 'Plan ready for review' }), job('beta', 'running')], permissions: [] };
    expect(newAlerts(before, after)).toEqual([{ slug: 'alpha', title: 'Needs you: Job alpha', body: 'Plan ready for review' }]);
    expect(newAlerts(attentionKeys(after), after)).toEqual([]);
  });

  it('alerts for a new permission card, once per job, even when the job already needed you', () => {
    const was = { jobs: [job('alpha', 'needs-you', { waitingFor: 'answers' })], permissions: [] };
    const now = { jobs: [job('alpha', 'needs-you', { permissions: 2 })], permissions: [permission('p1', 'alpha'), permission('p2', 'alpha')] };
    expect(newAlerts(attentionKeys(was), now)).toEqual([
      { slug: 'alpha', title: 'Permission needed: Job alpha', body: 'Run a command. Open the job to allow or deny it.' },
    ]);
  });

  it('says what the job waits for when there is no headline', () => {
    const after = { jobs: [job('alpha', 'needs-you', { waitingFor: 'approval' })], permissions: [] };
    expect(newAlerts(new Set(), after)[0].body).toBe('The Foreman is waiting for your go-ahead.');
  });

  it('stays quiet when something stops needing you', () => {
    const before = attentionKeys({ jobs: [job('alpha', 'needs-you')], permissions: [permission('p1', 'alpha')] });
    expect(newAlerts(before, calm)).toEqual([]);
  });
});
