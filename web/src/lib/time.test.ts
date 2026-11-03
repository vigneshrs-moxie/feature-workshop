import { describe, expect, it } from 'vitest';
import { clockTime, fullTime, relativeTime } from './time';

// vite.config.ts runs the tests in one zone, so a snapshot with a time in it reads the same on
// every machine. When a system doesn't take TZ, this says so, instead of a snapshot hours out.
describe('the tests’ time zone', () => {
  it('is America/Phoenix (TZ in vite.config.ts)', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Phoenix');
    expect(fullTime('2026-10-15T12:20:00.000Z')).toBe('Oct 15, 2026, 5:20 AM');
  });
});

// Local times, so the tests read the same in any time zone.
const now = new Date(2026, 9, 15, 15, 0); // Thu Oct 15 2026, 3:00pm
const at = (...a: [number, number, number, number, number]) => new Date(...a).toISOString();

describe('relativeTime', () => {
  it('says how long ago, briefly', () => {
    expect(relativeTime(new Date(2026, 9, 15, 14, 59, 30).toISOString(), now)).toBe('just now');
    expect(relativeTime(at(2026, 9, 15, 14, 59), now)).toBe('1m');
    expect(relativeTime(at(2026, 9, 15, 14, 56), now)).toBe('4m');
    expect(relativeTime(at(2026, 9, 15, 12, 0), now)).toBe('3h');
    expect(relativeTime(at(2026, 9, 14, 20, 0), now)).toBe('yesterday');
    expect(relativeTime(at(2026, 9, 12, 9, 0), now)).toBe('3d');
    expect(relativeTime(at(2026, 9, 1, 9, 0), now)).toBe('Oct 1');
  });

  it('treats a time slightly in the future as just now, and unknown as empty', () => {
    expect(relativeTime(at(2026, 9, 15, 15, 0), new Date(2026, 9, 15, 14, 59, 50))).toBe('just now');
    expect(relativeTime(null, now)).toBe('');
    expect(relativeTime('not a date', now)).toBe('');
  });
});

describe('clockTime', () => {
  it('gives the time today, and the weekday for another day', () => {
    expect(clockTime(at(2026, 9, 15, 15, 42), now)).toBe('3:42pm');
    expect(clockTime(at(2026, 9, 15, 9, 5), now)).toBe('9:05am');
    expect(clockTime(at(2026, 9, 16, 0, 30), now)).toBe('Fri 12:30am');
    expect(clockTime(undefined, now)).toBe('');
  });
});
