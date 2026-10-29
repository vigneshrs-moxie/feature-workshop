// The Play settings as the page reads them: meta.settings.play with the dashboard's defaults
// (dashboard/lib/play.js PLAY_DEFAULTS) filled in, so an older dashboard without them reads as Subtle.
// When a quest counts as done is the finish line (settings.workflow.finishLine), not a Play setting.
import type { PlayMode, PlaySettings, Settings } from '../api/types';

export const PLAY_MODES: readonly PlayMode[] = ['full', 'subtle', 'off'];
export const PLAY_DEFAULTS: PlaySettings = { mode: 'subtle', sounds: false };

export function playOf(settings: Settings | null | undefined): PlaySettings {
  const p = settings?.play;
  return {
    mode: p && PLAY_MODES.includes(p.mode) ? p.mode : PLAY_DEFAULTS.mode,
    sounds: typeof p?.sounds === 'boolean' ? p.sounds : PLAY_DEFAULTS.sounds,
  };
}

/**
 * ?play=full, ?play=subtle or ?play=off in the page's address (before the hash, or after it): the
 * page shows in that mode without saving anything, for a click-through or a screenshot. The mode you
 * saved in Settings is untouched. null when the address doesn't say.
 */
export function playModeFromAddress(loc: { search: string; hash: string } | null = typeof window !== 'undefined' ? window.location : null): PlayMode | null {
  if (!loc) return null;
  for (const query of [loc.search.replace(/^\?/, ''), /\?(.*)$/.exec(loc.hash)?.[1] ?? '']) {
    const mode = new URLSearchParams(query).get('play');
    if (mode && (PLAY_MODES as readonly string[]).includes(mode)) return mode as PlayMode;
  }
  return null;
}
