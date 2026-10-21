import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTextSize, currentTextSize, DEFAULT_TEXT_SIZE, initTextSize, isTextSize, resolveTextSize, TEXT_SCALES, TEXT_SIZE_KEY, TEXT_SIZES, useTextSize } from './textSize';
import { STATIC_TOKENS, tokensCss } from './tokens';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-text');
});

describe('text size', () => {
  it('has four sizes, S to XL, scaling from 87.5% to 125% around medium', () => {
    expect(TEXT_SIZES).toEqual(['s', 'm', 'l', 'xl']);
    expect(TEXT_SCALES).toEqual({ s: 0.875, m: 1, l: 1.125, xl: 1.25 });
    expect(DEFAULT_TEXT_SIZE).toBe('m');
    expect(TEXT_SIZE_KEY).toBe('workshop.textSize');
    expect(isTextSize('xl')).toBe(true);
    expect(isTextSize('xxl')).toBe(false);
  });

  it('resolves what is remembered, else medium', () => {
    expect(resolveTextSize('l')).toBe('l');
    expect(resolveTextSize('huge')).toBe('m');
    expect(resolveTextSize(null)).toBe('m');
    expect(resolveTextSize(undefined)).toBe('m');
  });

  it('applyTextSize sets html[data-text] and currentTextSize reads it back; an unknown id is medium', () => {
    applyTextSize('xl');
    expect(document.documentElement.getAttribute('data-text')).toBe('xl');
    expect(currentTextSize()).toBe('xl');
    applyTextSize('nope');
    expect(document.documentElement.getAttribute('data-text')).toBe('m');
  });

  it('initTextSize puts the remembered size on before the first paint', () => {
    localStorage.setItem(TEXT_SIZE_KEY, 's');
    initTextSize();
    expect(currentTextSize()).toBe('s');
    localStorage.setItem(TEXT_SIZE_KEY, 'garbage');
    initTextSize();
    expect(currentTextSize()).toBe('m');
  });

  it('useTextSize remembers a pick in this browser and applies it now', () => {
    const { result } = renderHook(() => useTextSize());
    expect(result.current[0]).toBe('m');
    act(() => result.current[1]('l'));
    expect(result.current[0]).toBe('l');
    expect(localStorage.getItem(TEXT_SIZE_KEY)).toBe('l');
    expect(document.documentElement.getAttribute('data-text')).toBe('l');
  });

  it('the tokens read one factor: every type size and the two heights scale, the widths do not', () => {
    for (const k of ['text-xs', 'text-sm', 'text-base', 'text-md', 'text-lg', 'text-xl', 'topbar-h', 'row-h']) {
      expect(STATIC_TOKENS[k], k).toMatch(/^calc\(\d+px \* var\(--ui-scale, 1\)\)$/);
    }
    for (const k of ['jobs-w', 'jobs-w-min', 'jobs-w-max', 'rail-w', 'foreman-max', 'preview-w']) expect(STATIC_TOKENS[k], k).not.toContain('ui-scale');
    expect(STATIC_TOKENS['text-base']).toBe('calc(13px * var(--ui-scale, 1))');
    expect(STATIC_TOKENS['leading']).toBe('1.45');
    const css = tokensCss();
    expect(css).toContain('--ui-scale: 1;');
    expect(css).toContain('html[data-text="s"] {\n  --ui-scale: .875;\n}');
    expect(css).toContain('html[data-text="xl"] {\n  --ui-scale: 1.25;\n}');
  });
});
