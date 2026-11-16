// Finding a job fast (home/findJobs.ts; 16 Nov).
import { describe, expect, it } from 'vitest';
import { job } from '../state/test-fixtures';
import { keyOfSlug, matchJobs, needsYouCount, nextNeedsYou } from './findJobs';

const JOBS = [
  job('orbit-906-crew-schedule-export-long', 'needs-you', { title: 'Crew schedule export (long)', lane: 'needs-you', waitingSince: '2026-11-16T09:00:00Z', repo: { name: 'acme-portal', branch: 'feature/crew-schedule-export-long' } }),
  job('widget-export', 'needs-you', { title: 'Widget Export', lane: 'needs-you', waitingSince: '2026-11-16T08:00:00Z', laneReason: 'A permission waits for your yes' }),
  job('invoice', 'running', { title: 'Invoice export · refunds', lane: 'working', laneReason: 'Editing refund.ts' }),
  job('notes', 'idle', { title: 'Customer notes tab', lane: 'resting' }),
  job('gone', 'needs-you', { title: 'Closed one', lane: 'needs-you', closed: true, waitingSince: '2026-11-01T08:00:00Z' }),
];

describe('matchJobs', () => {
  it('every word must match; a title that starts with them comes first, then a title that has them, then the rest', () => {
    expect(matchJobs(JOBS, 'export').map((j) => j.slug)).toEqual(['orbit-906-crew-schedule-export-long', 'widget-export', 'invoice']);
    expect(matchJobs(JOBS, 'widget').map((j) => j.slug)).toEqual(['widget-export']);
    expect(matchJobs(JOBS, 'export refund').map((j) => j.slug)).toEqual(['invoice']);
    expect(matchJobs(JOBS, 'invoice export').map((j) => j.slug)[0]).toBe('invoice');
  });

  it('finds the ticket key (906 or ORBIT-906), the branch, the repository and what the lane says', () => {
    expect(matchJobs(JOBS, '906').map((j) => j.slug)).toEqual(['orbit-906-crew-schedule-export-long']);
    expect(matchJobs(JOBS, 'ORBIT-906').map((j) => j.slug)).toEqual(['orbit-906-crew-schedule-export-long']);
    expect(matchJobs(JOBS, 'feature/crew').map((j) => j.slug)).toEqual(['orbit-906-crew-schedule-export-long']);
    expect(matchJobs(JOBS, 'permission').map((j) => j.slug)).toEqual(['widget-export']);
    expect(matchJobs(JOBS, 'needs you').map((j) => j.slug)).toContain('widget-export');
  });

  it('no words: every job in the order given; nothing matching: none', () => {
    expect(matchJobs(JOBS, '  ')).toHaveLength(JOBS.length);
    expect(matchJobs(JOBS, 'zebra')).toEqual([]);
  });

  it('keyOfSlug reads a ticket key from a slug', () => {
    expect(keyOfSlug('orbit-0906-x')).toBe('ORBIT-906');
    expect(keyOfSlug('widget-export')).toBeNull();
  });
});

describe('nextNeedsYou', () => {
  it('the longest wait other than the job he is on, never a closed one', () => {
    expect(nextNeedsYou(JOBS)?.slug).toBe('widget-export');
    expect(nextNeedsYou(JOBS, 'widget-export')?.slug).toBe('orbit-906-crew-schedule-export-long');
    expect(needsYouCount(JOBS, 'widget-export')).toBe(1);
    expect(nextNeedsYou(JOBS.filter((j) => j.slug !== 'orbit-906-crew-schedule-export-long'), 'widget-export')).toBeNull();
  });
});
