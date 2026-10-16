// usePlay(): the Play settings the page is in (meta.settings.play, defaults filled in) and what they
// mean for drawing: `on` (anything play-related shows), `full` (the Full-mode extras) and
// `animated` (Full, and the system isn't asking for reduced motion). Subtle = still and small.
import { useSyncExternalStore } from 'react';
import type { PlaySettings } from '../api/types';
import { useWorkshopState } from '../state/store';
import { playOf } from './settings';

const REDUCED = '(prefers-reduced-motion: reduce)';

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED) : null;
}

function subscribe(listener: () => void) {
  const q = query();
  q?.addEventListener?.('change', listener);
  return () => q?.removeEventListener?.('change', listener);
}

/** Whether the system asks for reduced motion (then every character holds a still pose). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => query()?.matches ?? false, () => false);
}

export interface PlayState extends PlaySettings {
  /** Play mode isn't Off. */
  on: boolean;
  /** Play mode is Full. */
  full: boolean;
  /** Characters move: Full mode, and no reduced-motion request. */
  animated: boolean;
  reducedMotion: boolean;
}

export function usePlay(): PlayState {
  const { meta } = useWorkshopState();
  const play = playOf(meta?.settings);
  const reducedMotion = usePrefersReducedMotion();
  const full = play.mode === 'full';
  return { ...play, on: play.mode !== 'off', full, animated: full && !reducedMotion, reducedMotion };
}
