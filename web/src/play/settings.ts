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
