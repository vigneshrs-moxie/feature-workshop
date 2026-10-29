// usePlay(): the Play settings the page is in (meta.settings.play, defaults filled in) and what they
// mean for drawing: `on` (anything play-related shows), `full` (the Full-mode extras) and
// `animated` (Full, and the system isn't asking for reduced motion). Subtle = still and small.
// usePlayIfAny(): the same, or null outside a WorkshopContext (CrewMember draws there anyway).
// Both re-render only when the settings change, not on every live event.
import { useContext, useSyncExternalStore } from 'react';
import type { PlaySettings, Settings } from '../api/types';
import { WorkshopContext, type Store } from '../state/store';
import { playModeFromAddress, playOf } from './settings';

const REDUCED = '(prefers-reduced-motion: reduce)';

// One MediaQueryList for the whole page, made on first use (and again only if window.matchMedia
// itself is swapped, as tests do), however many crew members are drawn.
let reducedQuery: { match: typeof window.matchMedia; list: MediaQueryList } | null = null;
function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  if (reducedQuery?.match !== window.matchMedia) reducedQuery = { match: window.matchMedia, list: window.matchMedia(REDUCED) };
  return reducedQuery.list;
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

function playState(settings: Settings | null | undefined, reducedMotion: boolean): PlayState {
  const saved = playOf(settings);
  const play = { ...saved, mode: playModeFromAddress() ?? saved.mode };
  const full = play.mode === 'full';
  return { ...play, on: play.mode !== 'off', full, animated: full && !reducedMotion, reducedMotion };
}

const noSubscribe = () => () => {};
const none = () => null;
// meta.settings: a new object only when the settings change.
function useSettings(store: Store | null): Settings | null | undefined {
  return useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store ? () => store.getState().meta?.settings : none,
    store ? () => store.getState().meta?.settings : none,
  );
}

export function usePlay(): PlayState {
  const w = useContext(WorkshopContext);
  if (!w) throw new Error('usePlay needs a <WorkshopContext.Provider> above it.');
  return playState(useSettings(w.store), usePrefersReducedMotion());
}

/** usePlay(), or null when there is no WorkshopContext above. */
export function usePlayIfAny(): PlayState | null {
  const w = useContext(WorkshopContext);
  const settings = useSettings(w?.store ?? null);
  const reduced = usePrefersReducedMotion();
  return w ? playState(settings, reduced) : null;
}
