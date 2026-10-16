// celebrate(kind, play): how a reward is celebrated, from the Play settings alone. Never blocks,
// never asks anything; every celebration also has its words (the toast), so nothing is lost when
// it is quiet.
//   Subtle         the plain toast: no burst, no sound.
//   Full           a small CSS burst around the badge (achievements.css, under 1.2 s; none under
//                  reduced motion), and a chiptune blip when Settings → Play → Sounds is on.
//   Off            nothing at all.
// Kinds: an achievement unlocked, a quest done, and (Full-mode step 6) the boss defeated.
import type { PlayState } from './usePlay';

export type CelebrationKind = 'achievement' | 'quest' | 'boss';

export interface Celebration {
  kind: CelebrationKind;
  /** Draw the burst around the badge. */
  burst: boolean;
  /** How many pieces the burst has. */
  pieces: number;
  /** Play the kind's blip (play/sound.ts). */
  sound: boolean;
}

const PIECES: Record<CelebrationKind, number> = { achievement: 10, quest: 14, boss: 18 };

export function celebrate(kind: CelebrationKind, play: Pick<PlayState, 'on' | 'full' | 'reducedMotion' | 'sounds'>): Celebration {
  const full = play.on && play.full;
  const burst = full && !play.reducedMotion;
  return { kind, burst, pieces: burst ? PIECES[kind] : 0, sound: full && play.sounds };
}

/** Where each burst piece flies: evenly round the badge, alternating near and far (px), a little staggered. */
export function burstPieces(n: number): { dx: number; dy: number; delay: number; hue: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 26 : 36;
    return { dx: Math.round(Math.cos(a) * r), dy: Math.round(Math.sin(a) * r), delay: (i % 3) * 40, hue: i % 4 };
  });
}
