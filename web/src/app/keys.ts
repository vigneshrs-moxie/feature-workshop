// The page's keys (design doc section 2, the ones that apply in phase 1):
//   ⌘K / Ctrl+K  the command palette, from anywhere (also while typing)
//   j / k        next / previous job, in Jobs-pane order
//   c            new job (⌘N belongs to the browser)
//   ?            the list of keys
// Single-letter keys are ignored while you type in a text field, while another dialog is open, and
// with ⌘, Ctrl or Alt held. The gate keys (a, ⇧a, r, o, ⌥a, n) come with gate cards in phase 2.
import { useEffect, useRef } from 'react';

/** Typing here: single-letter keys belong to the field, not the page. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type);
  return false;
}

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/** "⌘K" on a Mac, "Ctrl+K" elsewhere. */
export const paletteKeyLabel = () => (isMac() ? '⌘K' : 'Ctrl+K');

/** A dialog (the send preview, Always allow…, a sheet) is open: page keys wait. */
export const dialogOpen = () => document.querySelector('[aria-modal="true"]') !== null;

export interface PageKeys {
  palette(): void;
  nextJob(): void;
  previousJob(): void;
  newJob(): void;
  showKeys(): void;
}

export function handlePageKey(e: KeyboardEvent, keys: PageKeys): boolean {
  if (e.defaultPrevented || e.isComposing) return false;
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
    keys.palette();
    return true;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (isTypingTarget(e.target) || dialogOpen()) return false;
  switch (e.key) {
    case 'j': keys.nextJob(); return true;
    case 'k': keys.previousJob(); return true;
    case 'c': keys.newJob(); return true;
    case '?': keys.showKeys(); return true;
    default: return false;
  }
}

/** Listens on the whole page; the latest `keys` are always used. */
export function usePageKeys(keys: PageKeys) {
  const latest = useRef(keys);
  latest.current = keys;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (handlePageKey(e, latest.current)) e.preventDefault(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

/** The keys list (?), in plain words. */
export const KEY_LIST: { keys: string; what: string }[] = [
  { keys: `${isMac() ? '⌘K' : 'Ctrl+K'}`, what: 'Search every action you can take right now' },
  { keys: 'j / k', what: 'Open the next / previous job in the list' },
  { keys: 'c', what: 'Start a new job' },
  { keys: '?', what: 'Show this list' },
  { keys: `${isMac() ? '⌘' : 'Ctrl'}+Enter`, what: 'In the message box: preview and send, or steer a reply in progress' },
  { keys: 'Esc', what: 'Close a menu, sheet or this list' },
];
