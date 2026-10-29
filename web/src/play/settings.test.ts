import { describe, expect, it } from 'vitest';
import { playModeFromAddress, playOf } from './settings';

describe('Play settings', () => {
  it('fill in the defaults', () => {
    expect(playOf(null)).toEqual({ mode: 'subtle', sounds: false });
    expect(playOf({ play: { mode: 'full', sounds: true } } as never)).toEqual({ mode: 'full', sounds: true });
  });

  it('?play= in the address (before or after the hash) shows a mode without saving it; anything else is ignored', () => {
    expect(playModeFromAddress({ search: '?play=full', hash: '#/jobs' })).toBe('full');
    expect(playModeFromAddress({ search: '?theme=glass&play=off', hash: '' })).toBe('off');
    expect(playModeFromAddress({ search: '', hash: '#/desk?play=subtle' })).toBe('subtle');
    expect(playModeFromAddress({ search: '?play=loud', hash: '#/' })).toBeNull();
    expect(playModeFromAddress({ search: '', hash: '#/' })).toBeNull();
  });
});
