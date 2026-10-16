// The chiptune blips (Full mode, only with Settings → Play → Sounds on): a few square-wave notes
// made with WebAudio on the spot, no audio files. Never on page load: a blip plays only after
// you have used the page (a click or a key: the browser's user activation), and only when a
// celebration asks for it (play/celebrate.ts), so a reload never makes a sound.
import type { CelebrationKind } from './celebrate';

// Note frequencies (Hz) and each note's length (s).
const TUNES: Record<CelebrationKind, number[]> = {
  achievement: [1046.5, 1318.5, 1568],
  quest: [523.25, 659.25, 784, 1046.5],
  boss: [392, 523.25, 659.25, 784, 1046.5],
};
const NOTE_S = 0.07;
const VOLUME = 0.05;

type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;

function audioCtor(): AudioCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Whether you have used the page yet (so a sound is never the first thing it does). */
export function hasInteracted(): boolean {
  const ua = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua?.hasBeenActive === true;
}

/** Play the kind's blip. Returns whether it played (false: no WebAudio, or the page not used yet). */
export function playBlip(kind: CelebrationKind): boolean {
  if (!hasInteracted()) return false;
  const Ctor = audioCtor();
  if (!Ctor) return false;
  try {
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    const start = ctx.currentTime + 0.01;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const notes = TUNES[kind];
    const end = start + notes.length * NOTE_S;
    gain.gain.setValueAtTime(VOLUME, start);
    gain.gain.setValueAtTime(VOLUME, end - 0.02);
    gain.gain.linearRampToValueAtTime(0, end);
    notes.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(f, start + i * NOTE_S);
      osc.connect(gain);
      osc.start(start + i * NOTE_S);
      osc.stop(start + (i + 1) * NOTE_S);
    });
    return true;
  } catch {
    return false; // no sound is fine: the toast says it all
  }
}
