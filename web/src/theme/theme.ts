// Which theme is on. A theme is a CSS file under theme/themes/ scoped to html[data-theme="<id>"]
// that restyles the semantic tokens (tokens.ts) and the hooks listed in THEMING.md; it never
// changes what is on screen or where. The id is chosen, in this order, from
//   1. ?theme=<id> in the address (before or after the hash: /next/?theme=x or #/?theme=x),
//   2. localStorage 'workshop.theme' (set by the picker in Settings),
//   3. 'default'.
// Unknown ids are skipped. The picker saves to localStorage and applies at once.
import { useCallback, useSyncExternalStore } from 'react';
import { readStored, writeStored } from '../lib/stored';

export interface ThemeInfo {
  id: string;
  label: string;
  /** One line, shown under the name in the picker. */
  description: string;
}

export const THEMES: readonly ThemeInfo[] = [
  { id: 'default', label: 'Default', description: 'The plain dark look: quiet greys and one indigo accent.' },
  { id: 'neon-arcade', label: 'Neon arcade', description: 'Ink-navy night with electric magenta, cyan and lime; soft glows on what is active.' },
  { id: 'blueprint', label: 'Blueprint', description: 'Architect’s blueprint: deep blue paper, a faint grid, chalk lines and taped index cards.' },
  { id: 'pixel-crew', label: 'Pixel crew', description: 'Retro console vibe: pixel headings and chips, chunky borders, a 16-colour palette.' },
  { id: 'sunset-paper', label: 'Sunset paper', description: 'Light and warm: cream paper with coral, amber, teal and plum inks and big rounded corners.' },
  { id: 'candy-pop', label: 'Candy pop', description: 'Dark charcoal with pastel pops, pill chips and faint Memphis dots on the panes.' },
];

export const THEME_IDS: readonly string[] = THEMES.map((t) => t.id);
export const DEFAULT_THEME = 'default';
export const THEME_KEY = 'workshop.theme';

export const isThemeId = (id: unknown): id is string => typeof id === 'string' && THEME_IDS.includes(id);

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

/** The theme to use: the address first, then what this browser remembers, then the default. */
export function resolveTheme({ search = '', hash = '', stored = null }: { search?: string; hash?: string; stored?: string | null }): string {
  const fromUrl = themeFromUrl(search, hash);
  if (isThemeId(fromUrl)) return fromUrl;
  if (isThemeId(stored)) return stored;
  return DEFAULT_THEME;
}

const listeners = new Set<() => void>();

/** Puts the theme on <html data-theme> and tells every useTheme() about it. */
export function applyTheme(id: string) {
  const next = isThemeId(id) ? id : DEFAULT_THEME;
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', next);
  for (const l of [...listeners]) l();
}

export function currentTheme(): string {
  const on = typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-theme');
  return isThemeId(on) ? on : DEFAULT_THEME;
}

/** At startup, before the first render: pick the theme from the address, storage or the default. */
export function initTheme() {
  applyTheme(resolveTheme({ search: window.location.search, hash: window.location.hash, stored: readStored(THEME_KEY) }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The theme on screen, and a setter that remembers the choice in this browser and applies it now. */
export function useTheme(): [string, (id: string) => void] {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => DEFAULT_THEME);
  const set = useCallback((id: string) => {
    const next = isThemeId(id) ? id : DEFAULT_THEME;
    writeStored(THEME_KEY, next);
    applyTheme(next);
  }, []);
  return [theme, set];
}
