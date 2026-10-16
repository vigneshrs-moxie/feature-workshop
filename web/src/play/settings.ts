// The Play settings as the page reads them: meta.settings.play with the dashboard's defaults
// (dashboard/lib/play.js PLAY_DEFAULTS) filled in, so an older dashboard without them reads as Subtle.
import type { PlayMode, PlaySettings, QuestDoneRule, Settings } from '../api/types';

export const PLAY_MODES: readonly PlayMode[] = ['full', 'subtle', 'off'];
export const QUEST_DONE_RULES: readonly QuestDoneRule[] = ['first-pr', 'marked-done'];
export const PLAY_DEFAULTS: PlaySettings = { mode: 'subtle', questDone: 'first-pr', sounds: false };

export function playOf(settings: Settings | null | undefined): PlaySettings {
  const p = settings?.play;
  return {
    mode: p && PLAY_MODES.includes(p.mode) ? p.mode : PLAY_DEFAULTS.mode,
    questDone: p && QUEST_DONE_RULES.includes(p.questDone) ? p.questDone : PLAY_DEFAULTS.questDone,
    sounds: typeof p?.sounds === 'boolean' ? p.sounds : PLAY_DEFAULTS.sounds,
  };
}
