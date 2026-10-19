// celebrate(kind, play): how a reward is celebrated, from the Play settings alone. Never blocks,
// never asks anything; every celebration also has its words (the toast), so nothing is lost when
// it is quiet.
//   Subtle         a small CSS burst around the badge (a few pieces), no sound.
//   Full           the full burst (achievements.css, under 1.2 s), and a chiptune blip when
//                  Settings → Play → Sounds is on (PlayToasts plays one per batch).
//   Either         no burst under reduced motion: the toast alone.
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
/** Subtle's small burst. */
const SUBTLE_PIECES: Record<CelebrationKind, number> = { achievement: 4, quest: 6, boss: 6 };

export function celebrate(kind: CelebrationKind, play: Pick<PlayState, 'on' | 'full' | 'reducedMotion' | 'sounds'>): Celebration {
  const full = play.on && play.full;
  const burst = play.on && !play.reducedMotion;
  return { kind, burst, pieces: burst ? (full ? PIECES : SUBTLE_PIECES)[kind] : 0, sound: full && play.sounds };
}

/** Where each burst piece flies: evenly round the badge, alternating near and far (px), a little staggered. */
export function burstPieces(n: number): { dx: number; dy: number; delay: number; hue: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 26 : 36;
    return { dx: Math.round(Math.cos(a) * r), dy: Math.round(Math.sin(a) * r), delay: (i % 3) * 40, hue: i % 4 };
  });
}
