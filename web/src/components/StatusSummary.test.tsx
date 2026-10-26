// The top bar's status summary: groups in words with their glyphs, empty groups left out.
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Job } from '../api/types';
import { statusParts } from './StatusSummary';

afterEach(cleanup);
const job = (group: Job['group']) => ({ slug: group + Math.random(), group }) as unknown as Job;

describe('statusParts', () => {
  it('counts needs you, running and paused, in that order, leaving out the empty ones', () => {
    expect(statusParts([job('running'), job('needs-you'), job('running'), job('done')]).map((p) => p.text)).toEqual(['1 needs you', '2 running']);
    expect(statusParts([job('done')])).toEqual([]);
  });
});
