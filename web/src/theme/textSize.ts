// Text size (Settings → Look): S, M, L or XL, one factor on the whole UI's type and row heights.
// tokens.ts writes every type token, --row-h and --topbar-h as calc(<N>px * var(--ui-scale)), and
// html[data-text="<size>"] sets --ui-scale (tokens.css); nothing else changes, and the pane widths
// stay put. The choice is browser-local (localStorage 'workshop.textSize'), applied before the first
// paint like the theme (main.tsx) and shared with the classic page (dashboard/public/theme-boot.js).
import { useCallback, useSyncExternalStore } from 'react';
import { readStored, writeStored } from '../lib/stored';
import { TEXT_SCALES, type TextSizeId } from './tokens';

export type TextSize = TextSizeId;
export const TEXT_SIZES: readonly TextSize[] = ['s', 'm', 'l', 'xl'];
export const TEXT_SIZE_LABELS: Record<TextSize, string> = { s: 'S', m: 'M', l: 'L', xl: 'XL' };
export const DEFAULT_TEXT_SIZE: TextSize = 'm';
export const TEXT_SIZE_KEY = 'workshop.textSize';
export { TEXT_SCALES };

export const isTextSize = (id: unknown): id is TextSize => typeof id === 'string' && (TEXT_SIZES as readonly string[]).includes(id);

/** The size to use: what this browser remembers if it is one of the four, else medium. */
export function resolveTextSize(stored: string | null | undefined): TextSize {
  return isTextSize(stored) ? stored : DEFAULT_TEXT_SIZE;
}

const listeners = new Set<() => void>();
const notify = () => { for (const l of [...listeners]) l(); };

/** Puts the size on <html data-text> and tells every useTextSize() about it. An unknown id is medium. */
export function applyTextSize(id: string) {
  const next = resolveTextSize(id);
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-text', next);
  notify();
}

export function currentTextSize(): TextSize {
  const on = typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-text');
  return resolveTextSize(on);
}

/** At startup, before the first render: the remembered size, else medium. */
export function initTextSize() {
  applyTextSize(resolveTextSize(readStored(TEXT_SIZE_KEY)));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The text size on screen, and a setter that remembers the choice in this browser and applies it now. */
export function useTextSize(): [TextSize, (id: TextSize) => void] {
  const size = useSyncExternalStore(subscribe, currentTextSize, () => DEFAULT_TEXT_SIZE);
  const set = useCallback((id: TextSize) => {
    const next = resolveTextSize(id);
    writeStored(TEXT_SIZE_KEY, next);
    applyTextSize(next);
  }, []);
  return [size, set];
}
