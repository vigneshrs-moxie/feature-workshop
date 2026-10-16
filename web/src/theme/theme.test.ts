import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, currentTheme, DEFAULT_THEME, isThemeId, resolveTheme, THEME_IDS, THEME_KEY, THEMES, themeFromUrl } from './theme';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme resolution', () => {
  it('registers the default and the five themes from the brief, each with a one-line description', () => {
    expect(THEME_IDS).toEqual(['default', 'neon-arcade', 'blueprint', 'pixel-crew', 'sunset-paper', 'candy-pop']);
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
