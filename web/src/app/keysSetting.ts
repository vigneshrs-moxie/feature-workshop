// The keys setting (Settings → Keys), remembered in this browser under `fw.keys` because it is
// about this keyboard: whether the single-letter keys work at all, and whether buttons show their
// key. Off keeps only what any web page has (Esc, Enter, the arrows inside a list or menu, ⌘K and
// ⌘Enter): keyRegistry.ts runs just the bindings marked `always` then.
import { useCallback, useMemo } from 'react';
import { readStored, useStored, writeStored } from '../lib/stored';

export const KEYS_SETTING_KEY = 'fw.keys';

export interface KeysSetting {
  /** The page's keys work (j, k, c, ?, the Desk and gate keys, g then a letter). */
  enabled: boolean;
  /** Buttons show their key as a small hint. */
  hints: boolean;
}

export const DEFAULT_KEYS_SETTING: KeysSetting = { enabled: true, hints: true };

/** The setting from its stored text; anything missing or malformed is the default. */
export function parseKeysSetting(raw: string | null): KeysSetting {
  if (!raw) return DEFAULT_KEYS_SETTING;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof KeysSetting, unknown>> | null;
    return {
      enabled: typeof v?.enabled === 'boolean' ? v.enabled : true,
      hints: typeof v?.hints === 'boolean' ? v.hints : true,
    };
  } catch {
    return DEFAULT_KEYS_SETTING;
  }
}

export const readKeysSetting = (): KeysSetting => parseKeysSetting(readStored(KEYS_SETTING_KEY));

export function writeKeysSetting(patch: Partial<KeysSetting>) {
  writeStored(KEYS_SETTING_KEY, JSON.stringify({ ...readKeysSetting(), ...patch }));
}

/** The setting, live (a change made anywhere shows up at once), and a patcher. */
export function useKeysSetting(): [KeysSetting, (patch: Partial<KeysSetting>) => void] {
  const [raw] = useStored(KEYS_SETTING_KEY);
  const setting = useMemo(() => parseKeysSetting(raw), [raw]);
  const set = useCallback((patch: Partial<KeysSetting>) => writeKeysSetting(patch), []);
  return [setting, set];
}
