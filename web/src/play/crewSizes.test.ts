import { describe, expect, it } from 'vitest';
import { CREW_SIZE, crewSize } from './crewSizes';

describe('the crew sizes', () => {
  it('draws Full at least as big as Subtle, and nothing in the conversation smaller than 28px', () => {
    for (const [spot, v] of Object.entries(CREW_SIZE)) {
      expect(crewSize(v, true), spot).toBeGreaterThanOrEqual(crewSize(v, false));
      expect(crewSize(v, false), spot).toBeGreaterThanOrEqual(28);
    }
  });

  it('keeps the thread lines a little smaller than the trail, and the trail smaller than the Foreman on the floor', () => {
    expect(crewSize(CREW_SIZE.tag, true)).toBeLessThan(crewSize(CREW_SIZE.trail, false));
    expect(crewSize(CREW_SIZE.trail, true)).toBeLessThan(CREW_SIZE.floorForeman);
  });
});
