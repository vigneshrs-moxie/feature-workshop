// Which theme is on. A theme is a CSS file under theme/themes/ scoped to html[data-theme="<id>"]
// that restyles the semantic tokens (tokens.ts) and the hooks listed in THEMING.md; it never
// changes what is on screen or where. The id is chosen, in this order, from
//   1. ?theme=<id> in the address (before or after the hash: /next/?theme=x or #/?theme=x),
//   2. localStorage 'workshop.theme' (set by the picker in Settings),
//   3. 'default'.
// Unknown ids are skipped. The picker saves to localStorage and applies at once.
//
// Two themes are hidden (the Play layer): CRT Terminal and Gold. They can be used only once the
// dashboard's play ledger says they are unlocked (GET /api/play `unlocks`, handed here with
// setThemeUnlocks). Until then, and always with Play mode Off, a hidden id in the address or in
// localStorage is skipped like an unknown one, so editing either never opens one. What you picked
// stays remembered: once the ledger arrives and says it is unlocked, it is put on.
import { useCallback, useSyncExternalStore } from 'react';
import { readStored, writeStored } from '../lib/stored';

/** The play ledger's unlocks (GET /api/play `unlocks`). */
export type UnlockId = 'crt' | 'gold';
export type ThemeUnlocks = Partial<Record<UnlockId, boolean>>;

export interface ThemeInfo {
  id: string;
  label: string;
  /** One line, shown under the name in the picker. */
  description: string;
  /** A hidden theme: shown and usable only once this unlock is in the play ledger. */
  unlock?: UnlockId;
}

export const THEMES: readonly ThemeInfo[] = [
  { id: 'default', label: 'Default', description: 'The plain dark look: quiet greys and one indigo accent.' },
  { id: 'neon-arcade', label: 'Neon arcade', description: 'Ink-navy night with electric magenta, cyan and lime; soft glows on what is active.' },
  { id: 'blueprint', label: 'Blueprint', description: 'Architect’s blueprint: deep blue paper, a faint grid, chalk lines and taped index cards.' },
  { id: 'pixel-crew', label: 'Pixel crew', description: 'Retro console vibe: pixel headings and chips, chunky borders, a 16-colour palette.' },
  { id: 'sunset-paper', label: 'Sunset paper', description: 'Light and warm: cream paper with coral, amber, teal and plum inks and big rounded corners.' },
  { id: 'candy-pop', label: 'Candy pop', description: 'Dark charcoal with pastel pops, pill chips and faint Memphis dots on the panes.' },
  { id: 'glass', label: 'Glass', description: 'Frosted glass panes over a soft aurora: thin bright edges, soft glows and big rounded corners.' },
  { id: 'crt', label: 'CRT Terminal', description: 'Phosphor green on a near-black tube, monospace type and faint scanlines.', unlock: 'crt' },
  { id: 'gold', label: 'Gold', description: 'Warm dark walnut with polished gold accents, for ten quests done.', unlock: 'gold' },
];

export const THEME_IDS: readonly string[] = THEMES.map((t) => t.id);
/** The themes everyone has: Default, the five that shipped with it, and Glass. */
export const ORIGINAL_THEME_IDS: readonly string[] = THEMES.filter((t) => !t.unlock).map((t) => t.id);
/** The hidden themes, each opened by its unlock. */
export const HIDDEN_THEME_IDS: readonly string[] = THEMES.filter((t) => t.unlock).map((t) => t.id);
export const DEFAULT_THEME = 'default';
export const THEME_KEY = 'workshop.theme';

const BY_ID = new Map(THEMES.map((t) => [t.id, t]));

export const isThemeId = (id: unknown): id is string => typeof id === 'string' && THEME_IDS.includes(id);

/** A theme that may be put on: an original, or a hidden one whose unlock is in `unlocks`. */
export function isThemeAvailable(id: unknown, unlocks: ThemeUnlocks = {}): id is string {
  if (!isThemeId(id)) return false;
  const unlock = BY_ID.get(id)?.unlock;
  return !unlock || unlocks[unlock] === true;
}

/** The theme named in the address: ?theme=<id> in the search part, else after the hash (#/?theme=<id>). */
export function themeFromUrl(search: string, hash: string): string | null {
  for (const part of [search, hash]) {
    const at = part.indexOf('?');
    if (at < 0) continue;
    const id = new URLSearchParams(part.slice(at + 1)).get('theme');
    if (id !== null) return id;
  }
  return null;
}

/**
 * The theme to use: the address first, then what this browser remembers, then the default. A
 * hidden theme counts only when `unlocks` has it (none by default), else it is skipped.
 */
export function resolveTheme({ search = '', hash = '', stored = null, unlocks = {} }: { search?: string; hash?: string; stored?: string | null; unlocks?: ThemeUnlocks }): string {
  const fromUrl = themeFromUrl(search, hash);
  if (isThemeAvailable(fromUrl, unlocks)) return fromUrl;
  if (isThemeAvailable(stored, unlocks)) return stored;
  return DEFAULT_THEME;
}

const listeners = new Set<() => void>();
const notify = () => { for (const l of [...listeners]) l(); };

// What the play ledger has unlocked, as last told (nothing until it is).
let unlocked: Readonly<ThemeUnlocks> = {};

/** Puts the theme on <html data-theme> and tells every useTheme() about it. A locked or unknown id is the default. */
export function applyTheme(id: string) {
  const next = isThemeAvailable(id, unlocked) ? id : DEFAULT_THEME;
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', next);
  notify();
}

export function currentTheme(): string {
  const on = typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-theme');
  return isThemeAvailable(on, unlocked) ? on : DEFAULT_THEME;
}

function wantedTheme(): string {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  return resolveTheme({ search: window.location.search, hash: window.location.hash, stored: readStored(THEME_KEY), unlocks: unlocked });
}

/** At startup, before the first render: pick the theme from the address, storage or the default. */
export function initTheme() {
  applyTheme(wantedTheme());
}

/**
 * The play ledger's unlocks (GET /api/play), or none (Play mode Off). A hidden theme you picked is
 * put on once it is unlocked; one on screen that isn't (any more) gives way to what else you'd get.
 */
export function setThemeUnlocks(next: ThemeUnlocks) {
  const clean: ThemeUnlocks = {};
  for (const t of THEMES) if (t.unlock && next[t.unlock] === true) clean[t.unlock] = true;
  if (JSON.stringify(clean) === JSON.stringify(unlocked)) return;
  unlocked = clean;
  applyTheme(wantedTheme());
}

/** The unlocks as last told (a new object each time they change). */
export function themeUnlocks(): Readonly<ThemeUnlocks> {
  return unlocked;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The themes you may pick now: the originals, and each hidden one once unlocked. */
export function useAvailableThemes(): readonly ThemeInfo[] {
  const u = useSyncExternalStore(subscribe, themeUnlocks, themeUnlocks);
  return THEMES.filter((t) => isThemeAvailable(t.id, u));
}

/** The theme on screen, and a setter that remembers the choice in this browser and applies it now. */
export function useTheme(): [string, (id: string) => void] {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => DEFAULT_THEME);
  const set = useCallback((id: string) => {
    const next = isThemeAvailable(id, unlocked) ? id : DEFAULT_THEME;
    writeStored(THEME_KEY, next);
    applyTheme(next);
  }, []);
  return [theme, set];
}
