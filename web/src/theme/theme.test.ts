import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTheme, currentTheme, DEFAULT_THEME, HIDDEN_THEME_IDS, initTheme, isThemeAvailable, isThemeId, ORIGINAL_THEME_IDS, resolveTheme,
  setThemeUnlocks, THEME_IDS, THEME_KEY, THEMES, themeFromUrl, useAvailableThemes, useTheme,
} from './theme';

afterEach(() => {
  setThemeUnlocks({});
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  window.history.replaceState(null, '', '/');
});

describe('theme resolution', () => {
  it('registers the default, the five themes from the brief and the two hidden ones, each with a one-line description', () => {
    expect(THEME_IDS).toEqual(['default', 'neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop', 'crt', 'gold']);
    expect(ORIGINAL_THEME_IDS).toEqual(['default', 'neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop']);
    expect(HIDDEN_THEME_IDS).toEqual(['crt', 'gold']);
    expect(THEMES.find((t) => t.id === 'crt')?.label).toBe('CRT Terminal');
    for (const t of THEMES) {
      expect(t.label).toBeTruthy();
      expect(t.description).toMatch(/\S/);
      expect(t.description).not.toMatch(/\n/);
    }
    expect(isThemeId('candy-pop')).toBe(true);
    expect(isThemeId('dark')).toBe(false);
  });

  it('reads ?theme= before the hash and after it', () => {
    expect(themeFromUrl('?theme=blueprint', '')).toBe('blueprint');
    expect(themeFromUrl('', '#/?theme=blueprint')).toBe('blueprint');
    expect(themeFromUrl('', '#/settings?theme=candy-pop&x=1')).toBe('candy-pop');
    expect(themeFromUrl('?theme=a', '#/?theme=b')).toBe('a');
    expect(themeFromUrl('', '#/job/alpha')).toBeNull();
  });

  it('the address wins, then what is remembered, then the default', () => {
    expect(resolveTheme({ search: '?theme=neon-arcade', stored: 'blueprint' })).toBe('neon-arcade');
    expect(resolveTheme({ hash: '#/?theme=neon-arcade', stored: 'blueprint' })).toBe('neon-arcade');
    expect(resolveTheme({ stored: 'blueprint' })).toBe('blueprint');
    expect(resolveTheme({})).toBe(DEFAULT_THEME);
  });

  it('skips an unknown id at each step', () => {
    expect(resolveTheme({ search: '?theme=nope', stored: 'pixel-crew' })).toBe('pixel-crew');
    expect(resolveTheme({ search: '?theme=nope', stored: 'also-nope' })).toBe(DEFAULT_THEME);
    expect(resolveTheme({ stored: '' })).toBe(DEFAULT_THEME);
  });

  it('applyTheme sets html[data-theme] and currentTheme reads it back', () => {
    applyTheme('sunset-paper');
    expect(document.documentElement.getAttribute('data-theme')).toBe('sunset-paper');
    expect(currentTheme()).toBe('sunset-paper');
    applyTheme('not-a-theme');
    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_THEME);
    expect(THEME_KEY).toBe('workshop.theme');
  });
});

describe('hidden themes (CRT Terminal, Gold)', () => {
  it('count only with their unlock: the address and storage fall back like an unknown id', () => {
    expect(isThemeAvailable('crt')).toBe(false);
    expect(isThemeAvailable('crt', { crt: true })).toBe(true);
    expect(isThemeAvailable('gold', { crt: true })).toBe(false);
    expect(isThemeAvailable('gold', { gold: true })).toBe(true);
    expect(isThemeAvailable('blueprint')).toBe(true);
    expect(resolveTheme({ search: '?theme=crt' })).toBe(DEFAULT_THEME);
    expect(resolveTheme({ search: '?theme=gold', stored: 'blueprint' })).toBe('blueprint');
    expect(resolveTheme({ stored: 'gold' })).toBe(DEFAULT_THEME);
    expect(resolveTheme({ stored: 'gold', unlocks: { gold: true } })).toBe('gold');
    expect(resolveTheme({ hash: '#/?theme=crt', unlocks: { crt: true } })).toBe('crt');
  });

  it('localStorage tampering never puts a locked one on: the default shows until the ledger unlocks it', () => {
    localStorage.setItem(THEME_KEY, 'gold');
    initTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_THEME);
    applyTheme('crt');
    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_THEME);
    // A ledger that unlocks something else changes nothing.
    setThemeUnlocks({ crt: true });
    expect(currentTheme()).toBe(DEFAULT_THEME);
    // Once Gold is unlocked the remembered pick is put on; locked again (Play Off), it gives way.
    setThemeUnlocks({ crt: true, gold: true });
    expect(currentTheme()).toBe('gold');
    setThemeUnlocks({});
    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_THEME);
    expect(localStorage.getItem(THEME_KEY), 'the pick itself is kept').toBe('gold');
  });

  it('?theme=crt in the address works only once CRT Terminal is unlocked', () => {
    window.history.replaceState(null, '', '/next/?theme=crt');
    initTheme();
    expect(currentTheme()).toBe(DEFAULT_THEME);
    setThemeUnlocks({ crt: true });
    expect(currentTheme()).toBe('crt');
  });

  it('the picker lists a hidden theme only once unlocked, and its setter refuses a locked one', () => {
    const { result } = renderHook(() => ({ list: useAvailableThemes(), theme: useTheme() }));
    expect(result.current.list.map((t) => t.id)).toEqual([...ORIGINAL_THEME_IDS]);
    act(() => result.current.theme[1]('crt'));
    expect(result.current.theme[0]).toBe(DEFAULT_THEME);
    expect(localStorage.getItem(THEME_KEY)).toBe(DEFAULT_THEME);
    act(() => setThemeUnlocks({ crt: true }));
    expect(result.current.list.map((t) => t.id)).toEqual([...ORIGINAL_THEME_IDS, 'crt']);
    act(() => result.current.theme[1]('crt'));
    expect(result.current.theme[0]).toBe('crt');
    act(() => setThemeUnlocks({ crt: true, gold: true }));
    expect(result.current.list.map((t) => t.id)).toEqual([...THEME_IDS]);
  });
});
