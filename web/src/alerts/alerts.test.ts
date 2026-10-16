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

  it('alerts once when a decision already waiting for you is parked (left 4 hours)', () => {
    const waiting = { jobs: [job('alpha', 'needs-you', { waitingFor: 'approval' })], permissions: [] };
    const parked = { jobs: [job('alpha', 'needs-you', { waitingFor: 'approval', parked: true })], permissions: [] };
    expect(newAlerts(attentionKeys(waiting), parked)).toEqual([
      { slug: 'alpha', title: 'Parked 4h: Job alpha', body: 'A decision has waited for you for more than 4 hours. Nothing goes ahead until you decide.' },
    ]);
    expect(newAlerts(attentionKeys(parked), parked), 'only once').toEqual([]);
    // Entering Needs you already parked (a page that wasn't watching): one alert, the usual one.
    expect(newAlerts(attentionKeys(calm), { jobs: [job('alpha', 'needs-you', { parked: true })], permissions: [] }).map((a) => a.title)).toEqual(['Needs you: Job alpha']);
  });

  it('stays quiet when something stops needing you', () => {
    const before = attentionKeys({ jobs: [job('alpha', 'needs-you')], permissions: [permission('p1', 'alpha')] });
    expect(newAlerts(before, calm)).toEqual([]);
  });
});
