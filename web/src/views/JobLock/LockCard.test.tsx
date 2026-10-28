import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/client';
import { LockCard, lockFromError, lockHeadline, type JobLockInfo } from './LockCard';

const now = new Date('2026-10-28T15:00:00');
const terminal: JobLockInfo = { owner: 'terminal', pid: 4242, branch: 'feat/x', acquiredAt: new Date('2026-10-28T14:12:00').toISOString() };

describe('LockCard', () => {
  it('says the job is open in a terminal, with the pid and since when, in words', () => {
    render(<LockCard lock={terminal} now={now} />);
    const card = screen.getByRole('status', { name: 'Job open elsewhere' });
    expect(card).toHaveTextContent('This job is open in a terminal (pid 4242, since 2:12pm)');
    expect(card).toHaveTextContent('Only one place can work on a job at a time, so nothing was sent.');
    expect(card).toHaveTextContent('/exit');
    expect(card).toHaveTextContent('Branch there: feat/x');
  });

  it('names another dashboard when the runner holds it, and leaves the branch out when unknown', () => {
    render(<LockCard lock={{ owner: 'runner', pid: 77, branch: null, acquiredAt: null }} now={now} />);
    const card = screen.getByRole('status');
    expect(card).toHaveTextContent('This job is being run by another copy of the dashboard (pid 77, since a while ago)');
    expect(card).not.toHaveTextContent('Branch there');
  });

  it('shows the day when the lock is from another day', () => {
    expect(lockHeadline({ ...terminal, acquiredAt: new Date('2026-10-26T09:05:00').toISOString() }, now)).toBe('This job is open in a terminal (pid 4242, since Mon 9:05am)');
  });
});

describe('lockFromError', () => {
  it('picks the lock out of a refused send (409, job-locked) and nothing else', () => {
    const err = new ApiError(409, 'This job is open in a terminal (pid 4242, since Oct 28, 2:12 PM).', { code: 'job-locked', lock: terminal });
    expect(lockFromError(err)).toEqual(terminal);
    expect(lockFromError(new ApiError(409, 'Busy.', { code: 'terminal-open' }))).toBeNull();
    expect(lockFromError(new ApiError(500, 'x', { code: 'job-locked' }))).toBeNull();
    expect(lockFromError(new Error('x'))).toBeNull();
    expect(lockFromError(new ApiError(409, 'x', { code: 'job-locked', lock: { owner: 'odd', pid: '1' } }))).toEqual({ owner: 'runner', pid: null, branch: null, acquiredAt: null });
  });
});
