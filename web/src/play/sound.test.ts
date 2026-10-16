// The chiptune blip: WebAudio only, never before you have used the page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasInteracted, playBlip } from './sound';

function fakeAudio() {
  const made: { osc: number; started: number } = { osc: 0, started: 0 };
  const node = () => ({ connect: vi.fn(), gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } });
  const Ctor = vi.fn(function (this: Record<string, unknown>) {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    this.resume = vi.fn();
    this.createGain = vi.fn(node);
    this.createOscillator = vi.fn(() => {
      made.osc++;
      return { type: '', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(() => { made.started++; }), stop: vi.fn() };
    });
  });
  vi.stubGlobal('AudioContext', Ctor);
  return { Ctor, made };
}

function activation(active: boolean | undefined) {
  Object.defineProperty(navigator, 'userActivation', { configurable: true, value: active === undefined ? undefined : { hasBeenActive: active } });
}

afterEach(() => { vi.unstubAllGlobals(); activation(undefined); });

describe('playBlip', () => {
  it('never plays before you have used the page (so never on load), and makes no AudioContext', () => {
    const { Ctor } = fakeAudio();
    activation(false);
    expect(hasInteracted()).toBe(false);
    expect(playBlip('quest')).toBe(false);
    activation(undefined);
    expect(playBlip('achievement')).toBe(false);
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('after a click or key: a few square-wave notes made on the spot, no audio files', () => {
    const { made } = fakeAudio();
    activation(true);
    expect(playBlip('quest')).toBe(true);
    expect(made.osc).toBe(4);
    expect(made.started).toBe(4);
  });
});
