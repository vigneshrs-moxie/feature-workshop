// The Foreman's model as words: fixed once the job has a session, unknown before it has started.
// Invented jobs only.
import { describe, expect, it } from 'vitest';
import type { JobDetail } from '../../api/types';
import { foremanModel } from './foremanModel';

const MODELS = [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }, { id: 'claude-fable-5-2', label: 'Fable 5.2' }];
const detail = (drive: JobDetail['drive']): JobDetail => ({ slug: 'alpha', drive } as JobDetail);

describe('foremanModel', () => {
  it('the label once the job has a session', () => {
    expect(foremanModel(detail({ mode: 'workshop', model: 'claude-opus-5-5', sessionId: 's-1' }), MODELS)).toBe('Opus 5.5');
    // A model the list doesn't name shows as its id.
    expect(foremanModel(detail({ mode: 'workshop', model: 'claude-other-1', sessionId: 's-1' }), MODELS)).toBe('claude-other-1');
    expect(foremanModel(detail({ mode: 'workshop', model: 'claude-fable-5-2', sessionId: 's-1' }), undefined)).toBe('claude-fable-5-2');
  });

  it('null before it has started', () => {
    expect(foremanModel(detail({ mode: 'workshop', model: 'claude-opus-5-5' }), MODELS)).toBeNull();
    expect(foremanModel(detail({ mode: 'workshop', model: null, sessionId: 's-1' }), MODELS)).toBeNull();
    expect(foremanModel(detail(undefined), MODELS)).toBeNull();
    expect(foremanModel(null, MODELS)).toBeNull();
  });
});
